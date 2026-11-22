import { test } from "node:test";
import assert from "node:assert/strict";
import type { PluginSubmission, PluginSubmissionContext, PluginSubmissionTarget } from "learnharness-plugin-api";
import { createBoards, isPending, noteChange, REFERENCE_KEY, startPage } from "../src/state.ts";
import { createSendInterceptor, type Capture } from "../src/send.ts";

const image = { type: "image" as const, data: "iVBORw0KGgo=", mimeType: "image/png" };
const message: PluginSubmission = { type: "text", content: { text: "my working", images: [] } };

function target(sessionId: string, extra: object = { type: "text", channels: ["content"] }): PluginSubmissionTarget {
	return { sessionId, sessionKind: "teaching", surfaceTarget: {}, ...extra } as unknown as PluginSubmissionTarget;
}
function context(sessionId: string) {
	const accepted: (() => void | Promise<void>)[] = [];
	const value = { ...target(sessionId), messages: [], signal: new AbortController().signal, onAccepted(cb: () => void) { accepted.push(cb); } };
	return { ctx: value as unknown as PluginSubmissionContext, acceptAll: async () => { for (const cb of accepted.splice(0)) await cb(); } };
}
function setup(exportImage: (capture: Capture) => Promise<typeof image> = async () => image) {
	const boards = createBoards();
	const sent: Capture[] = [];
	const interceptor = createSendInterceptor(boards, { exportImage, accepted: capture => { sent.push(capture); } });
	return { boards, interceptor, sent };
}

test("a pending drawing is attached, and marked sent only once the host accepts the submission", async () => {
	const { boards, interceptor, sent } = setup();
	noteChange(boards.get("chat_a"), [{ id: "a", version: 1 }]);
	const { ctx, acceptAll } = context("chat_a");
	const out = await interceptor.intercept(message, ctx);
	assert.deepEqual(out, { type: "text", content: { text: "my working", images: [image] } });
	assert.equal(isPending(boards.get("chat_a")), true, "not marked sent before acceptance");
	await acceptAll();
	assert.equal(isPending(boards.get("chat_a")), false);
	assert.deepEqual(sent.map(c => c.sessionId), ["chat_a"]);
});

test("sending the same unchanged drawing again attaches nothing", async () => {
	const { boards, interceptor } = setup();
	noteChange(boards.get("chat_a"), [{ id: "a", version: 1 }]);
	const first = context("chat_a");
	await interceptor.intercept(message, first.ctx);
	await first.acceptAll();
	assert.equal(await interceptor.intercept(message, context("chat_a").ctx), undefined);
});

test("a submission the host never accepts leaves the drawing pending", async () => {
	const { boards, interceptor, sent } = setup();
	noteChange(boards.get("chat_a"), [{ id: "a", version: 1 }]);
	await interceptor.intercept(message, context("chat_a").ctx); // refused: onAccepted never fires
	assert.equal(isPending(boards.get("chat_a")), true);
	assert.equal(sent.length, 0);
	assert.equal(interceptor.hasPendingInput!(target("chat_a")), true);
});

test("with Send switched off, submissions pass through untouched", async () => {
	const { boards, interceptor } = setup();
	const board = boards.get("chat_a");
	noteChange(board, [{ id: "a", version: 1 }]);
	board.send = false;
	assert.equal(await interceptor.intercept(message, context("chat_a").ctx), undefined);
	assert.equal(interceptor.hasPendingInput!(target("chat_a")), false);
});

test("one chat's drawing never attaches to another chat's submission", async () => {
	const { boards, interceptor } = setup();
	noteChange(boards.get("chat_a"), [{ id: "a", version: 1 }]);
	assert.equal(await interceptor.intercept(message, context("chat_b").ctx), undefined);
	assert.equal(interceptor.hasPendingInput!(target("chat_b")), false);
	assert.equal(boards.peek("chat_b"), undefined, "checking another chat must not create a board");
	assert.equal(isPending(boards.get("chat_a")), true);
});

test("a failed export rejects (the host keeps the draft) and the drawing stays pending", async () => {
	const { boards, interceptor } = setup(async () => { throw new Error("canvas lost"); });
	noteChange(boards.get("chat_a"), [{ id: "a", version: 1 }]);
	await assert.rejects(async () => interceptor.intercept(message, context("chat_a").ctx), /canvas lost/);
	assert.equal(isPending(boards.get("chat_a")), true);
});

test("the capture is taken before exporting: a stroke made during the export stays pending", async () => {
	let boardRef: ReturnType<ReturnType<typeof createBoards>["get"]> | undefined;
	const { boards, interceptor } = setup(async capture => {
		assert.deepEqual(capture.elements.map(e => e.id), ["a"]);
		noteChange(boardRef!, [{ id: "a", version: 1 }, { id: "b", version: 1 }]);
		return image;
	});
	boardRef = boards.get("chat_a");
	noteChange(boardRef, [{ id: "a", version: 1 }]);
	const { ctx, acceptAll } = context("chat_a");
	await interceptor.intercept(message, ctx);
	await acceptAll();
	assert.equal(isPending(boardRef), true);
});

test("only the current question's page is sent: earlier questions' cards and working stay on the board", async () => {
	const captured: string[][] = [];
	const { boards, interceptor } = setup(async capture => { captured.push(capture.elements.map(e => e.id)); return image; });
	const board = boards.get("chat_a");
	noteChange(board, [{ id: "card1", version: 1, customData: { [REFERENCE_KEY]: true } }, { id: "a", version: 1 }]);
	startPage(board, "q2", "new-page");
	noteChange(board, [
		{ id: "card1", version: 1, customData: { [REFERENCE_KEY]: true } }, { id: "a", version: 1 },
		{ id: "card2", version: 1, customData: { [REFERENCE_KEY]: true } }, { id: "b", version: 1 },
	]);
	await interceptor.intercept(message, context("chat_a").ctx);
	assert.deepEqual(captured, [["card2", "b"]]);
});

test("a drawing alone can make a message, practice working or a written answer sendable, but not a choice", () => {
	const { boards, interceptor } = setup();
	noteChange(boards.get("chat_a"), [{ id: "a", version: 1 }]);
	const has = (extra: object) => interceptor.hasPendingInput!(target("chat_a", extra));
	assert.equal(has({ type: "text", channels: ["content"] }), true);
	assert.equal(has({ type: "thinking", channels: ["content"], problem: {} }), true);
	assert.equal(has({ type: "answer", channels: ["answer"], question: { mode: "text" } }), true);
	assert.equal(has({ type: "answer", channels: ["answer"], question: { mode: "single-select" } }), false);
	assert.equal(has({ type: "plugin-question-answer", channels: ["answer"], question: {} }), false);
});

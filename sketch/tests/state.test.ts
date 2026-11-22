import { test } from "node:test";
import assert from "node:assert/strict";
import type { PluginSubmission } from "learnharness-plugin-api";
import { createBoards, hasInk, hasReference, isPending, markSent, noteChange, pageElements, placeReference, planQuestion, REFERENCE_KEY, removeReference, startPage } from "../src/state.ts";
import { appendImage } from "../src/submission.ts";

const el = (id: string, version = 1, extra: object = {}) => ({ id, version, ...extra });
const image = { type: "image" as const, data: "iVBORw0KGgo=", mimeType: "image/png" };
const older = { type: "image" as const, data: "R0lGODlh", mimeType: "image/gif" };

test("a new board has no ink and nothing to send", () => {
	const board = createBoards().get("chat_a");
	assert.equal(hasInk(board), false);
	assert.equal(isPending(board), false);
	assert.equal(board.send, true);
});

test("drawing makes the board pending; once sent, the unchanged drawing is not pending", () => {
	const board = createBoards().get("chat_a");
	noteChange(board, [el("a")]);
	assert.equal(isPending(board), true);
	markSent(board, board.version);
	assert.equal(isPending(board), false);
	noteChange(board, [el("a")]); // same element, same version: a selection or zoom change
	assert.equal(isPending(board), false);
});

test("changing the drawing after sending makes it pending again", () => {
	const board = createBoards().get("chat_a");
	noteChange(board, [el("a")]);
	markSent(board, board.version);
	noteChange(board, [el("a", 2)]);
	assert.equal(isPending(board), true);
	markSent(board, board.version);
	noteChange(board, [el("a", 2), el("b")]);
	assert.equal(isPending(board), true);
});

test("with Send switched off nothing is pending", () => {
	const board = createBoards().get("chat_a");
	board.send = false;
	noteChange(board, [el("a")]);
	assert.equal(isPending(board), false);
	board.send = true;
	assert.equal(isPending(board), true);
});

test("deleted elements and the question image are not ink", () => {
	const board = createBoards().get("chat_a");
	noteChange(board, [el("a", 2, { isDeleted: true }), el("q", 1, { customData: { [REFERENCE_KEY]: true } })]);
	assert.equal(hasInk(board), false);
	assert.equal(isPending(board), false);
});

test("adding or removing the question image alone does not make a sent drawing pending", () => {
	const board = createBoards().get("chat_a");
	noteChange(board, [el("a")]);
	markSent(board, board.version);
	noteChange(board, [el("q", 1, { customData: { [REFERENCE_KEY]: true } }), el("a")]);
	assert.equal(isPending(board), false);
});

test("a late acceptance of an older capture never lowers what was sent", () => {
	const board = createBoards().get("chat_a");
	noteChange(board, [el("a")]);
	const first = board.version;
	noteChange(board, [el("a", 2)]);
	const second = board.version;
	markSent(board, second);
	markSent(board, first);
	assert.equal(board.sentVersion, second);
	assert.equal(isPending(board), false);
});

test("boards are kept per chat, and peek never creates one", () => {
	const boards = createBoards();
	noteChange(boards.get("chat_a"), [el("a")]);
	assert.equal(boards.peek("chat_b"), undefined);
	assert.equal(boards.peek("chat_b"), undefined);
	assert.equal(isPending(boards.peek("chat_a")!), true);
	assert.equal(isPending(boards.get("chat_b")), false);
});

test("placing the question puts it under the ink and replaces an older question image", () => {
	const ink = el("a");
	const oldQuestion = el("q1", 1, { customData: { [REFERENCE_KEY]: true } });
	const newQuestion = el("q2", 1, { customData: { [REFERENCE_KEY]: true } });
	assert.deepEqual(placeReference([ink, oldQuestion], [newQuestion]).map(e => e.id), ["q2", "a"]);
	assert.deepEqual(removeReference([oldQuestion, ink]).map(e => e.id), ["a"]);
	assert.equal(hasReference([oldQuestion, ink]), true);
	assert.equal(hasReference([ink, el("q3", 1, { isDeleted: true, customData: { [REFERENCE_KEY]: true } })]), false);
});

const card = (id: string) => el(id, 1, { customData: { [REFERENCE_KEY]: true } });

test("a new question on a board with ink starts a new page; only that page counts as pending", () => {
	const board = createBoards().get("chat_a");
	noteChange(board, [el("a")]);
	markSent(board, board.version);
	assert.equal(planQuestion(board, "q2"), "new-page");
	startPage(board, "q2", "new-page");
	noteChange(board, [el("a"), card("card2")]);
	assert.equal(hasInk(board), false, "the new page has only its question");
	assert.equal(isPending(board), false);
	noteChange(board, [el("a"), card("card2"), el("b")]);
	assert.equal(isPending(board), true);
	assert.deepEqual(pageElements(board).map(e => e.id), ["card2", "b"]);
});

test("a board without ink just takes the new question", () => {
	const board = createBoards().get("chat_a");
	assert.equal(planQuestion(board, "q1"), "replace");
	startPage(board, "q1", "replace");
	noteChange(board, [card("card1"), el("a", 2, { isDeleted: true })]);
	assert.equal(planQuestion(board, "q2"), "replace");
	startPage(board, "q2", "replace");
	assert.deepEqual(pageElements(board).map(e => e.id), ["card1"]);
});

test("the same question, or no question, leaves the board alone — a hidden question stays hidden", () => {
	const board = createBoards().get("chat_a");
	startPage(board, "q1", "replace");
	noteChange(board, [el("a")]);
	assert.equal(planQuestion(board, "q1"), "keep");
	assert.equal(planQuestion(board, undefined), "keep");
});

test("each submission type gets the drawing in its own image channel and nothing else changes", () => {
	const thinking = { text: "because", images: [] };
	const reading = { text: "", images: [] };
	const cases: [PluginSubmission, PluginSubmission][] = [
		[{ type: "text", content: { text: "hi", images: [older] } }, { type: "text", content: { text: "hi", images: [older, image] } }],
		[{ type: "thinking", content: { text: "w", images: [] } }, { type: "thinking", content: { text: "w", images: [image] } }],
		[
			{ type: "answer", answer: { values: ["b"], text: "x", confidence: 80, images: [] }, thinking, readingThinking: reading },
			{ type: "answer", answer: { values: ["b"], text: "x", confidence: 80, images: [image] }, thinking, readingThinking: reading },
		],
		[
			{ type: "plugin-question-answer", answer: { k: 1 }, answerImages: [older], thinking, readingThinking: reading },
			{ type: "plugin-question-answer", answer: { k: 1 }, answerImages: [older, image], thinking, readingThinking: reading },
		],
		[
			{ type: "plugin-problem-submission", submission: "code", submissionImages: [], thinking },
			{ type: "plugin-problem-submission", submission: "code", submissionImages: [image], thinking },
		],
	];
	for (const [input, expected] of cases) {
		const before = structuredClone(input);
		assert.deepEqual(appendImage(input, image), expected, input.type);
		assert.deepEqual(input, before, `${input.type} input was changed`);
	}
});

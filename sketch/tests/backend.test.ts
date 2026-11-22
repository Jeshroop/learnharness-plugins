import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { activate } from "../src/backend.ts";
import { fakeBackendContext } from "./helpers/fake-context.ts";
import { PNG, SCENE } from "./helpers/fixtures.ts";

type Result = { content: { type: string; text: string }[]; isError?: boolean };
const text = (result: Result) => result.content.map(c => c.text).join("");

function setup() {
	const fake = fakeBackendContext();
	activate(fake.ctx);
	const call = (name: string, input: unknown) => Promise.resolve(fake.handlers.get(name)!(input)) as Promise<any>;
	const keep = (chatId: string, agent = "teacher") => fake.toolsFor(agent, chatId).find(t => t.name === "keep_sketch")!;
	return { ...fake, call, keep };
}

test("Save keeps a drawing as the learner's, and the Sketches list and image read it back", async () => {
	const { call } = setup();
	const saved = await call("sketch.save", { chatId: "chat_a", png: PNG, scene: SCENE });
	assert.equal(saved.by, "learner");
	const list = await call("sketch.list", {});
	assert.deepEqual(list.sketches.map((s: { name: string }) => s.name), [saved.name]);
	assert.deepEqual(await call("sketch.image", { name: saved.name }), { png: PNG });
});

test("the window cannot claim a save was the tutor's", async () => {
	const { call } = setup();
	const saved = await call("sketch.save", { chatId: "chat_a", png: PNG, scene: SCENE, by: "tutor", reason: "forged" });
	assert.equal(saved.by, "learner");
	assert.equal(saved.reason, undefined);
});

test("keep_sketch keeps the drawing last sent in that chat, with the tutor's reason", async () => {
	const { call, keep } = setup();
	await call("sketch.sent", { chatId: "chat_a", png: PNG, scene: SCENE });
	const result = await keep("chat_a").execute("call_1", { reason: "Drops the minus sign when expanding" }) as Result;
	assert.equal(result.isError, undefined);
	assert.match(text(result), /Kept/);
	const list = await call("sketch.list", {});
	assert.deepEqual(list.sketches.map((s: { chatId: string; by: string; reason?: string }) => [s.chatId, s.by, s.reason]),
		[["chat_a", "tutor", "Drops the minus sign when expanding"]]);
});

test("drawings that were sent but not kept are never written to disk", async () => {
	const { call, dataDirectory } = setup();
	await call("sketch.sent", { chatId: "chat_a", png: PNG, scene: SCENE });
	assert.equal(existsSync(path.join(dataDirectory, "sketches")), false);
});

test("keep_sketch with no drawing sent in this chat keeps nothing", async () => {
	const { call, keep, dataDirectory } = setup();
	await call("sketch.sent", { chatId: "chat_a", png: PNG, scene: SCENE });
	const result = await keep("chat_b", "practice").execute("call_1", { reason: "Wrong chat" }) as Result;
	assert.equal(result.isError, true);
	assert.match(text(result), /No drawing/);
	assert.equal(existsSync(path.join(dataDirectory, "sketches")), false);
});

test("keep_sketch keeps a drawing once, and needs a reason", async () => {
	const { call, keep } = setup();
	await call("sketch.sent", { chatId: "chat_a", png: PNG, scene: SCENE });
	assert.equal((await keep("chat_a").execute("call_1", { reason: "  " }) as Result).isError, true);
	assert.equal((await keep("chat_a").execute("call_2", { reason: "Good diagram of the forces" }) as Result).isError, undefined);
	const again = await keep("chat_a").execute("call_3", { reason: "Again" }) as Result;
	assert.equal(again.isError, true);
	assert.match(text(again), /already kept/);
	assert.equal((await call("sketch.list", {})).sketches.length, 1);
});

test("a malformed sent drawing is refused and not held", async () => {
	const { call, keep } = setup();
	await assert.rejects(async () => call("sketch.sent", { chatId: "chat_a", png: "bad", scene: SCENE }), /PNG/);
	assert.equal((await keep("chat_a").execute("call_1", { reason: "x" }) as Result).isError, true);
});

test("the tutor is told about keep_sketch in teaching and practice", () => {
	const { instructions, toolsFor } = setup();
	assert.deepEqual(instructions.map(i => i.agents), [["teacher", "practice"]]);
	assert.match(instructions[0]!.text, /keep_sketch/);
	assert.deepEqual(toolsFor("teacher", "chat_a").map(t => t.name), ["keep_sketch"]);
	assert.deepEqual(toolsFor("practice", "chat_a").map(t => t.name), ["keep_sketch"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activate } from "../src/main.ts";
import { activate as activateBackend } from "../src/backend.ts";
import { fakeBackendContext, fakeFrontendContext } from "./helpers/fake-context.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

test("both halves activate and return a cleanup", () => {
	assert.equal(typeof activateBackend(fakeBackendContext().ctx), "function");
	assert.equal(typeof activate(fakeFrontendContext().ctx), "function");
});

test("the backend registers both question types with teach and probe tools, the format tool and its handlers", () => {
	const fake = fakeBackendContext();
	activateBackend(fake.ctx);
	assert.deepEqual(fake.questionTypes.map(t => [t.id, (t.teach as { toolName: string }).toolName, (t.probe as { toolName: string }).toolName]),
		[["blank", "fill_in_blank", "probe_fill_in_blank"], ["graph", "choose_graph", "probe_choose_graph"]]);
	assert.deepEqual(fake.factories.map(f => f.agents), [["teacher", "prober"]]);
	assert.deepEqual([...fake.handlers.keys()], ["formats.get", "formats.set"]);
});

test("the tutors are told when each format fits, about the why line, reformat requests and the learner's choice", () => {
	const fake = fakeBackendContext();
	activateBackend(fake.ctx);
	assert.deepEqual(fake.instructions.map(i => i.agents), [["teacher"], ["prober"]]);
	const [teacher, prober] = fake.instructions.map(i => i.text);
	for (const phrase of ["fill_in_blank", "choose_graph", "why", "reformat", "question_format", "not an attempt"]) assert.match(teacher!, new RegExp(phrase), `teacher: ${phrase}`);
	for (const phrase of ["probe_fill_in_blank", "probe_choose_graph", "reformat", "question_format"]) assert.match(prober!, new RegExp(phrase), `prober: ${phrase}`);
});

test("the format handlers check their input", async () => {
	const fake = fakeBackendContext();
	activateBackend(fake.ctx);
	const set = fake.handlers.get("formats.set")!;
	assert.throws(() => set({ chatId: "../x", format: "blank" }), /chat/);
	assert.throws(() => set({ chatId: "chat_a", format: "essay" }), /format/);
	assert.deepEqual(set({ chatId: "chat_a", format: "graph", keep: true }), { format: "graph", keep: true });
	assert.deepEqual(fake.handlers.get("formats.get")!({ chatId: "chat_a" }), { format: "graph", keep: true });
});

test("the window registers both renderers and the Format button in teaching chats", () => {
	const fake = fakeFrontendContext();
	activate(fake.ctx);
	assert.deepEqual(fake.renderers.map(r => r.id), ["blank", "graph"]);
	assert.deepEqual(fake.actions.map(a => a.id), ["format"]);
	assert.deepEqual(fake.placements.map(p => [p.actionId, p.location, p.sessions]), [["format", "top-bar", ["teaching"]]]);
});

test("the build writes the runtime files", () => {
	execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: root, stdio: "pipe" });
	for (const file of ["manifest.json", "main.js", "backend.cjs", "styles.css"]) {
		assert.ok(existsSync(path.join(root, "dist", file)), `dist/${file} missing`);
	}
});

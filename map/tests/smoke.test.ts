import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activate as activateBackend } from "../src/backend.ts";
import { activate as activateFrontend } from "../src/main.ts";
import { fakeBackendContext, fakeFrontendContext } from "./helpers/fake-context.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

test("backend activate returns a cleanup function", () => {
	const { ctx } = fakeBackendContext();
	const cleanup = activateBackend(ctx);
	assert.equal(typeof cleanup, "function");
	cleanup();
});

test("backend activate registers both instruction blocks, both tool sets, the event listener and three handlers", () => {
	const { ctx, captured } = fakeBackendContext();
	activateBackend(ctx);
	assert.deepEqual(captured.instructions.map(i => i.agents), [["teacher"], ["practice"]]);
	assert.deepEqual(captured.tools.map(t => t.agents), [["teacher"], ["practice"]]);
	const names = (agent: string) => (captured.tools.find(t => t.agents.includes(agent))!.create({ chatId: "chat_x", agent }) as { name: string }[]).map(t => t.name);
	assert.deepEqual(names("teacher"), ["declare_tested", "record_attempt", "read_evidence", "link_evidence"]);
	assert.deepEqual(names("practice"), ["record_attempt", "read_evidence", "link_evidence"]);
	assert.equal(captured.listeners.length, 1);
	assert.deepEqual([...captured.handlers.keys()].sort(), ["map.evidence", "map.tree", "map.void"]);
});

test("frontend activate returns a cleanup function", () => {
	const { ctx } = fakeFrontendContext();
	const cleanup = activateFrontend(ctx);
	assert.equal(typeof cleanup, "function");
	cleanup();
});

test("the build writes manifest.json, main.js, backend.cjs and styles.css into dist", () => {
	execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: root, stdio: "pipe" });
	for (const file of ["manifest.json", "main.js", "backend.cjs", "styles.css"]) {
		assert.ok(existsSync(path.join(root, "dist", file)), `dist/${file} missing`);
	}
});

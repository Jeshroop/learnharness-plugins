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

test("the frontend registers the pad in the teaching and practice top bar, the Sketches view in the sidebar, and one send interceptor", () => {
	const { ctx, actions, placements, interceptors, views } = fakeFrontendContext();
	const cleanup = activate(ctx);
	assert.deepEqual(actions.map(a => a.id), ["sketch", "sketches"]);
	assert.deepEqual(placements.map(p => [p.actionId, p.location, p.sessions]),
		[["sketch", "top-bar", ["teaching", "practice"]], ["sketches", "sidebar", undefined]]);
	assert.deepEqual(views.map(v => v.id), ["sketches"]);
	assert.deepEqual(interceptors.map(i => i.id), ["sketch-send"]);
	assert.equal(typeof cleanup, "function");
});

test("the backend registers its handlers", () => {
	const { ctx, handlers } = fakeBackendContext();
	activateBackend(ctx);
	assert.deepEqual([...handlers.keys()], ["sketch.save", "sketch.sent", "sketch.list", "sketch.image"]);
});

test("the build writes the runtime files and self-hosted fonts without the Chinese-script font", () => {
	execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: root, stdio: "pipe" });
	for (const file of ["manifest.json", "main.js", "backend.cjs", "styles.css", "assets/fonts/Excalifont"]) {
		assert.ok(existsSync(path.join(root, "dist", file)), `dist/${file} missing`);
	}
	assert.equal(existsSync(path.join(root, "dist", "assets/fonts/Xiaolai")), false);
});

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

test("the build writes the runtime files", () => {
	execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: root, stdio: "pipe" });
	for (const file of ["manifest.json", "main.js", "backend.cjs", "styles.css"]) {
		assert.ok(existsSync(path.join(root, "dist", file)), `dist/${file} missing`);
	}
});

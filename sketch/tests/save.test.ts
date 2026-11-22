import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { listSketches, readSketchImage, saveSketch } from "../src/save.ts";
import { tempDir } from "./helpers/fake-context.ts";
import { PNG, PNG_SIGNATURE as SIGNATURE, SCENE } from "./helpers/fixtures.ts";
const at = new Date(2026, 10, 22, 9, 5, 7); // local time → 20261122-090507
const later = new Date(2026, 10, 22, 9, 6, 0);

test("a save writes the image, the editable scene and who saved it", () => {
	const dir = tempDir("sketch-save-");
	const saved = saveSketch(dir, { chatId: "chat_a1", png: PNG, scene: SCENE }, { now: at });
	assert.equal(saved.name, "20261122-090507-chat_a1");
	assert.deepEqual(readdirSync(path.join(dir, "sketches")).sort(),
		["20261122-090507-chat_a1.excalidraw", "20261122-090507-chat_a1.json", "20261122-090507-chat_a1.png"]);
	assert.equal(readFileSync(path.join(dir, "sketches", `${saved.name}.png`)).toString("base64"), PNG);
	assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "sketches", `${saved.name}.excalidraw`), "utf8")), JSON.parse(SCENE));
	assert.deepEqual(listSketches(dir), [{ name: saved.name, chatId: "chat_a1", at: at.toISOString(), by: "learner" }]);
	assert.equal(readSketchImage(dir, saved.name), PNG);
});

test("refused saves write nothing", () => {
	const dir = tempDir("sketch-save-");
	const refused: [unknown, RegExp][] = [
		[{ chatId: "chat_a", png: Buffer.from("GIF89a-not-a-png").toString("base64"), scene: SCENE }, /PNG/],
		[{ chatId: "chat_a", png: "not base64 at all!", scene: SCENE }, /PNG/],
		[{ chatId: "chat_a", png: PNG, scene: "{" }, /scene/],
		[{ chatId: "chat_a", png: PNG, scene: JSON.stringify({ type: "other" }) }, /scene/],
		[{ chatId: "../escape", png: PNG, scene: SCENE }, /chat/],
		[null, /chat/],
	];
	for (const [input, message] of refused) assert.throws(() => saveSketch(dir, input, { now: at }), message);
	assert.throws(() => saveSketch(dir, { chatId: "chat_a", png: PNG, scene: SCENE }, { now: at, by: "tutor", reason: "x".repeat(501) }), /reason/);
	assert.equal(existsSync(path.join(dir, "sketches")), false);
});

test("an oversized image is refused", () => {
	const dir = tempDir("sketch-save-");
	const big = Buffer.alloc(12 * 1024 * 1024 + 1);
	SIGNATURE.copy(big);
	assert.throws(() => saveSketch(dir, { chatId: "chat_a", png: big.toString("base64"), scene: SCENE }, { now: at }), /too large/);
	assert.equal(existsSync(path.join(dir, "sketches")), false);
});

test("two saves in the same second never overwrite each other", () => {
	const dir = tempDir("sketch-save-");
	const input = { chatId: "chat_a1", png: PNG, scene: SCENE };
	assert.equal(saveSketch(dir, input, { now: at }).name, "20261122-090507-chat_a1");
	assert.equal(saveSketch(dir, input, { now: at }).name, "20261122-090507-chat_a1-2");
	assert.equal(listSketches(dir).length, 2);
});

test("a sketch kept by the tutor records the reason, and the list is newest first", () => {
	const dir = tempDir("sketch-save-");
	saveSketch(dir, { chatId: "chat_a1", png: PNG, scene: SCENE }, { now: at });
	saveSketch(dir, { chatId: "chat_a1", png: PNG, scene: SCENE }, { now: later, by: "tutor", reason: "Sign error in line 2" });
	assert.deepEqual(listSketches(dir).map(s => [s.by, s.reason]), [["tutor", "Sign error in line 2"], ["learner", undefined]]);
});

test("reading an image refuses anything that is not a saved sketch's name", () => {
	const dir = tempDir("sketch-save-");
	assert.throws(() => readSketchImage(dir, "../../etc/passwd"), /name/);
	assert.throws(() => readSketchImage(dir, "20261122-090507-chat_zz"), /not found/);
	assert.deepEqual(listSketches(dir), []);
});

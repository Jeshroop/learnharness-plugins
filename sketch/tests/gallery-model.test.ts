import { test } from "node:test";
import assert from "node:assert/strict";
import { rowFor } from "../src/gallery-model.ts";

const at = new Date(2026, 10, 22, 9, 5, 7).toISOString();

test("a sketch the learner saved reads as saved by them", () => {
	const row = rowFor({ name: "20261122-090507-chat_a", chatId: "chat_a", at, by: "learner" }, "en-GB");
	assert.equal(row.who, "Saved by you");
	assert.equal(row.reason, "");
	assert.match(row.when, /22 Nov 2026/);
	assert.match(row.when, /09:05/);
});

test("a sketch the tutor kept shows who kept it and why", () => {
	const row = rowFor({ name: "n", chatId: "chat_a", at, by: "tutor", reason: "Sign error in line 2" }, "en-GB");
	assert.equal(row.who, "Kept by the tutor");
	assert.equal(row.reason, "Sign error in line 2");
});

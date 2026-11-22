import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { tempDir } from "./helpers/tmp.ts";
import path from "node:path";
import { openLog } from "../src/log.ts";
import type { NewEvent } from "../src/events.ts";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const ZEROS = "0".repeat(64);
const freshFile = () => path.join(tempDir("map-log-"), "evidence.jsonl");
const declare = (n: number): NewEvent => ({ type: "declare", chatId: "chat_a", ideas: [`n_${n}`], names: { [`n_${n}`]: `Idea ${n}` } });
const rawLines = (file: string) => readFileSync(file, "utf8").split("\n").filter(line => line !== "");

describe("evidence log", () => {
	test("the first line links to 64 zeros and the stored line is what append returns", async () => {
		const file = freshFile();
		const logged = await openLog(file).append(declare(1));
		const [line] = rawLines(file);
		assert.deepEqual(JSON.parse(line!), logged);
		assert.equal(logged.prev, ZEROS);
		assert.match(logged.id, /^ev_[0-9a-f]{12}$/);
		assert.ok(!Number.isNaN(Date.parse(logged.at)));
	});

	test("each later line's prev is the sha256 of the previous raw line", async () => {
		const file = freshFile();
		const log = openLog(file);
		for (let n = 1; n <= 3; n++) await log.append(declare(n));
		const lines = rawLines(file);
		assert.equal(lines.length, 3);
		assert.equal(JSON.parse(lines[1]!).prev, sha256(lines[0]!));
		assert.equal(JSON.parse(lines[2]!).prev, sha256(lines[1]!));
	});

	test("editing an earlier line makes verify report that line", async () => {
		const file = freshFile();
		const log = openLog(file);
		for (let n = 1; n <= 3; n++) await log.append(declare(n));
		assert.deepEqual(log.verify(), { ok: true });
		const lines = rawLines(file);
		lines[1] = lines[1]!.replace('"Idea 2"', '"Idea two"');
		writeFileSync(file, lines.join("\n") + "\n");
		assert.deepEqual(log.verify(), { ok: false, firstBreak: 2 });
	});

	test("a torn last line is damage; the next append starts a fresh line and links over it", async () => {
		const file = freshFile();
		const log = openLog(file);
		await log.append(declare(1));
		const torn = '{"v":1,"id":"ev_torn';
		appendFileSync(file, torn);
		const before = log.read();
		assert.equal(before.events.length, 1);
		assert.deepEqual(before.damage.map(d => d.line), [2]);
		const next = await log.append(declare(2));
		assert.equal(next.prev, sha256(torn));
		assert.ok(readFileSync(file, "utf8").endsWith("\n"));
		assert.equal(log.read().events.length, 2);
		assert.deepEqual(log.verify(), { ok: true });
	});

	test("a parseable line without the event fields is damage, not an event", async () => {
		const file = freshFile();
		const log = openLog(file);
		await log.append(declare(1));
		appendFileSync(file, '{"hello":1}\n');
		const { events, damage } = log.read();
		assert.equal(events.length, 1);
		assert.deepEqual(damage.map(d => d.line), [2]);
	});

	test("twenty concurrent appends produce twenty linked lines with distinct ids", async () => {
		const file = freshFile();
		const log = openLog(file);
		const logged = await Promise.all(Array.from({ length: 20 }, (_, n) => log.append(declare(n))));
		assert.equal(rawLines(file).length, 20);
		assert.equal(new Set(logged.map(e => e.id)).size, 20);
		assert.deepEqual(log.verify(), { ok: true });
	});

	test("the bytes already in the file are an exact prefix after every append", async () => {
		const file = freshFile();
		const log = openLog(file);
		await log.append(declare(1));
		appendFileSync(file, '{"torn":');
		for (let n = 2; n <= 4; n++) {
			const before = readFileSync(file, "utf8");
			await log.append(declare(n));
			assert.ok(readFileSync(file, "utf8").startsWith(before));
		}
	});

	test("a parseable event with a malformed nested field is damage", async () => {
		const file = freshFile();
		const log = openLog(file);
		await log.append(declare(1));
		const base = { v: 1, at: new Date().toISOString(), prev: ZEROS };
		appendFileSync(file, `${JSON.stringify({ ...base, id: "ev_aaaaaaaaaaaa", type: "judged", chatId: "c", sourceKey: "c:x", verdicts: [null], quotes: [], grader: {} })}\n`);
		appendFileSync(file, `${JSON.stringify({ ...base, id: "ev_bbbbbbbbbbbb", type: "observed", chatId: "c", sourceKey: "c:y", ideas: ["n_1"], names: {}, posedAt: base.at, question: { text: "q", format: "quiz" }, answer: { result: "correct", hinted: false, answeredAt: base.at } })}\n`);
		const { events, damage } = log.read();
		assert.equal(events.length, 1);
		assert.deepEqual(damage.map(d => d.line), [2, 3]);
	});

	test("a missing file reads as an empty log", () => {
		assert.deepEqual(openLog(freshFile()).read(), { events: [], damage: [] });
	});
});

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ideaStates } from "../src/rule.ts";
import type { LoggedEvent, NewEvent, Quote, Result } from "../src/events.ts";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const iso = (minute: number) => new Date(Date.UTC(2026, 0, 5, 10, minute)).toISOString();
let serial = 0;
const ev = (event: NewEvent, minute: number): LoggedEvent =>
	({ v: 1, id: `ev_${(++serial).toString(16).padStart(12, "0")}`, at: iso(minute), prev: "0".repeat(64), ...event }) as LoggedEvent;

const live = new Set(["n_a", "n_b", "n_c"]);
const isLive = (id: string) => live.has(id);

interface Try { key: string; ideas?: string[]; question: string; result: Result | "unmarked"; hinted?: boolean; confidence?: number; minute: number; names?: Record<string, string> }
const observed = (t: Try) => ev({
	type: "observed", chatId: "chat_x", sourceKey: `chat_x:${t.key}`, source: { kind: "question", toolCallId: t.key, messageId: `msg_${t.key}` },
	ideas: t.ideas ?? ["n_a"], names: t.names ?? {}, posedAt: iso(t.minute - 1),
	question: { text: t.question, format: "quiz" },
	answer: { result: t.result, hinted: t.hinted ?? false, ...(t.confidence !== undefined ? { confidence: t.confidence } : {}), answeredAt: iso(t.minute) },
}, t.minute);
const quote = (text: string, minute: number, kind: Quote["kind"] = "reasoning", shows = ["n_a"], hash = sha256(text)): Quote =>
	({ kind, shows, text, sha256: hash, source: { chatId: "chat_x", messageId: "msg_q", field: "thinking", start: 0, end: text.length, at: iso(minute) } });
const judged = (key: string, minute: number, verdicts: [string, Result, boolean][], quotes: Quote[] = [], pinned?: string) => ev({
	type: "judged", chatId: "chat_x", sourceKey: `chat_x:${key}`, ...(pinned ? { observed: pinned } : {}),
	verdicts: verdicts.map(([idea, result, variant]) => ({ idea, result, variant })), quotes, grader: { model: "sonnet" },
}, minute);
const voidOf = (target: string, minute: number) => ev({ type: "void", target, reason: "misclick", by: "learner" }, minute);
const state = (events: LoggedEvent[], idea = "n_a") => ideaStates(events, isLive).states.get(idea);

describe("wrong first", () => {
	test("a correct variant with a quote of his reasoning passes", () => {
		const s = state([
			observed({ key: "q1", question: "Find the greatest speed of the car.", result: "wrong", minute: 2 }),
			observed({ key: "q2", question: "Find the greatest speed of the cyclist.", result: "correct", minute: 6 }),
			judged("q2", 7, [["n_a", "correct", true]], [quote("Top speed is where driving force equals resistance.", 6)]),
		]);
		assert.equal(s!.path, "wrong-first");
		assert.equal(s!.passed, true);
		assert.equal(s!.passedAt, iso(7));
	});

	test("without a reasoning quote it does not pass, and what is missing says so", () => {
		const s = state([
			observed({ key: "q1", question: "Car.", result: "wrong", minute: 2 }),
			observed({ key: "q2", question: "Cyclist.", result: "correct", minute: 6 }),
			judged("q2", 7, [["n_a", "correct", true]]),
		]);
		assert.equal(s!.passed, false);
		assert.deepEqual(s!.needs, ["a quote of the correct reasoning"]);
	});

	test("the identical question again is never a variant", () => {
		const s = state([
			observed({ key: "q1", question: "Find the greatest speed.", result: "wrong", minute: 2 }),
			observed({ key: "q2", question: "Find the  greatest speed.", result: "correct", minute: 6 }),
			judged("q2", 7, [["n_a", "correct", true]], [quote("Driving force equals resistance.", 6)]),
		]);
		assert.equal(s!.passed, false);
	});

	test("a quote from before the variant was asked does not count", () => {
		const s = state([
			observed({ key: "q1", question: "Car.", result: "wrong", minute: 2 }),
			observed({ key: "q2", question: "Cyclist.", result: "correct", minute: 6 }),
			judged("q2", 7, [["n_a", "correct", true]], [quote("Driving force equals resistance.", 3)]),
		]);
		assert.equal(s!.passed, false);
	});

	test("a quote whose text no longer matches its fingerprint does not count", () => {
		const s = state([
			observed({ key: "q1", question: "Car.", result: "wrong", minute: 2 }),
			observed({ key: "q2", question: "Cyclist.", result: "correct", minute: 6 }),
			judged("q2", 7, [["n_a", "correct", true]], [quote("Driving force equals resistance.", 6, "reasoning", ["n_a"], sha256("something else"))]),
		]);
		assert.equal(s!.passed, false);
	});

	test("a first I-don't-know puts the idea on the wrong-first path", () => {
		assert.equal(state([observed({ key: "q1", question: "Car.", result: "dontKnow", minute: 2 })])!.path, "wrong-first");
	});
});

describe("right first", () => {
	const base = (confidence: number | undefined, extraQuotes: Quote[] = []) => state([
		observed({ key: "q1", question: "Car.", result: "correct", minute: 2 }),
		observed({ key: "q2", question: "Cyclist.", result: "correct", minute: 6, ...(confidence !== undefined ? { confidence } : {}) }),
		judged("q2", 7, [["n_a", "correct", true]], [quote("Driving force equals resistance.", 6), ...extraQuotes]),
	]);

	test("a variant with reasoning but only 70% confidence does not pass", () => {
		const s = base(70);
		assert.equal(s!.path, "right-first");
		assert.equal(s!.passed, false);
		assert.deepEqual(s!.needs, ["stated confidence (90% or more, or in words)"]);
	});

	test("90% on the slider completes the pass", () => {
		assert.equal(base(90)!.passed, true);
	});

	test("confidence stated in his words completes the pass", () => {
		assert.equal(base(undefined, [quote("I'm confident about this now.", 6, "confidence")])!.passed, true);
	});
});

describe("hints, voids and several ideas", () => {
	test("a solve with hints never passes, and a hinted first attempt means wrong-first", () => {
		const s = state([
			observed({ key: "p1", question: "Problem one.", result: "correct", hinted: true, minute: 2 }),
			judged("p1", 3, [["n_a", "correct", false]]),
			observed({ key: "p2", question: "Problem two.", result: "correct", hinted: true, minute: 6 }),
			judged("p2", 7, [["n_a", "correct", true]], [quote("Driving force equals resistance.", 6)]),
		]);
		assert.equal(s!.path, "wrong-first");
		assert.equal(s!.passed, false);
	});

	test("a voided wrong first answer still means wrong-first", () => {
		const first = observed({ key: "q1", question: "Car.", result: "wrong", minute: 2 });
		assert.equal(state([first, voidOf(first.id, 3), observed({ key: "q2", question: "Cyclist.", result: "correct", minute: 6 })])!.path, "wrong-first");
	});

	test("a voided right first answer followed by a wrong one means wrong-first", () => {
		const first = observed({ key: "q1", question: "Car.", result: "correct", minute: 2 });
		assert.equal(state([first, voidOf(first.id, 3), observed({ key: "q2", question: "Cyclist.", result: "wrong", minute: 6 })])!.path, "wrong-first");
	});

	test("a voided passing attempt no longer passes", () => {
		const second = observed({ key: "q2", question: "Cyclist.", result: "correct", minute: 6 });
		const s = state([
			observed({ key: "q1", question: "Car.", result: "wrong", minute: 2 }), second,
			judged("q2", 7, [["n_a", "correct", true]], [quote("Driving force equals resistance.", 6)]), voidOf(second.id, 8),
		]);
		assert.equal(s!.passed, false);
	});

	test("a judgement of an answer taken back with Undo does not carry over to the new answer", () => {
		const undone = observed({ key: "q2", question: "Cyclist.", result: "correct", minute: 6 });
		const s = state([
			observed({ key: "q1", question: "Car.", result: "wrong", minute: 2 }), undone,
			judged("q2", 7, [["n_a", "correct", true]], [quote("Driving force equals resistance.", 6)], undone.id),
			ev({ type: "void", target: undone.id, reason: "Taken back with Undo", by: "undo" }, 8),
			observed({ key: "q2", question: "Cyclist.", result: "correct", minute: 9 }),
		]);
		assert.equal(s!.passed, false);
	});

	test("two ideas on one question follow separate paths, and one quote can show both", () => {
		const events = [
			// A words-only answer: the tutor marks each idea (a graded-wrong choice
			// answer can never make an idea right — see the clean rule).
			observed({ key: "q1", ideas: ["n_a", "n_b"], question: "Car.", result: "unmarked", minute: 2 }),
			judged("q1", 3, [["n_a", "correct", false], ["n_b", "wrong", false]]),
			observed({ key: "q2", ideas: ["n_a", "n_b"], question: "Cyclist.", result: "correct", minute: 6, confidence: 100 }),
			judged("q2", 7, [["n_a", "correct", true], ["n_b", "correct", true]], [quote("Force balance at top speed.", 6, "reasoning", ["n_a", "n_b"])]),
		];
		assert.equal(state(events, "n_a")!.path, "right-first");
		assert.equal(state(events, "n_b")!.path, "wrong-first");
		assert.equal(state(events, "n_a")!.passed, true);
		assert.equal(state(events, "n_b")!.passed, true);
	});

	test("a pass is permanent; a later wrong answer only lowers the probability", () => {
		const passing = [
			observed({ key: "q1", question: "Car.", result: "wrong", minute: 2 }),
			observed({ key: "q2", question: "Cyclist.", result: "correct", minute: 6 }),
			judged("q2", 7, [["n_a", "correct", true]], [quote("Driving force equals resistance.", 6)]),
		];
		const before = state(passing)!;
		const after = state([...passing, observed({ key: "q3", question: "Train.", result: "wrong", minute: 12 })])!;
		assert.equal(after.passed, true);
		assert.ok(after.pKnown < before.pKnown);
		assert.equal(after.weakPass, true);
	});
});

describe("rulings on proof and help", () => {
	test("a reasoning quote under three words does not count", () => {
		const s = state([
			observed({ key: "q1", question: "Car.", result: "wrong", minute: 2 }),
			observed({ key: "q2", question: "Cyclist.", result: "correct", minute: 6 }),
			judged("q2", 7, [["n_a", "correct", true]], [quote("4 m/s", 6)]),
		]);
		assert.equal(s!.passed, false);
	});

	test("a correct variant the tutor marks as helped never passes, and a helped first answer means wrong-first", () => {
		const events = [
			observed({ key: "q1", question: "Car.", result: "correct", minute: 2 }),
			ev({ type: "judged", chatId: "chat_x", sourceKey: "chat_x:q1", verdicts: [{ idea: "n_a", result: "correct", variant: false, hinted: true }], quotes: [], grader: {} } as NewEvent, 3),
			observed({ key: "q2", question: "Cyclist.", result: "correct", minute: 6 }),
			ev({ type: "judged", chatId: "chat_x", sourceKey: "chat_x:q2", verdicts: [{ idea: "n_a", result: "correct", variant: true, hinted: true }], quotes: [quote("Driving force equals resistance.", 6)], grader: {} } as NewEvent, 7),
		];
		assert.equal(state(events)!.path, "wrong-first");
		assert.equal(state(events)!.passed, false);
	});
});

describe("a pass only goes one way", () => {
	const passing = () => {
		const q2 = observed({ key: "q2", question: "Cyclist.", result: "correct", minute: 6 });
		return { q2, events: [
			observed({ key: "q1", question: "Car.", result: "wrong", minute: 2 }), q2,
			judged("q2", 7, [["n_a", "correct", true]], [quote("Driving force equals resistance.", 6)], q2.id),
		] };
	};

	test("a later judgement of the same attempt cannot take the pass away", () => {
		const { q2, events } = passing();
		const s = state([...events, judged("q2", 9, [["n_a", "wrong", true]], [], q2.id)]);
		assert.equal(s!.passed, true);
		assert.equal(s!.passedAt, iso(7));
	});

	test("a late judgement of an earlier answer cannot take the pass away", () => {
		const q1 = observed({ key: "q1", question: "Explain the car.", result: "unmarked", minute: 2 });
		const q2 = observed({ key: "q2", question: "Cyclist.", result: "correct", minute: 6 });
		const events = [q1, q2, judged("q2", 7, [["n_a", "correct", true]], [quote("Driving force equals resistance.", 6)], q2.id)];
		assert.equal(state(events)!.passed, true);
		assert.equal(state([...events, judged("q1", 9, [["n_a", "correct", false]], [], q1.id)])!.passed, true);
	});

	test("linking a label with a right-first history cannot take the pass away", () => {
		const label = observed({ key: "l1", ideas: ["label:L"], names: { "label:L": "L" }, question: "Label question.", result: "correct", minute: 1 });
		const { events } = passing();
		const s = state([label, ...events, ev({ type: "link", from: "label:L", to: "n_a", reason: "same idea" }, 10)]);
		assert.equal(s!.passed, true);
	});

	test("the learner's void can still remove the evidence a pass rests on", () => {
		const { q2, events } = passing();
		assert.equal(state([...events, voidOf(q2.id, 9)])!.passed, false);
	});
});

describe("identity", () => {
	test("a label is off the map until linked, then counts under the linked idea", () => {
		const attempt = observed({ key: "q1", ideas: ["label:Power at top speed"], names: { "label:Power at top speed": "Power at top speed" }, question: "Car.", result: "wrong", minute: 2 });
		const before = ideaStates([attempt], isLive);
		assert.equal(before.states.size, 0);
		assert.deepEqual(before.orphans, [{ key: "label:Power at top speed", name: "Power at top speed", attempts: 1 }]);
		const after = ideaStates([attempt, ev({ type: "link", from: "label:Power at top speed", to: "n_c", reason: "now in the graph" }, 3)], isLive);
		assert.equal(after.states.get("n_c")!.attempts, 1);
		assert.deepEqual(after.orphans, []);
	});

	test("evidence for an idea that left the graph is listed with its stored name", () => {
		const { orphans } = ideaStates([observed({ key: "q1", ideas: ["n_gone"], names: { n_gone: "Old idea" }, question: "Car.", result: "correct", minute: 2 })], isLive);
		assert.deepEqual(orphans, [{ key: "n_gone", name: "Old idea", attempts: 1 }]);
	});
});

describe("mastery probability", () => {
	const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-4, `${actual} ≉ ${expected}`);

	test("one plain correct answer: 0.6585", () => {
		close(state([observed({ key: "q1", question: "A.", result: "correct", minute: 2 })])!.pKnown, 0.6585);
	});

	test("three plain correct answers: 0.9809", () => {
		close(state([
			observed({ key: "q1", question: "A.", result: "correct", minute: 2 }),
			observed({ key: "q2", question: "B.", result: "correct", minute: 4 }),
			observed({ key: "q3", question: "C.", result: "correct", minute: 6 }),
		])!.pKnown, 0.9809);
	});

	test("wrong, then correct with a verified reasoning quote: 0.9389", () => {
		close(state([
			observed({ key: "q1", question: "A.", result: "wrong", minute: 2 }),
			observed({ key: "q2", question: "B.", result: "correct", minute: 6 }),
			judged("q2", 7, [["n_a", "correct", true]], [quote("Because forces balance.", 6)]),
		])!.pKnown, 0.9389);
	});

	test("correct, then correct with a verified reasoning quote: 0.9951", () => {
		close(state([
			observed({ key: "q1", question: "A.", result: "correct", minute: 2 }),
			observed({ key: "q2", question: "B.", result: "correct", minute: 6 }),
			judged("q2", 7, [["n_a", "correct", true]], [quote("Because forces balance.", 6)]),
		])!.pKnown, 0.9951);
	});
});

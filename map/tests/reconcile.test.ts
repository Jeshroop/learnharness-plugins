import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { tempDir } from "./helpers/tmp.ts";
import path from "node:path";
import { pendingEvents, reconcile } from "../src/reconcile.ts";
import { openLog } from "../src/log.ts";
import type { LoggedEvent, NewEvent, ObservedEvent } from "../src/events.ts";
import { call, iso, marker, quizAnswer, record, result, user } from "./helpers/records.ts";

const ZEROS = "0".repeat(64);
let serial = 0;
const logged = (event: NewEvent, minute: number): LoggedEvent =>
	({ v: 1, id: `ev_${(++serial).toString(16).padStart(12, "0")}`, at: iso(minute), prev: ZEROS, ...event }) as LoggedEvent;
const declare = (minute: number, ideas: string[]) =>
	logged({ type: "declare", chatId: "chat_test", ideas, names: Object.fromEntries(ideas.map(i => [i, `Name ${i}`])) }, minute);
const answered = (callId: string, minute: number, fields: Record<string, unknown> = { correct: true }) =>
	result(callId, "quiz", quizAnswer(minute, fields), minute);
const observedOf = (events: NewEvent[]) => events.filter((e): e is ObservedEvent => e.type === "observed");
const nameOf = (id: string) => ({ n_a: "Name A" } as Record<string, string>)[id];

describe("teacher pairing", () => {
	test("the latest declaration before an answer pairs with it", () => {
		const d1 = declare(1, ["n_a"]), d2 = declare(2, ["n_b"]);
		const [observed] = observedOf(pendingEvents("chat_test", record([answered("call_q1", 4)]) as never, [d1, d2]));
		assert.equal(observed!.declaration, d2.id);
		assert.deepEqual(observed!.ideas, ["n_b"]);
		assert.deepEqual(observed!.names, { n_b: "Name n_b" });
		assert.equal(observed!.sourceKey, "chat_test:call_q1");
		assert.equal(observed!.posedAt, iso(2));
		assert.deepEqual(observed!.question, { text: "Which force keeps the bead on the hoop?", format: "quiz", options: ["Tension", "Normal reaction"] });
		assert.equal(observed!.answer.result, "correct");
		assert.equal(observed!.answer.hinted, false);
		assert.equal(observed!.answer.answeredAt, iso(4));
		assert.deepEqual(observed!.answer.picks, ["Normal reaction"]);
	});

	test("a superseded declaration never pairs with a later answer", () => {
		const events = pendingEvents("chat_test", record([answered("call_q1", 4), answered("call_q2", 6)]) as never, [declare(1, ["n_a"]), declare(2, ["n_b"])]);
		assert.deepEqual(observedOf(events).map(e => e.sourceKey), ["chat_test:call_q1"]);
	});

	test("an ask or probe answer neither pairs nor consumes a declaration", () => {
		const r = record([
			result("call_ask", "ask_user_question", { kind: "ask", answers: [], dontKnow: false, answeredAt: iso(2) }, 2),
			result("call_probe", "probe", quizAnswer(3, { correct: true }), 3),
			answered("call_q1", 4),
		]);
		const d1 = declare(1, ["n_a"]);
		assert.deepEqual(observedOf(pendingEvents("chat_test", r as never, [d1])).map(e => e.declaration), [d1.id]);
	});

	test("a dismissed answer consumes its declaration and logs nothing", () => {
		const r = record([answered("call_q1", 3, { dismissed: true }), answered("call_q2", 5)]);
		assert.deepEqual(pendingEvents("chat_test", r as never, [declare(1, ["n_a"])]), []);
	});

	test("a second run finds nothing new", () => {
		const r = record([answered("call_q1", 4)]);
		const events: LoggedEvent[] = [declare(1, ["n_a"])];
		for (const e of pendingEvents("chat_test", r as never, events)) events.push(logged(e, 5));
		assert.deepEqual(pendingEvents("chat_test", r as never, events), []);
	});
});

describe("practice", () => {
	const run = (callId: string, outcome: string, rung: string | null, start: number) => [
		call("problem", callId, { statement: `Problem ${callId}`, mode: "recall", target: ["n_a"] }, start),
		result(callId, "problem", null, start),
		marker("practice-thinking", { problemCallId: callId, text: "P/v equals resistance." }, start + 1),
		call("conclude", `${callId}_end`, { outcome, verdict: "…", rung, missClass: null, retest: false }, start + 2),
		result(`${callId}_end`, "conclude", null, start + 2),
	];

	test("a concluded problem is observed with its outcome and working copied from the record", () => {
		const [observed] = observedOf(pendingEvents("chat_test", record(run("call_p1", "solvedWithHints", "R1", 1)) as never, [], nameOf));
		assert.equal(observed!.source.kind, "problem");
		assert.deepEqual(observed!.ideas, ["n_a"]);
		assert.deepEqual(observed!.names, { n_a: "Name A" });
		assert.deepEqual(observed!.question, { text: "Problem call_p1", format: "practice" });
		assert.equal(observed!.answer.result, "correct");
		assert.equal(observed!.answer.hinted, true);
		assert.equal(observed!.answer.outcome, "solvedWithHints");
		assert.equal(observed!.answer.rung, "R1");
		assert.deepEqual(observed!.answer.working, ["P/v equals resistance."]);
		assert.equal(observed!.posedAt, iso(1));
		assert.equal(observed!.answer.answeredAt, iso(3));
	});

	test("rung R0 on a solved problem still counts as a hint", () => {
		const [observed] = observedOf(pendingEvents("chat_test", record(run("call_p1", "solved", "R0", 1)) as never, []));
		assert.equal(observed!.answer.hinted, true);
	});

	test("surrendered and moved-on problems are observed as not right; a dismissed one is not observed", () => {
		const r = record([...run("call_s", "surrendered", null, 1), ...run("call_m", "movedOn", null, 10), ...run("call_d", "dismissed", null, 20)]);
		assert.deepEqual(observedOf(pendingEvents("chat_test", r as never, [])).map(e => [e.source.toolCallId, e.answer.result, e.answer.hinted]), [
			["call_s", "dontKnow", false], ["call_m", "wrong", false],
		]);
	});
});

describe("undo", () => {
	const observedFor = (messageId: string, minute: number, declaration: string) => logged({
		type: "observed", chatId: "chat_test", sourceKey: "chat_test:call_q1",
		source: { kind: "question", toolCallId: "call_q1", messageId }, declaration, ideas: ["n_a"], names: {},
		posedAt: iso(1), question: { text: "q", format: "quiz" }, answer: { result: "correct", hinted: false, answeredAt: iso(minute) },
	}, minute);

	test("an answer taken back with Undo is voided once", () => {
		const d1 = declare(1, ["n_a"]);
		const gone = observedFor("msg_gone", 4, d1.id);
		const events: LoggedEvent[] = [d1, gone];
		const pending = pendingEvents("chat_test", record([]) as never, events);
		assert.deepEqual(pending, [{ type: "void", target: gone.id, reason: "Taken back with Undo", by: "undo" }]);
		events.push(logged(pending[0]!, 5));
		assert.deepEqual(pendingEvents("chat_test", record([]) as never, events), []);
	});

	test("answering again after Undo is observed as a fresh attempt", () => {
		const d1 = declare(1, ["n_a"]);
		const gone = observedFor("msg_gone", 4, d1.id);
		const voided = logged({ type: "void", target: gone.id, reason: "Taken back with Undo", by: "undo" }, 5);
		const fresh = observedOf(pendingEvents("chat_test", record([answered("call_q1", 7)]) as never, [d1, gone, voided]));
		assert.equal(fresh.length, 1);
		assert.equal(fresh[0]!.answer.answeredAt, iso(7));
	});

	test("a deleted chat voids nothing", () => {
		const d1 = declare(1, ["n_a"]);
		assert.deepEqual(pendingEvents("chat_test", null, [d1, observedFor("msg_gone", 4, d1.id)]), []);
	});
});

describe("final-review fixes", () => {
	const settle = (r: ReturnType<typeof record>, events: LoggedEvent[], minute: number) => {
		for (const e of pendingEvents("chat_test", r as never, events)) events.push(logged(e, minute));
		return events;
	};
	const practiceRun = (outcome: string, workingMinute: number, concludeMinute: number, extra: ReturnType<typeof user>[] = []) => ({
		pose: [call("problem", "call_p1", { statement: "Find the speed.", mode: "recall", target: ["n_a"] }, 1), result("call_p1", "problem", null, 1)],
		working: marker("practice-thinking", { problemCallId: "call_p1", text: "Momentum before equals after." }, workingMinute),
		extra,
		end: [call("conclude", `end_${concludeMinute}`, { outcome, verdict: "…", rung: null, missClass: null, retest: false }, concludeMinute), result(`end_${concludeMinute}`, "conclude", null, concludeMinute)],
	});

	test("a void by the learner sticks: the next run does not log the same answer again", () => {
		const r = record([answered("call_q1", 4)]);
		const events = settle(r, [declare(1, ["n_a"])], 5);
		const observed = events.find(e => e.type === "observed")!;
		events.push(logged({ type: "void", target: observed.id, reason: "I misclicked", by: "learner" }, 6));
		assert.deepEqual(pendingEvents("chat_test", r as never, events), []);
	});

	test("a voided practice attempt is not logged again", () => {
		const run = practiceRun("solved", 3, 5);
		const r = record([...run.pose, run.working, ...run.end]);
		const events = settle(r, [], 6);
		events.push(logged({ type: "void", target: events[0]!.id, reason: "wrong problem", by: "learner" }, 7));
		assert.deepEqual(pendingEvents("chat_test", r as never, events), []);
	});

	test("practice attempts are anchored on the conclusion: Undo of a surrender lets the later solve count", () => {
		const surrender = practiceRun("surrendered", 3, 6, [user("I give up", 5)]);
		const events = settle(record([...surrender.pose, surrender.working, ...surrender.extra, ...surrender.end]), [], 7);
		// Undo cuts the record back to before "I give up": the message and the conclusion are gone.
		const undone = record([...surrender.pose, surrender.working]);
		const voids = pendingEvents("chat_test", undone as never, events);
		assert.deepEqual(voids.map(v => v.type), ["void"]);
		for (const v of voids) events.push(logged(v, 8));
		const solved = practiceRun("solved", 3, 12);
		const later = observedOf(pendingEvents("chat_test", record([...solved.pose, solved.working, ...solved.end]) as never, events));
		assert.deepEqual(later.map(e => e.answer.result), ["correct"]);
	});

	test("a re-answer after Undo never pairs with a declaration whose call was taken back", () => {
		const d1 = logged({ type: "declare", chatId: "chat_test", toolCallId: "call_d1", ideas: ["n_a"], names: {} } as NewEvent, 1);
		const d2 = logged({ type: "declare", chatId: "chat_test", toolCallId: "call_d2", ideas: ["n_b"], names: {} } as NewEvent, 5);
		const r = record([call("declare_tested", "call_d1", {}, 1), call("quiz", "call_q1", { question: "q" }, 2), answered("call_q1", 7)]);
		const [observed] = observedOf(pendingEvents("chat_test", r as never, [d1, d2]));
		assert.equal(observed!.declaration, d1.id);
	});

	test("a judgement whose quoted message was taken back with Undo is voided", () => {
		const d1 = declare(1, ["n_a"]);
		const explain = user("Because momentum before equals momentum after.", 6);
		const answer = answered("call_q1", 4);
		const before = record([answer, explain]);
		const events = settle(before, [d1], 5);
		const observed = events.find(e => e.type === "observed")!;
		const judged = logged({
			type: "judged", chatId: "chat_test", sourceKey: "chat_test:call_q1", observed: observed.id,
			verdicts: [{ idea: "n_a", result: "correct", variant: false }], grader: {},
			quotes: [{ kind: "reasoning", shows: ["n_a"], text: "Because momentum before equals momentum after.", sha256: "x", source: { chatId: "chat_test", messageId: explain.id, field: "message", start: 0, end: 10, at: iso(6) } }],
		}, 7);
		events.push(judged);
		const after = record([answer]);
		assert.deepEqual(pendingEvents("chat_test", after as never, events).map(e => [e.type, (e as { target?: string }).target]), [["void", judged.id]]);
	});
});

describe("reconcile", () => {
	test("appends what happened to the real log once", async () => {
		const log = openLog(path.join(tempDir("map-rec-"), "evidence.jsonl"));
		await log.append({ type: "declare", chatId: "chat_test", ideas: ["n_a"], names: {} });
		// The declaration must precede the answer on the real clock.
		const r = record([result("call_q1", "quiz", quizAnswer(0, { correct: true, answeredAt: new Date(Date.now() + 60_000).toISOString() }), 0)]);
		const getSession = (id: string) => (id === "chat_test" ? r : null);
		assert.equal(await reconcile("chat_test", getSession as never, log), 1);
		assert.equal(await reconcile("chat_test", getSession as never, log), 0);
		assert.deepEqual(log.read().events.map(e => e.type), ["declare", "observed"]);
	});

	test("two reconciles of the same chat at once log the answer once", async () => {
		const log = openLog(path.join(tempDir("map-rec-"), "evidence.jsonl"));
		await log.append({ type: "declare", chatId: "chat_test", ideas: ["n_a"], names: {} });
		const r = record([result("call_q1", "quiz", quizAnswer(0, { correct: true, answeredAt: new Date(Date.now() + 60_000).toISOString() }), 0)]);
		const getSession = () => r;
		const counts = await Promise.all([reconcile("chat_test", getSession as never, log), reconcile("chat_test", getSession as never, log)]);
		assert.equal(counts[0]! + counts[1]!, 1);
		assert.deepEqual(log.read().events.map(e => e.type), ["declare", "observed"]);
	});
});

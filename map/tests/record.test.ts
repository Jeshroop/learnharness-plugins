import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { answeredQuestions, findQuote, learnerTexts, problemRuns } from "../src/record.ts";
import { at, call, marker, quizAnswer, record, result, user } from "./helpers/records.ts";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("answeredQuestions", () => {
	test("a graded quiz answer is copied with its result, picks, thinking and confidence", () => {
		const r = record([
			call("quiz", "call_q1", { question: "Which force keeps the bead on the hoop?" }, 1),
			result("call_q1", "quiz", quizAnswer(3, { correct: true, confidence: 90, thinking: "The hoop pushes inward." }), 3),
		]);
		const [answer] = answeredQuestions(r as never);
		assert.equal(answer!.toolCallId, "call_q1");
		assert.equal(answer!.tool, "quiz");
		assert.equal(answer!.result, "correct");
		assert.deepEqual(answer!.picks, ["Normal reaction"]);
		assert.deepEqual(answer!.options, ["Tension", "Normal reaction"]);
		assert.equal(answer!.thinking, "The hoop pushes inward.");
		assert.equal(answer!.confidence, 90);
		assert.equal(answer!.answeredAt, at(3));
		assert.equal(answer!.dismissed, false);
	});

	test("a wrong answer, a words-only answer and an explain answer get their own results", () => {
		const r = record([
			result("call_a", "quiz", quizAnswer(2, { correct: false }), 2),
			result("call_b", "quiz", quizAnswer(4, { answers: [], wordsOnly: true, thinking: "Gravity alone." }), 4),
			result("call_c", "explain", { kind: "explain", tool: "explain", questionText: "Explain why.", answers: [], dontKnow: false, text: "Because the net force is zero.", answeredAt: new Date(at(6)).toISOString() }, 6),
		]);
		assert.deepEqual(answeredQuestions(r as never).map(a => [a.toolCallId, a.result, a.wordsOnly]), [
			["call_a", "wrong", false], ["call_b", "unmarked", true], ["call_c", "unmarked", false],
		]);
	});

	test("I don't know, a dismissal and a legacy note are read faithfully", () => {
		const r = record([
			result("call_a", "quiz", quizAnswer(2, { dontKnow: true, answers: [] }), 2),
			result("call_b", "quiz", quizAnswer(4, { dismissed: true }), 4),
			result("call_c", "quiz", quizAnswer(6, { correct: true, note: "Old-style note." }), 6),
		]);
		const answers = answeredQuestions(r as never);
		assert.equal(answers[0]!.result, "dontKnow");
		assert.equal(answers[1]!.dismissed, true);
		assert.equal(answers[2]!.thinking, "Old-style note.");
	});

	test("ask, probe and failed results are not teaching answers", () => {
		const r = record([
			result("call_ask", "ask_user_question", { kind: "ask", answers: [], dontKnow: false, answeredAt: new Date(at(2)).toISOString() }, 2),
			result("call_probe", "probe", quizAnswer(3, { correct: true }), 3),
			result("call_err", "quiz", quizAnswer(4, { correct: true }), 4, true),
		]);
		assert.deepEqual(answeredQuestions(r as never), []);
	});
});

describe("problemRuns", () => {
	test("a posed problem collects its working and its conclusion", () => {
		const concluded = result("call_c1", "conclude", null, 9);
		const r = record([
			call("problem", "call_p1", { statement: "Find the greatest speed.", mode: "composition", target: ["n_a", "n_b"], modelSolution: "…" }, 1),
			result("call_p1", "problem", null, 1),
			marker("practice-thinking", { problemCallId: "call_p1", text: "Max speed when acceleration is zero." }, 5, "Your thinking:\nMax speed when acceleration is zero."),
			marker("practice-thinking", { problemCallId: "call_p1", text: "So P/v = R." }, 7, "Your thinking:\nSo P/v = R."),
			call("conclude", "call_c1", { outcome: "solvedWithHints", verdict: "…", rung: "R1", missClass: null, retest: false }, 9),
			concluded,
		]);
		const [run] = problemRuns(r as never);
		assert.equal(run!.toolCallId, "call_p1");
		assert.equal(run!.statement, "Find the greatest speed.");
		assert.deepEqual(run!.target, ["n_a", "n_b"]);
		assert.deepEqual(run!.working.map(w => w.text), ["Max speed when acceleration is zero.", "So P/v = R."]);
		assert.deepEqual(run!.conclusion, { outcome: "solvedWithHints", rung: "R1", at: at(9), messageId: concluded.id });
	});

	test("a dismissed problem concludes as dismissed and a failed pose is not a run", () => {
		const r = record([
			call("problem", "call_bad", { statement: "Broken.", mode: "recall" }, 1),
			result("call_bad", "problem", null, 1, true),
			call("problem", "call_p2", { statement: "Find the tension.", mode: "recall", target: ["n_c"] }, 2),
			result("call_p2", "problem", null, 2),
			marker("problem-dismissed", { problemCallId: "call_p2" }, 4),
		]);
		const runs = problemRuns(r as never);
		assert.deepEqual(runs.map(run => run.toolCallId), ["call_p2"]);
		assert.equal(runs[0]!.conclusion!.outcome, "dismissed");
	});
});

describe("findQuote", () => {
	const r = record([
		user("Earlier I thought gravity alone did it.", 1),
		result("call_q1", "quiz", quizAnswer(5, { correct: true, thinking: "Speed peaks where\nthe driving force equals resistance." }), 5),
		user("I am confident about this now.", 7),
	]);

	test("a quote with a different line break is found and copied byte for byte from the record", () => {
		const found = findQuote(learnerTexts(r as never, at(3)), "Speed peaks where the driving force equals resistance.");
		assert.ok(found);
		assert.equal(found.text, "Speed peaks where\nthe driving force equals resistance.");
		assert.equal(found.sha256, sha256("Speed peaks where\nthe driving force equals resistance."));
		assert.equal(found.source.field, "thinking");
		assert.equal(found.source.text.slice(found.start, found.end), found.text);
	});

	test("words he never wrote are not found", () => {
		assert.equal(findQuote(learnerTexts(r as never, at(3)), "The normal reaction does no work."), null);
	});

	test("his words from before the question was asked are not found", () => {
		assert.equal(findQuote(learnerTexts(r as never, at(3)), "gravity alone did it"), null);
		assert.ok(findQuote(learnerTexts(r as never, at(0)), "gravity alone did it"));
	});

	test("plain messages count as his words", () => {
		const found = findQuote(learnerTexts(r as never, at(3)), "I am confident about this now.");
		assert.equal(found?.source.field, "message");
	});
});

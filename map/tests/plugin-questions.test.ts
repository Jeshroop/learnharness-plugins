import { test } from "node:test";
import assert from "node:assert/strict";
import { answeredQuestions, learnerTexts } from "../src/record.ts";
import { pendingEvents } from "../src/reconcile.ts";
import type { LoggedEvent, ObservedEvent } from "../src/events.ts";
import { call, iso, record, result, user } from "./helpers/records.ts";

// Persisted shapes of another plugin's question (here Formats' fill in the blank).
function posed(callId: string, minute: number, question: string, payload: Record<string, unknown>) {
	const message = call("fill_in_blank", callId, { question, payload, type: "check", nodeId: "n_a" }, minute) as unknown as Record<string, unknown>;
	message.lhQuestions = {
		0: {
			pluginId: "formats", typeId: "blank", questionId: `q_${callId}`, contractVersion: 1,
			occurrence: { messageId: message.id, contentIndex: 0, toolCallId: callId, toolName: "fill_in_blank" },
			input: { question, payload, type: "check", nodeId: "n_a" },
		},
	};
	return message as never;
}
function answer(callId: string, minute: number, value: unknown, grading?: unknown) {
	return result(callId, "fill_in_blank", {
		kind: "plugin-question", questionId: `q_${callId}`, pluginId: "formats", typeId: "blank", contractVersion: 1,
		answer: value, thinking: "force is mass times acceleration so the gap is mass",
		...(grading === undefined ? {} : { grading: { result: grading } }), answeredAt: iso(minute),
	}, minute);
}
const stem = { text: "[[1]] = ma", blanks: [{ accept: ["F"] }], why: "exact law" };

test("answers to another plugin's questions are read, graded by its correct flag", () => {
	const [a] = answeredQuestions(record([posed("c1", 1, "Fill the gap.", stem), answer("c1", 2, { blanks: ["F"] }, { correct: true })]) as never);
	assert.equal(a?.tool, "plugin");
	assert.equal(a?.result, "correct");
	assert.equal(a?.toolCallId, "c1");
	assert.match(a!.questionText, /Fill the gap\./);
	assert.match(a!.questionText, /\[\[1\]\] = ma/);
	assert.match(a!.thinking ?? "", /mass times acceleration/);
});

test("a wrong flag reads as wrong; no flag reads as unmarked", () => {
	const answers = answeredQuestions(record([
		posed("c1", 1, "Q1", stem), answer("c1", 2, { blanks: ["G"] }, { correct: false }),
		posed("c2", 3, "Q2", stem), answer("c2", 4, { blanks: ["G"] }),
		posed("c3", 5, "Q3", stem), answer("c3", 6, { blanks: ["G"] }, { score: 3 }),
	]) as never);
	assert.deepEqual(answers.map(a => a.result), ["wrong", "unmarked", "unmarked"]);
});

const dismissal = (callId: string, minute: number) => result(callId, "fill_in_blank", { kind: "plugin-question-cancelled", occurrence: { toolCallId: callId }, reason: "dismissed" }, minute);

test("a request to ask it another way is not an attempt; a dismissal reads as dismissed, like a native one", () => {
	const answers = answeredQuestions(record([
		posed("c1", 1, "Q", stem), answer("c1", 2, { reformat: "graph" }, { reformat: "graph" }),
		posed("c2", 3, "Q", stem), dismissal("c2", 4),
	]) as never);
	assert.deepEqual(answers.map(a => [a.toolCallId, a.dismissed]), [["c2", true]]);
});

test("a dismissed plugin question closes its declaration, so a later undeclared answer isn't credited to it", () => {
	const declaration = { v: 1, id: "ev_000000000001", at: iso(1), prev: "0".repeat(64), type: "declare", chatId: "chat_test", ideas: ["n_a"], names: { n_a: "Name A" } } as unknown as LoggedEvent;
	const events = pendingEvents("chat_test", record([
		posed("c1", 2, "Q", stem), dismissal("c1", 3),
		posed("c2", 4, "Q2", { ...stem, text: "[[1]] = mg" }), answer("c2", 5, { blanks: ["W"] }, { correct: true }),
	]) as never, [declaration]);
	assert.equal(events.filter(e => e.type === "observed").length, 0);
});

test("each typed gap is its own quotable text, so separate one-word gaps can't make a three-word quote", () => {
	const texts = learnerTexts(record([posed("c1", 1, "Q", stem), answer("c1", 2, { blanks: ["force", "equals", "mass"] }, { correct: false })]) as never, 0);
	assert.deepEqual(texts.filter(t => t.field === "answer").map(t => t.text), ["force", "equals", "mass"]);
});

test("a different payload makes a different question text, so variants are told apart", () => {
	const answers = answeredQuestions(record([
		posed("c1", 1, "Fill the gap.", stem), answer("c1", 2, { blanks: ["F"] }, { correct: true }),
		posed("c2", 3, "Fill the gap.", { ...stem, text: "[[1]] = mg" }), answer("c2", 4, { blanks: ["W"] }, { correct: true }),
	]) as never);
	assert.notEqual(answers[0]!.questionText, answers[1]!.questionText);
});

test("the learner's typed answers can be quoted; a reformat request can't", () => {
	const texts = learnerTexts(record([
		user("hello", 0), posed("c1", 1, "Q", stem), answer("c1", 2, { blanks: ["mass times acceleration"] }, { correct: true }),
		posed("c2", 3, "Q", stem), answer("c2", 4, { reformat: "graph" }, { reformat: "graph" }),
	]) as never, 0);
	assert.deepEqual(texts.filter(t => t.field === "answer").map(t => t.text), ["mass times acceleration"]);
});

test("a declared idea is observed on a plugin answer, as format 'plugin'", () => {
	const declaration = { v: 1, id: "ev_000000000001", at: iso(1), prev: "0".repeat(64), type: "declare", chatId: "chat_test", ideas: ["n_a"], names: { n_a: "Name A" } } as unknown as LoggedEvent;
	const events = pendingEvents("chat_test", record([posed("c1", 2, "Fill the gap.", stem), answer("c1", 3, { blanks: ["F"] }, { correct: true })]) as never, [declaration]);
	const observed = events.filter((e): e is ObservedEvent => e.type === "observed");
	assert.equal(observed.length, 1);
	assert.equal(observed[0]!.question.format, "plugin");
	assert.equal(observed[0]!.answer.result, "correct");
});

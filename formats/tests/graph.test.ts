import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeGraph, graphViewport, validateGraphAnswer, validateGraphQuestion, type GraphPayload } from "../src/graph.ts";

const payload = (extra: Partial<GraphPayload> = {}): GraphPayload => ({
	options: [{ curves: ["x^2"] }, { curves: ["-x^2"] }, { curves: ["x^3"] }],
	correct: "A", why: "The shape is what matters here.", ...extra,
});
const errors = (p: GraphPayload) => (validateGraphQuestion(p) ?? []).join(" ");

test("a well-formed question passes validation", () => {
	assert.equal(validateGraphQuestion(payload()), undefined);
	assert.equal(validateGraphQuestion(payload({ x: [-2, 2], y: [-4, 4] })), undefined);
});

test("a correct letter beyond the options is refused", () => {
	assert.match(errors(payload({ correct: "D" })), /D/);
});

test("a curve that doesn't parse is refused, naming the option and the curve", () => {
	assert.match(errors(payload({ options: [{ curves: ["x^2"] }, { curves: ["sin x"] }] })), /Option B.*curve 1/);
});

test("broken ranges are refused", () => {
	assert.match(errors(payload({ x: [3, 3] })), /x range/);
	assert.match(errors(payload({ y: [5, -5] })), /y range/);
	assert.match(errors(payload({ x: [-1e9, 1e9] })), /x range/);
});

test("two options that draw the same curves are refused", () => {
	assert.match(errors(payload({ options: [{ curves: ["x^2"] }, { curves: [" x ^ 2 "] }] })), /A and B/);
});

test("grading compares the pick with the answer; a reformat request is just that", () => {
	assert.deepEqual(gradeGraph(payload({ correct: "B" }), { choice: "B" }), { correct: true, choice: "B", answer: "B" });
	assert.deepEqual(gradeGraph(payload({ correct: "B" }), { choice: "C" }), { correct: false, choice: "C", answer: "B" });
	assert.deepEqual(gradeGraph(payload(), { reformat: "blank" }), { reformat: "blank" });
});

test("a pick must be one of the options shown", () => {
	assert.match((validateGraphAnswer(payload(), { choice: "E" }) ?? []).join(" "), /E/);
	assert.equal(validateGraphAnswer(payload(), { choice: "C" }), undefined);
});

test("all options share one viewport that fits every curve", () => {
	const view = graphViewport(payload({ options: [{ curves: ["x^2"] }, { curves: ["x^2 + 10"] }] }));
	assert.deepEqual(view.x, [-5, 5]);
	assert.ok(view.y[0] < 1 && view.y[1] > 30, `${view.y}`);
	assert.deepEqual(graphViewport(payload({ x: [-2, 2], y: [-1, 1] })), { x: [-2, 2], y: [-1, 1] });
});

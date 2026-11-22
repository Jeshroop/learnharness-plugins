import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeBlank, validateBlankAnswer, type BlankPayload } from "../src/blank.ts";
import { readReformat, reformatAnswerSchema, reformatChoices } from "../src/formats.ts";
import { gradeGraph, validateGraphAnswer, type GraphPayload } from "../src/graph.ts";

const blank: BlankPayload = { text: "[[1]]", blanks: [{ accept: ["x"] }], why: "w" };
const graph: GraphPayload = { options: [{ curves: ["x"] }, { curves: ["-x"] }], correct: "A", why: "w" };

test("each card offers the other three formats", () => {
	assert.deepEqual(reformatChoices("blank").map(c => c.id), ["multiple-choice", "written", "graph"]);
	assert.deepEqual(reformatChoices("graph").map(c => c.id), ["multiple-choice", "written", "blank"]);
	assert.deepEqual([...reformatAnswerSchema("graph").properties.reformat.enum], ["multiple-choice", "written", "blank"]);
});

test("only a known format reads as a reformat request", () => {
	assert.equal(readReformat({ reformat: "blank" }), "blank");
	assert.equal(readReformat({ reformat: "essay" }), undefined);
	assert.equal(readReformat({ blanks: ["x"] }), undefined);
	assert.equal(readReformat(null), undefined);
});

test("asking for the format the card already is gets refused", () => {
	assert.match((validateBlankAnswer(blank, { reformat: "blank" }) ?? []).join(" "), /already/i);
	assert.match((validateGraphAnswer(graph, { reformat: "graph" }) ?? []).join(" "), /already/i);
});

test("a reformat request is never graded right or wrong", () => {
	assert.equal("correct" in gradeBlank(blank, { reformat: "written" }), false);
	assert.equal("correct" in gradeGraph(graph, { reformat: "multiple-choice" }), false);
});

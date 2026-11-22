import { test } from "node:test";
import assert from "node:assert/strict";
import { filledLabel, gapLabel, gradeBlank, matches, stemMarkdown, validateBlankAnswer, validateBlankQuestion, type BlankPayload } from "../src/blank.ts";

const payload = (text: string, count = 2): BlankPayload => ({
	text, why: "Recall the exact law.",
	blanks: Array.from({ length: count }, () => ({ accept: ["x"] })),
});

test("a well-formed question passes validation", () => {
	assert.equal(validateBlankQuestion(payload("Force equals [[1]] times [[2]].")), undefined);
	assert.equal(validateBlankQuestion(payload("$F = ma$ where [[1]] is mass and [[2]] is acceleration.")), undefined);
});

test("missing, duplicated, extra and in-maths gaps are refused with a reason", () => {
	assert.match(validateBlankQuestion(payload("Force equals [[1]].", 2))!.join(" "), /\[\[2\]\]/);
	assert.match(validateBlankQuestion(payload("[[1]] and [[1]] and [[2]]."))!.join(" "), /once/);
	assert.match(validateBlankQuestion(payload("[[1]] [[2]] [[3]]."))!.join(" "), /\[\[3\]\]/);
	assert.match(validateBlankQuestion(payload("The value $x = [[1]]$ and [[2]]."))!.join(" "), /outside/i);
	assert.match(validateBlankQuestion(payload("$$v^2 = u^2 + [[1]]$$ then [[2]]."))!.join(" "), /outside/i);
});

test("numbers match by value, within tolerance", () => {
	for (const given of ["0.5", "1/2", ".5", "5e-1", " 0.50 "]) assert.equal(matches(given, ["0.5"]), true, given);
	assert.equal(matches("−3", ["-3"]), true);
	assert.equal(matches("9.81", ["9.8"], 0.05), true);
	assert.equal(matches("9.9", ["9.8"], 0.05), false);
	assert.equal(matches("0.51", ["0.5"]), false);
});

test("words ignore case, spacing and a trailing full stop, but not spelling", () => {
	assert.equal(matches("  Newton's   Second law. ", ["newton's second law"]), true);
	assert.equal(matches("kinetic", ["Kinetic energy", "kinetic"]), true);
	assert.equal(matches("Newtons second law", ["newton's second law"]), false);
	assert.equal(matches("", ["x"]), false);
});

test("equivalent forms a learner would reasonably type are accepted", () => {
	const same: [string, string][] = [
		["F=ma", "F = ma"], ["v = u+at", "v = u + at"], ["newton’s second law", "newton's second law"],
		["3×10^8", "3e8"], ["3 x 10^8", "3e8"], ["3*10^8", "3e8"], ["3e8", "3×10^8"], ["½", "0.5"], ["2.5 × 10^-3", "0.0025"],
	];
	for (const [given, accepted] of same) assert.equal(matches(given, [accepted]), true, `${given} ~ ${accepted}`);
	assert.equal(matches("kineticenergy", ["kinetic energy"]), false, "spacing between words still matters");
	assert.equal(matches("F=mv", ["F = ma"]), false);
});

test("grading reports each gap and the whole", () => {
	const p: BlankPayload = { text: "[[1]] [[2]]", why: "w", blanks: [{ accept: ["mass"] }, { accept: ["9.8"], tolerance: 0.1 }] };
	assert.deepEqual(gradeBlank(p, { blanks: ["Mass", "9.81"] }), { correct: true, blanks: [{ given: "Mass", correct: true }, { given: "9.81", correct: true }] });
	assert.deepEqual(gradeBlank(p, { blanks: ["weight", "9.81"] }), { correct: false, blanks: [{ given: "weight", correct: false }, { given: "9.81", correct: true }] });
});

test("a request to ask it another way is graded as just that — never right or wrong", () => {
	const p = payload("[[1]] [[2]]");
	assert.deepEqual(gradeBlank(p, { reformat: "graph" }), { reformat: "graph" });
	assert.equal(validateBlankAnswer(p, { reformat: "multiple-choice" }), undefined);
});

test("an answer must fill every gap the question has", () => {
	assert.match(validateBlankAnswer(payload("[[1]] [[2]]"), { blanks: ["only one"] })!.join(" "), /2/);
	assert.equal(validateBlankAnswer(payload("[[1]] [[2]]"), { blanks: ["a", "b"] }), undefined);
});

test("gaps inside \\(…\\), \\[…\\], code or spaced $…$ maths are refused too", () => {
	for (const text of ["Then \\(v = [[1]]t\\) and [[2]].", "\\[s = [[1]]\\] then [[2]].", "Run `x = [[1]]` and [[2]].", "It costs $5 or [[1]] for $10 and [[2]]."]) {
		assert.match(validateBlankQuestion(payload(text))!.join(" "), /outside/i, text);
	}
});

test("gap labels and filled answers are code spans, safe next to letters and backticks", () => {
	assert.equal(gapLabel(1), "`[ 1 ]`");
	assert.equal(filledLabel("mass"), "`mass`");
	assert.equal(filledLabel("a`b"), "``a`b``");
	assert.equal(filledLabel("`x"), "`` `x ``");
	assert.equal(filledLabel("   "), "`—`");
});

test("the stem shows each gap with its label and leaves the rest alone", () => {
	assert.equal(stemMarkdown("F = [[1]] × [[2]].", k => `(${k})`), "F = (1) × (2).");
});

// Fill in the blank: the contract the tutor writes to, its validation and its grading.
import { readReformat, reformatAnswerSchema } from "./formats.ts";

export const BLANK_TYPE_ID = "blank";
export interface BlankGap { accept: string[]; tolerance?: number; hint?: string }
export interface BlankPayload { text: string; blanks: BlankGap[]; why: string }
export type BlankAnswer = { blanks: string[] } | { reformat: string };
export type BlankGrade = { correct: boolean; blanks: { given: string; correct: boolean }[] } | { reformat: string };

const MARKER = /\[\[(\d+)\]\]/g;
const MAX_GAPS = 8;

const TEACH = [
	"Ask a fill-in-the-blank question: a statement with numbered gaps the learner types into.",
	"Best for recalling exact terms, values, formulas, units or steps.",
	"`question` is a short instruction shown above it (e.g. \"Fill in the gaps.\").",
	"payload.text is Markdown with each gap written as [[1]], [[2]], … in order — keep gaps outside $…$ maths.",
	"payload.blanks gives, for each gap in order, the accepted answers and an optional short hint shown in the gap. List every equivalent form you'd accept (other wordings, symbols, units);",
	"case, spacing around symbols and between a number and its unit, curly quotes, superscripts (10⁸, m/s²), a×10^n, fractions and mixed numbers (1 1/2) are matched automatically, and numbers match by value (add tolerance for rounded values).",
	"payload.why is one line saying why this format suits this question; it is shown on the card.",
	"Accepted answers stay hidden until the learner answers.",
].join(" ");
const PROBE = [
	"Probe what the learner already knows with a fill-in-the-blank question (numbered gaps they type into).",
	"payload.text is Markdown with gaps [[1]], [[2]], … outside $…$ maths; payload.blanks lists accepted answers per gap",
	"(numbers match by value; optional tolerance and hint); payload.why is one line on why this format fits.",
].join(" ");

export const blankDefinition = {
	id: BLANK_TYPE_ID,
	label: "Fill in the blank",
	contractVersion: 1,
	showThinking: true,
	questionSchema: {
		type: "object", additionalProperties: false, required: ["text", "blanks", "why"],
		properties: {
			text: { type: "string", pattern: "\\S", description: "Markdown with gaps written [[1]], [[2]], … in order, outside $…$ maths." },
			blanks: {
				type: "array", minItems: 1, maxItems: MAX_GAPS,
				description: "One entry per gap, in order.",
				items: {
					type: "object", additionalProperties: false, required: ["accept"],
					properties: {
						accept: { type: "array", minItems: 1, items: { type: "string", pattern: "\\S" }, description: "Accepted answers; numbers match by value." },
						tolerance: { type: "number", minimum: 0, description: "Optional absolute tolerance for numeric answers." },
						hint: { type: "string", description: "Optional short hint shown in the gap, e.g. 'a number' or 'unit'." },
					},
				},
			},
			why: { type: "string", pattern: "\\S", description: "One line: why this format suits the question (shown on the card)." },
		},
	},
	answerSchema: {
		anyOf: [
			{ type: "object", additionalProperties: false, required: ["blanks"], properties: { blanks: { type: "array", items: { type: "string" } } } },
			reformatAnswerSchema("blank"),
		],
	},
	teach: { toolName: "fill_in_blank", description: TEACH },
	probe: { toolName: "probe_fill_in_blank", description: PROBE },
} as const;

/** Spans the host renders as maths or code ($$…$$, \[…\], \(…\), `code`, $…$ even with spaces),
 *  so gaps inside them can be refused. */
function protectedSpans(text: string): [number, number][] {
	const spans: [number, number][] = [];
	const pattern = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(`+)[\s\S]*?\1|(?<!\\)\$[^$\n]+?(?<!\\)\$/g;
	for (let match = pattern.exec(text); match; match = pattern.exec(text)) spans.push([match.index, match.index + match[0].length]);
	return spans;
}

export function validateBlankQuestion(payload: BlankPayload): string[] | undefined {
	const errors: string[] = [];
	const count = payload.blanks.length;
	const seen = new Map<number, number>();
	const protectedText = protectedSpans(payload.text);
	for (const match of payload.text.matchAll(MARKER)) {
		const k = Number(match[1]);
		seen.set(k, (seen.get(k) ?? 0) + 1);
		if (protectedText.some(([start, end]) => match.index! >= start && match.index! < end)) {
			errors.push(`Gap [[${k}]] is inside maths or code — keep gaps outside $…$, \\(…\\) and \`code\` (put the gap next to the formula; escape a literal dollar as \\$).`);
		}
	}
	for (let k = 1; k <= count; k++) {
		const times = seen.get(k) ?? 0;
		if (times === 0) errors.push(`payload.text has no [[${k}]] for gap ${k} of ${count}.`);
		else if (times > 1) errors.push(`Gap [[${k}]] appears ${times} times; use each gap once.`);
	}
	for (const k of seen.keys()) if (k < 1 || k > count) errors.push(`payload.text has [[${k}]] but payload.blanks has ${count} entr${count === 1 ? "y" : "ies"}.`);
	return errors.length ? errors : undefined;
}

export function validateBlankAnswer(payload: BlankPayload, answer: BlankAnswer): string[] | undefined {
	if ("reformat" in answer) return answer.reformat === BLANK_TYPE_ID ? ["This is already a fill-in-the-blank question."] : undefined;
	return answer.blanks.length === payload.blanks.length ? undefined : [`Expected ${payload.blanks.length} answers, one per gap; got ${answer.blanks.length}.`];
}

/** Case, spacing, curly quotes, unicode minus and a trailing full stop don't matter; spacing next to
 *  symbols doesn't either ("F = ma" is "F=ma"), but spacing between words does ("kinetic energy"). */
const SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const normalizeText = (value: string) => value
	// Before NFKC, which would turn 10⁸ into 108 and 1½ into 11⁄2: superscripts become ^ powers,
	// and a digit before a fraction sign gets a space (a mixed number).
	.replace(/[⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, run => `^${[...run].map(c => (c === "⁻" ? "-" : c === "⁺" ? "+" : String(SUPERSCRIPTS.indexOf(c)))).join("")}`)
	.replace(/(\d)([¼½¾\u2150-\u215E])/g, "$1 $2")
	.normalize("NFKC")
	.replace(/[‘’‛′]/g, "'").replace(/[“”‟″]/g, "\"").replace(/[−–—]/g, "-").replace(/⁄/g, "/")
	.replace(/\s+/g, " ").trim().replace(/[.。]+$/, "")
	.replace(/\s*([^\p{L}\p{N}\s])\s*/gu, "$1")
	// "9.8 m" is "9.8m": a number and its unit; a space between digits stays (1 1/2, 1 000).
	.replace(/(\p{N}) (?=\p{L})/gu, "$1")
	.toLowerCase();

function parseNumber(value: string): number {
	const text = normalizeText(value);
	const mixed = /^([+-]?)(\d+) (\d+)\/(\d+)$/.exec(text);
	if (mixed) return (mixed[1] === "-" ? -1 : 1) * (Number(mixed[2]) + Number(mixed[3]) / Number(mixed[4]));
	const compact = text.replace(/\s+/g, "");
	const scientific = /^(?:([+-]?(?:\d+\.?\d*|\.\d+))[×x*·])?10\^([+-]?\d+)$/.exec(compact);
	if (scientific) return Number(scientific[1] ?? 1) * 10 ** Number(scientific[2]);
	const fraction = /^([+-]?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(compact);
	if (fraction) return Number(fraction[1]) / Number(fraction[2]);
	return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/.test(compact) ? Number(compact) : Number.NaN;
}

/** Numbers match by value (within tolerance, else a tight relative margin); words ignore case, spacing and a trailing full stop. */
export function matches(given: string, accept: readonly string[], tolerance?: number): boolean {
	if (given.trim() === "") return false;
	const number = parseNumber(given);
	return accept.some(candidate => {
		const target = parseNumber(candidate);
		if (Number.isFinite(number) && Number.isFinite(target)) return Math.abs(number - target) <= (tolerance ?? 1e-9 * Math.max(1, Math.abs(target)));
		return normalizeText(given) === normalizeText(candidate);
	});
}

export function gradeBlank(payload: BlankPayload, answer: BlankAnswer): BlankGrade {
	const reformat = readReformat(answer);
	if (reformat) return { reformat };
	const given = "blanks" in answer ? answer.blanks : [];
	const blanks = payload.blanks.map((gap, i) => {
		const value = given[i] ?? "";
		return { given: value, correct: matches(value, gap.accept, gap.tolerance) };
	});
	return { correct: blanks.every(b => b.correct), blanks };
}

/** A code span holding `text` literally: the fence is longer than any backtick run inside, padded
 *  when the text starts or ends with a backtick. Code spans stay intact next to letters and digits. */
function codeSpan(text: string): string {
	const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length));
	const fence = "`".repeat(longest + 1);
	const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
	return `${fence}${pad}${text}${pad}${fence}`;
}
/** How a gap shows on the question card. */
export const gapLabel = (k: number): string => codeSpan(`[ ${k} ]`);
/** How a learner's answer shows in the answered card ("—" for an empty gap). */
export const filledLabel = (given: string): string => codeSpan(given.trim() || "—");

/** The statement with each [[k]] replaced by `label(k)` (the cards' gap labels or filled answers). */
export function stemMarkdown(text: string, label: (k: number) => string): string {
	return text.replace(MARKER, (_whole, k: string) => label(Number(k)));
}

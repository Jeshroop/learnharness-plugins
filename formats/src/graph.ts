// Choose the graph: the contract the tutor writes to, its validation, grading and shared viewport.
import { compile } from "./expr.ts";
import { readReformat, reformatAnswerSchema } from "./formats.ts";
import { fitY, SAMPLES, samplePaths, type Path } from "./plot.ts";

export const GRAPH_TYPE_ID = "graph";
export const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
export const DEFAULT_X: [number, number] = [-5, 5];
const MAX_RANGE = 1e6;

export interface GraphPayload { options: { curves: string[] }[]; correct: string; x?: [number, number]; y?: [number, number]; why: string }
export type GraphAnswer = { choice: string } | { reformat: string };
export type GraphGrade = { correct: boolean; choice: string; answer: string } | { reformat: string };

const TEACH = [
	"Ask the learner to choose which graph matches: 2–6 small plots drawn from your formulas.",
	"Best for the shape of a function, transformations, roots and turning points, asymptotes, or matching an equation to its sketch.",
	"`question` says what to match (e.g. \"Which graph shows y = (x − 1)(x + 2)?\").",
	"payload.options lists each option's curves as y = f(x) in plain maths with x as the variable: 'x^2 - 3x + 2', 'sin(2x)', '1/(x-1)', 'abs(x)', 'e^x', 'ln(x)', 'sqrt(x)', 'cbrt(x)'",
	"(brackets after functions, around exponents that contain x: 'e^(-2x)', not 'e^-2x', and around what is divided: '1/(2x)', not '1/2x').",
	"payload.correct is the letter of the matching option (A = first). Optional payload.x and payload.y set the shared view range (default x from -5 to 5, y fitted).",
	"payload.why is one line saying why this format suits this question; it is shown on the card.",
	"Make the wrong options plausible (a sign error, a shift, a reflection). The answer stays hidden until the learner picks.",
].join(" ");
const PROBE = [
	"Probe what the learner already knows by asking which of 2–6 plotted graphs matches a description or equation.",
	"payload.options: curves as y = f(x) in plain maths (x as the variable, brackets after functions); payload.correct: the matching letter;",
	"optional payload.x / payload.y view ranges; payload.why: one line on why this format fits.",
].join(" ");

const rangeSchema = (axis: string) => ({ type: "array", minItems: 2, maxItems: 2, items: { type: "number" }, description: `Optional shared ${axis} range [min, max].` });

export const graphDefinition = {
	id: GRAPH_TYPE_ID,
	label: "Choose the graph",
	contractVersion: 1,
	showThinking: true,
	questionSchema: {
		type: "object", additionalProperties: false, required: ["options", "correct", "why"],
		properties: {
			options: {
				type: "array", minItems: 2, maxItems: LETTERS.length,
				description: "The options, shown as A, B, C… in this order.",
				items: {
					type: "object", additionalProperties: false, required: ["curves"],
					properties: { curves: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", pattern: "\\S" }, description: "Curves drawn in this option, each y = f(x)." } },
				},
			},
			correct: { type: "string", enum: [...LETTERS], description: "Letter of the matching option (hidden until answered)." },
			x: rangeSchema("x"),
			y: rangeSchema("y"),
			why: { type: "string", pattern: "\\S", description: "One line: why this format suits the question (shown on the card)." },
		},
	},
	answerSchema: {
		anyOf: [
			{ type: "object", additionalProperties: false, required: ["choice"], properties: { choice: { type: "string", enum: [...LETTERS] } } },
			reformatAnswerSchema("graph"),
		],
	},
	teach: { toolName: "choose_graph", description: TEACH },
	probe: { toolName: "probe_choose_graph", description: PROBE },
} as const;

function checkRange(axis: "x" | "y", range: [number, number] | undefined, errors: string[]): void {
	if (!range) return;
	const [min, max] = range;
	if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max)) errors.push(`The ${axis} range must be [min, max] with min below max.`);
	else if (Math.abs(min) > MAX_RANGE || Math.abs(max) > MAX_RANGE || max - min < 1e-6) errors.push(`The ${axis} range must lie within ±${MAX_RANGE} and span more than 0.000001.`);
}

const canonical = (curves: string[]) => curves.map(c => c.replace(/\s+/g, "").toLowerCase()).sort().join("|");

export function validateGraphQuestion(payload: GraphPayload): string[] | undefined {
	const errors: string[] = [];
	const index = LETTERS.indexOf(payload.correct as (typeof LETTERS)[number]);
	if (index < 0 || index >= payload.options.length) errors.push(`payload.correct is ${payload.correct}, but there ${payload.options.length === 1 ? "is" : "are"} only ${payload.options.length} options (A–${LETTERS[payload.options.length - 1]}).`);
	payload.options.forEach((option, o) => option.curves.forEach((curve, c) => {
		const compiled = compile(curve);
		if (!compiled.ok) errors.push(`Option ${LETTERS[o]}, curve ${c + 1} ("${curve}"): ${compiled.error}`);
	}));
	const compiled = errors.length === 0 || errors.every(e => !e.startsWith("Option "));
	const seen = new Map<string, number>(), repeated = new Set<number>();
	payload.options.forEach((option, o) => {
		const key = canonical(option.curves);
		const first = seen.get(key);
		if (first !== undefined) { errors.push(`Options ${LETTERS[first]} and ${LETTERS[o]} draw the same curves.`); repeated.add(o); }
		else seen.set(key, o);
	});
	const before = errors.length;
	checkRange("x", payload.x, errors);
	checkRange("y", payload.y, errors);
	if (compiled && errors.length === before) checkDrawn(payload, repeated, errors);
	return errors.length ? errors : undefined;
}

/** What the learner will see: every option draws something inside the shared view, and no two options
 *  draw the same graph in different words (2x and x + x, abs(x) and sqrt(x^2)). */
function checkDrawn(payload: GraphPayload, repeated: ReadonlySet<number>, errors: string[]): void {
	const view = graphViewport(payload);
	const span = view.y[1] - view.y[0];
	optionPaths(payload, view.x, view.y).forEach((paths, o) => {
		const visible = paths.some(path => path.length > 1 && path.some(([, y]) => y >= view.y[0] && y <= view.y[1]));
		if (!visible) errors.push(`Option ${LETTERS[o]} draws nothing inside the view (x from ${view.x[0]} to ${view.x[1]}${payload.y ? `, y from ${view.y[0]} to ${view.y[1]}` : ""}).`);
	});
	const signature = (curve: string) => {
		const result = compile(curve);
		if (!result.ok) return curve;
		const values: string[] = [];
		for (let i = 0; i <= SAMPLES; i++) {
			let y: number;
			try { y = result.fn(view.x[0] + ((view.x[1] - view.x[0]) * i) / SAMPLES); } catch { y = Number.NaN; }
			values.push(Number.isFinite(y) ? String(Math.round(((y - view.y[0]) / span) * 1e6)) : "-");
		}
		return values.join(",");
	};
	const seen = new Map<string, number>();
	payload.options.forEach((option, o) => {
		const key = option.curves.map(signature).sort().join("|");
		const first = seen.get(key);
		if (first === undefined) seen.set(key, o);
		else if (!repeated.has(o)) errors.push(`Options ${LETTERS[first]} and ${LETTERS[o]} draw the same graph.`);
	});
}

export function validateGraphAnswer(payload: GraphPayload, answer: GraphAnswer): string[] | undefined {
	if ("reformat" in answer) return answer.reformat === GRAPH_TYPE_ID ? ["This is already a choose-the-graph question."] : undefined;
	const index = LETTERS.indexOf(answer.choice as (typeof LETTERS)[number]);
	return index >= 0 && index < payload.options.length ? undefined : [`${answer.choice} is not one of the ${payload.options.length} options.`];
}

export function gradeGraph(payload: GraphPayload, answer: GraphAnswer): GraphGrade {
	const reformat = readReformat(answer);
	if (reformat) return { reformat };
	const choice = "choice" in answer ? answer.choice : "";
	return { correct: choice === payload.correct, choice, answer: payload.correct };
}

/** Each option's sampled curves (unparseable curves are skipped). */
export function optionPaths(payload: GraphPayload, x: [number, number], y?: [number, number]): Path[][] {
	return payload.options.map(option => option.curves.flatMap(curve => {
		const compiled = compile(curve);
		return compiled.ok ? samplePaths(compiled.fn, x, undefined, y) : [];
	}));
}

/** One view for every option, so shapes compare fairly. */
export function graphViewport(payload: GraphPayload): { x: [number, number]; y: [number, number] } {
	const x = payload.x ?? DEFAULT_X;
	return { x, y: payload.y ?? fitY(optionPaths(payload, x).flat()) };
}

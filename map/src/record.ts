// Read what happened in a chat from its stored record. Raw messages are narrowed
// by hand (no host imports): old records and odd shapes must read safely.
import { createHash } from "node:crypto";

export interface RecordLike { messages: readonly unknown[] }

export interface AnsweredQuestion {
	toolCallId: string;
	messageId: string;
	/** "plugin": another plugin's question type (e.g. Formats' fill in the blank), graded by its `correct` flag. */
	tool: "quiz" | "explain" | "plugin";
	/** ms since epoch */
	answeredAt: number;
	dismissed: boolean;
	questionText: string;
	options?: string[];
	picks: string[];
	result: "correct" | "wrong" | "dontKnow" | "unmarked";
	wordsOnly: boolean;
	thinking?: string;
	text?: string;
	confidence?: number;
}

export interface ProblemRun {
	toolCallId: string;
	posedAt: number;
	statement: string;
	target: string[];
	working: { messageId: string; at: number; text: string }[];
	/** messageId: the conclude result (or dismissal marker) — the attempt's anchor. */
	conclusion?: { outcome: string; rung: string | null; at: number; messageId: string };
}

export interface LearnerText {
	messageId: string;
	at: number;
	field: "message" | "working" | "thinking" | "text" | "other" | "readingThinking" | "answer";
	text: string;
}

export interface FoundQuote { source: LearnerText; start: number; end: number; text: string; sha256: string }

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null);
const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const nonEmpty = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value : undefined);
const stamp = (m: Obj) => (typeof m.timestamp === "number" ? m.timestamp : 0);
const time = (iso: unknown, fallback: number) => {
	const parsed = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
	return Number.isNaN(parsed) ? fallback : parsed;
};
const labels = (list: unknown) => (Array.isArray(list) ? list.map(item => str(obj(item)?.label)).filter((l): l is string => !!l) : []);
const TEACHING = new Set(["quiz", "explain"]);
export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Stable JSON (sorted keys), so the same payload always reads the same. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	const o = obj(value);
	if (o) return `{${Object.keys(o).sort().map(key => `${JSON.stringify(key)}:${canonical(o[key])}`).join(",")}}`;
	return JSON.stringify(value) ?? "null";
}
/** Every string a learner typed into a plugin answer, one per line. */
function typedText(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(typedText).filter(Boolean).join("\n");
	const o = obj(value);
	return o ? Object.values(o).map(typedText).filter(Boolean).join("\n") : "";
}
const isReformat = (d: Obj) => obj(d.answer)?.reformat !== undefined || obj(obj(d.grading)?.result)?.reformat !== undefined;

/** Plugin questions posed so far: toolCallId → the prompt and payload the tutor wrote. */
function notePosed(m: Obj, posed: Map<string, { questionId: string; question: string; payload: unknown }>): void {
	const questions = obj(m.lhQuestions);
	if (m.role !== "assistant" || !questions) return;
	for (const value of Object.values(questions)) {
		const q = obj(value), input = obj(q?.input), callId = str(obj(q?.occurrence)?.toolCallId), questionId = str(q?.questionId);
		if (q && input && callId && questionId) posed.set(callId, { questionId, question: str(input.question) ?? "", payload: input.payload });
	}
}

/** Answered questions in record order: native quiz/explain, and other plugins' question types. */
export function answeredQuestions(record: RecordLike): AnsweredQuestion[] {
	const answers: AnsweredQuestion[] = [];
	const posed = new Map<string, { questionId: string; question: string; payload: unknown }>();
	for (const raw of record.messages) {
		const m = obj(raw);
		if (m) notePosed(m, posed);
		if (!m || m.role !== "toolResult" || m.isError === true) continue;
		const tool = str(m.toolName), toolCallId = str(m.toolCallId), messageId = str(m.id), d = obj(m.details);
		if (d?.kind === "plugin-question" && toolCallId && messageId) {
			const question = posed.get(toolCallId);
			if (!question || (str(d.questionId) && d.questionId !== question.questionId) || isReformat(d)) continue;
			const graded = obj(obj(d.grading)?.result);
			const text = typedText(d.answer);
			answers.push({
				toolCallId, messageId, tool: "plugin", answeredAt: time(d.answeredAt, stamp(m)), dismissed: false,
				questionText: `${question.question}\n${canonical(question.payload)}`.trim(),
				picks: [], result: graded?.correct === true ? "correct" : graded?.correct === false ? "wrong" : "unmarked", wordsOnly: false,
				...(nonEmpty(d.thinking) ? { thinking: nonEmpty(d.thinking) } : {}),
				...(nonEmpty(text) ? { text } : {}),
			});
			continue;
		}
		if (!tool || !TEACHING.has(tool) || !toolCallId || !messageId || !d) continue;
		const wordsOnly = d.wordsOnly === true;
		const result: AnsweredQuestion["result"] = d.dontKnow === true ? "dontKnow"
			: wordsOnly || tool === "explain" ? "unmarked"
			: d.correct === true ? "correct" : d.correct === false ? "wrong" : "unmarked";
		answers.push({
			toolCallId, messageId, tool: tool as AnsweredQuestion["tool"],
			answeredAt: time(d.answeredAt, stamp(m)), dismissed: d.dismissed === true,
			questionText: str(d.questionText) ?? "",
			...(Array.isArray(d.options) ? { options: labels(d.options) } : {}),
			picks: labels(d.answers), result, wordsOnly,
			...(nonEmpty(d.thinking) ?? nonEmpty(d.note) ? { thinking: nonEmpty(d.thinking) ?? nonEmpty(d.note) } : {}),
			...(nonEmpty(d.text) ? { text: nonEmpty(d.text) } : {}),
			...(typeof d.confidence === "number" ? { confidence: d.confidence } : {}),
		});
	}
	return answers;
}

/** Native practice problems: pose → working → conclusion (or dismissal). */
export function problemRuns(record: RecordLike): ProblemRun[] {
	const calls = new Map<string, { name: string; args: Obj }>();
	const runs = new Map<string, ProblemRun>();
	let active: ProblemRun | null = null;
	for (const raw of record.messages) {
		const m = obj(raw);
		if (!m) continue;
		if (m.role === "assistant" && Array.isArray(m.content)) {
			for (const block of m.content) {
				const b = obj(block);
				const callId = str(b?.id), name = str(b?.name);
				if (b?.type === "toolCall" && callId && name) calls.set(callId, { name, args: obj(b.arguments) ?? {} });
			}
		} else if (m.role === "toolResult" && m.isError !== true) {
			const callId = str(m.toolCallId);
			const known = callId ? calls.get(callId) : undefined;
			if (!callId || !known) continue;
			if (known.name === "problem") {
				const target = Array.isArray(known.args.target) ? known.args.target.filter((t): t is string => typeof t === "string") : [];
				active = { toolCallId: callId, posedAt: stamp(m), statement: str(known.args.statement) ?? "", target, working: [] };
				runs.set(callId, active);
			} else if (known.name === "conclude" && active && !active.conclusion) {
				active.conclusion = { outcome: str(known.args.outcome) ?? "unknown", rung: str(known.args.rung) ?? null, at: stamp(m), messageId: str(m.id) ?? "" };
				active = null;
			}
		} else if (m.role === "custom") {
			const d = obj(m.details), run = runs.get(str(d?.problemCallId) ?? "");
			if (!run) continue;
			if (m.customType === "practice-thinking" && typeof d?.text === "string" && typeof m.id === "string") {
				run.working.push({ messageId: m.id, at: stamp(m), text: d.text });
			} else if (m.customType === "problem-dismissed" && !run.conclusion) {
				run.conclusion = { outcome: "dismissed", rung: null, at: stamp(m), messageId: str(m.id) ?? "" };
				if (active === run) active = null;
			}
		}
	}
	return [...runs.values()];
}

/** Everything he wrote at or after `sinceMs`, oldest first. */
export function learnerTexts(record: RecordLike, sinceMs: number): LearnerText[] {
	const texts: LearnerText[] = [];
	const push = (messageId: unknown, at: number, field: LearnerText["field"], text: unknown) => {
		if (typeof messageId === "string" && typeof text === "string" && text.trim() !== "" && at >= sinceMs) texts.push({ messageId, at, field, text });
	};
	for (const raw of record.messages) {
		const m = obj(raw);
		if (!m) continue;
		if (m.role === "user") {
			const content = typeof m.content === "string" ? m.content
				: Array.isArray(m.content) ? m.content.map(b => (obj(b)?.type === "text" ? str(obj(b)?.text) ?? "" : "")).filter(Boolean).join("\n") : "";
			push(m.id, stamp(m), "message", content);
		} else if (m.role === "custom" && m.customType === "practice-thinking") {
			push(m.id, stamp(m), "working", obj(m.details)?.text);
		} else if (m.role === "toolResult" && m.isError !== true) {
			const d = obj(m.details);
			if (!d || typeof d.answeredAt !== "string") continue;
			const when = time(d.answeredAt, stamp(m));
			push(m.id, when, "thinking", nonEmpty(d.thinking) ?? nonEmpty(d.note));
			push(m.id, when, "text", d.text);
			push(m.id, when, "other", d.other);
			push(m.id, when, "readingThinking", d.readingThinking);
			if (d.kind === "plugin-question" && !isReformat(d)) push(m.id, when, "answer", typedText(d.answer));
		}
	}
	return texts.sort((a, b) => a.at - b.at);
}

/** Collapse whitespace runs, remembering each kept character's original index. */
function normalise(text: string): { norm: string; map: number[] } {
	let norm = "";
	const map: number[] = [];
	let inSpace = false;
	for (let index = 0; index < text.length; index++) {
		const char = text[index]!;
		if (/\s/.test(char)) {
			if (!inSpace) { norm += " "; map.push(index); inSpace = true; }
		} else {
			norm += char; map.push(index); inSpace = false;
		}
	}
	return { norm, map };
}

/** Locate his words (whitespace-insensitive) and return the ORIGINAL span. */
export function findQuote(texts: readonly LearnerText[], quote: string): FoundQuote | null {
	const wanted = normalise(quote.trim()).norm;
	if (!wanted) return null;
	for (const source of texts) {
		const { norm, map } = normalise(source.text);
		const found = norm.indexOf(wanted);
		if (found < 0) continue;
		const start = map[found]!, end = map[found + wanted.length - 1]! + 1;
		const text = source.text.slice(start, end);
		return { source, start, end, text, sha256: sha256(text) };
	}
	return null;
}

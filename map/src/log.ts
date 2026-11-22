// The evidence log: one JSON event per line, append-only, each line carrying
// the sha256 of the line before it. Nothing here ever rewrites a byte.
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { LoggedEvent, NewEvent } from "./events.ts";

const ZEROS = "0".repeat(64);
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export interface EvidenceLog {
	append(event: NewEvent): Promise<LoggedEvent>;
	read(): { events: LoggedEvent[]; damage: { line: number; reason: string }[] };
	verify(): { ok: true } | { ok: false; firstBreak: number };
}

type Obj = Record<string, unknown>;
const isString = (value: unknown): value is string => typeof value === "string";
const isTime = (value: unknown) => isString(value) && !Number.isNaN(Date.parse(value));
const isStringArray = (value: unknown) => Array.isArray(value) && value.every(isString);
const isObject = (value: unknown): value is Obj => !!value && typeof value === "object" && !Array.isArray(value);
const optional = (value: unknown, check: (v: unknown) => boolean) => value === undefined || check(value);
const RESULT = new Set(["correct", "wrong", "dontKnow"]);

const validVerdict = (v: unknown) => isObject(v) && isString(v.idea) && RESULT.has(v.result as string) && typeof v.variant === "boolean" && optional(v.hinted, h => h === true);
const validQuote = (q: unknown) => isObject(q) && (q.kind === "reasoning" || q.kind === "confidence") && isStringArray(q.shows)
	&& isString(q.text) && isString(q.sha256) && isObject(q.source) && isString(q.source.messageId) && isTime(q.source.at);
function validObserved(e: Obj): boolean {
	const source = e.source, question = e.question, answer = e.answer;
	return isString(e.chatId) && isString(e.sourceKey) && isStringArray(e.ideas) && isObject(e.names) && isTime(e.posedAt)
		&& isObject(source) && (source.kind === "question" || source.kind === "problem") && isString(source.toolCallId) && isString(source.messageId)
		&& isObject(question) && isString(question.text) && isString(question.format)
		&& isObject(answer) && (RESULT.has(answer.result as string) || answer.result === "unmarked") && typeof answer.hinted === "boolean" && isTime(answer.answeredAt)
		&& optional(answer.picks, isStringArray) && optional(answer.working, isStringArray) && optional(answer.confidence, v => typeof v === "number");
}

/** Why a parsed line is not a usable event, or null when it is one. Every
 *  field the rule and reconcile read is checked here, so a malformed line
 *  becomes reported damage instead of a crash. */
function problem(value: unknown): string | null {
	if (!isObject(value)) return "not an object";
	const e = value;
	if (e.v !== 1) return "unknown version";
	if (!isString(e.id) || !/^ev_[0-9a-f]{12}$/.test(e.id)) return "bad id";
	if (!isTime(e.at)) return "bad time";
	if (!isString(e.prev) || !/^[0-9a-f]{64}$/.test(e.prev)) return "bad prev";
	switch (e.type) {
		case "declare": return isString(e.chatId) && isStringArray(e.ideas) && isObject(e.names) && optional(e.toolCallId, isString) ? null : "bad declare";
		case "observed": return validObserved(e) ? null : "bad observed";
		case "judged": return isString(e.chatId) && isString(e.sourceKey) && Array.isArray(e.verdicts) && e.verdicts.every(validVerdict)
			&& Array.isArray(e.quotes) && e.quotes.every(validQuote) && isObject(e.grader)
			&& optional(e.observed, isString) && optional(e.anchors, isStringArray) ? null : "bad judged";
		case "link": return isString(e.from) && isString(e.to) && isString(e.reason) ? null : "bad link";
		case "void": return isString(e.target) && isString(e.reason) && (e.by === "learner" || e.by === "undo") ? null : "bad void";
		default: return "unknown type";
	}
}

/** Raw lines without the final newline's empty tail; a torn last line is kept. */
function lines(text: string): string[] {
	const parts = text.split("\n");
	if (parts[parts.length - 1] === "") parts.pop();
	return parts;
}

export function openLog(file: string): EvidenceLog {
	let queue: Promise<unknown> = Promise.resolve();

	function readText(): string {
		return existsSync(file) ? readFileSync(file, "utf8") : "";
	}

	function appendNow(event: NewEvent): LoggedEvent {
		const text = readText();
		const existing = lines(text);
		const last = existing[existing.length - 1];
		const logged = {
			v: 1, id: `ev_${randomBytes(6).toString("hex")}`, at: new Date().toISOString(),
			prev: last === undefined ? ZEROS : sha256(last), ...event,
		} as LoggedEvent;
		const fresh = text !== "" && !text.endsWith("\n") ? "\n" : "";
		appendFileSync(file, `${fresh}${JSON.stringify(logged)}\n`);
		return logged;
	}

	return {
		append(event) {
			const run = queue.then(() => appendNow(event));
			queue = run.catch(() => undefined);
			return run;
		},
		read() {
			const events: LoggedEvent[] = [];
			const damage: { line: number; reason: string }[] = [];
			lines(readText()).forEach((raw, index) => {
				let parsed: unknown;
				try { parsed = JSON.parse(raw); } catch { damage.push({ line: index + 1, reason: "unreadable line" }); return; }
				const reason = problem(parsed);
				if (reason) damage.push({ line: index + 1, reason });
				else events.push(parsed as LoggedEvent);
			});
			return { events, damage };
		},
		verify() {
			let expected = ZEROS;
			const all = lines(readText());
			for (let index = 0; index < all.length; index++) {
				const raw = all[index]!;
				let prev: unknown;
				try { prev = (JSON.parse(raw) as { prev?: unknown }).prev; } catch { prev = undefined; }
				// Unreadable lines are damage (read() reports them); the chain still
				// links over their raw text.
				if (prev !== undefined && prev !== expected) return { ok: false, firstBreak: index === 0 ? 1 : index };
				expected = sha256(raw);
			}
			return { ok: true };
		},
	};
}

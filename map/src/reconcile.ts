// Reconcile: code logs what actually happened in a chat — answers to declared
// questions and concluded practice problems — and voids what was taken back
// with Undo. The tutor's judgement is added separately (record_attempt).
import type { DeclareEvent, JudgedEvent, LoggedEvent, NewEvent, ObservedEvent } from "./events.ts";
import type { EvidenceLog } from "./log.ts";
import { answeredQuestions, problemRuns, type RecordLike } from "./record.ts";

export type NameLookup = (id: string) => string | undefined;

const toIso = (ms: number) => new Date(ms).toISOString();
const PRACTICE_RESULT: Record<string, ObservedEvent["answer"]["result"]> = {
	solved: "correct", solvedWithHints: "correct", surrendered: "dontKnow", movedOn: "wrong",
};

/** The message ids and tool-call ids present in a record. */
function presentIds(record: RecordLike): { messages: Set<string>; calls: Set<string> } {
	const messages = new Set<string>(), calls = new Set<string>();
	for (const raw of record.messages) {
		const m = raw as { id?: unknown; role?: unknown; content?: unknown };
		if (typeof m.id === "string") messages.add(m.id);
		if (m.role === "assistant" && Array.isArray(m.content)) {
			for (const block of m.content as { type?: unknown; id?: unknown }[]) if (block?.type === "toolCall" && typeof block.id === "string") calls.add(block.id);
		}
	}
	return { messages, calls };
}

/** The events this chat's record implies but the log does not hold yet. */
export function pendingEvents(chatId: string, record: RecordLike | null, events: readonly LoggedEvent[], nameOf?: NameLookup): NewEvent[] {
	if (!record) return []; // a deleted chat takes nothing back
	const voided = new Set(events.flatMap(e => (e.type === "void" ? [e.target] : [])));
	const observedAll = events.filter((e): e is LoggedEvent & ObservedEvent => e.type === "observed" && e.chatId === chatId);
	// An attempt is "already logged" by its source AND the exact message it came
	// from — voided or not. A void by the learner therefore sticks, while a re-answer
	// after Undo (a new message) is logged afresh.
	const logged = new Set(observedAll.map(e => `${e.sourceKey}|${e.source.messageId}`));
	const { messages, calls } = presentIds(record);
	const pending: NewEvent[] = [];

	// Undo: an observed attempt whose message has left a chat that still exists…
	for (const e of observedAll) {
		if (!voided.has(e.id) && e.source.messageId && !messages.has(e.source.messageId)) {
			pending.push({ type: "void", target: e.id, reason: "Taken back with Undo", by: "undo" });
		}
	}
	// …and a judgement relying on a message that was taken back.
	for (const e of events) {
		if (e.type !== "judged" || e.chatId !== chatId || voided.has(e.id)) continue;
		const judged = e as LoggedEvent & JudgedEvent;
		const anchors = [...(judged.anchors ?? []), ...judged.quotes.map(q => q.source.messageId)];
		if (anchors.some(id => id && !messages.has(id))) {
			pending.push({ type: "void", target: judged.id, reason: "A message it relied on was taken back with Undo", by: "undo" });
		}
	}

	// Teaching: each answer pairs with the latest declaration since the previous
	// answer whose call is still in the record.
	const declarations = events
		.filter((e): e is LoggedEvent & DeclareEvent => e.type === "declare" && e.chatId === chatId && (e.toolCallId === undefined || calls.has(e.toolCallId)))
		.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	let previous = Number.NEGATIVE_INFINITY;
	for (const answer of answeredQuestions(record).sort((a, b) => a.answeredAt - b.answeredAt)) {
		const window = declarations.filter(d => Date.parse(d.at) > previous && Date.parse(d.at) < answer.answeredAt);
		previous = answer.answeredAt;
		const declaration = window[window.length - 1];
		const sourceKey = `${chatId}:${answer.toolCallId}`;
		const key = `${sourceKey}|${answer.messageId}`;
		if (!declaration || answer.dismissed || logged.has(key)) continue;
		logged.add(key);
		pending.push({
			type: "observed", chatId, sourceKey,
			source: { kind: "question", toolCallId: answer.toolCallId, messageId: answer.messageId },
			declaration: declaration.id, ideas: [...declaration.ideas], names: { ...declaration.names }, posedAt: declaration.at,
			question: { text: answer.questionText, format: answer.tool, ...(answer.options ? { options: answer.options } : {}) },
			answer: {
				result: answer.result, hinted: false, picks: answer.picks, wordsOnly: answer.wordsOnly,
				...(answer.thinking !== undefined ? { thinking: answer.thinking } : {}),
				...(answer.text !== undefined ? { text: answer.text } : {}),
				...(answer.confidence !== undefined ? { confidence: answer.confidence } : {}),
				answeredAt: toIso(answer.answeredAt),
			},
		});
	}

	// Practice: each concluded problem with a target is one attempt, anchored on its conclusion.
	for (const run of problemRuns(record)) {
		const conclusion = run.conclusion;
		const sourceKey = `${chatId}:${run.toolCallId}`;
		if (!conclusion || conclusion.outcome === "dismissed" || run.target.length === 0) continue;
		const key = `${sourceKey}|${conclusion.messageId}`;
		if (logged.has(key)) continue;
		logged.add(key);
		const names = Object.fromEntries(run.target.flatMap(id => { const name = nameOf?.(id); return name ? [[id, name]] : []; }));
		pending.push({
			type: "observed", chatId, sourceKey,
			source: { kind: "problem", toolCallId: run.toolCallId, messageId: conclusion.messageId },
			ideas: [...run.target], names, posedAt: toIso(run.posedAt),
			question: { text: run.statement, format: "practice" },
			answer: {
				result: PRACTICE_RESULT[conclusion.outcome] ?? "unmarked",
				hinted: conclusion.outcome === "solvedWithHints" || conclusion.rung !== null,
				outcome: conclusion.outcome, rung: conclusion.rung,
				working: run.working.map(w => w.text), answeredAt: toIso(conclusion.at),
			},
		});
	}
	return pending;
}

const queues = new WeakMap<EvidenceLog, Map<string, Promise<number>>>();

/** Append what the chat's record implies. One run at a time per chat and log. */
export function reconcile(chatId: string, getSession: (id: string) => RecordLike | null, log: EvidenceLog, nameOf?: NameLookup): Promise<number> {
	const perLog = queues.get(log) ?? new Map<string, Promise<number>>();
	queues.set(log, perLog);
	const run = (perLog.get(chatId) ?? Promise.resolve(0)).then(async () => {
		const pending = pendingEvents(chatId, getSession(chatId), log.read().events, nameOf);
		for (const event of pending) await log.append(event);
		return pending.length;
	});
	perLog.set(chatId, run.catch(() => 0));
	return run;
}

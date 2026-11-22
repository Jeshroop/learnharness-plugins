// The learner's format choice per chat: one-shot ("next question") in memory, or kept
// for the chat and saved to <plugin data>/chat-formats.json.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isFormatId, type FormatId } from "./formats.ts";

export interface Choice { format: FormatId; keep: boolean; /** record length when chosen (one-shot only) */ since: number }
export interface RecordLike { messages: readonly unknown[] }
export interface ChoiceStore {
	get(chatId: string): Choice | undefined;
	set(chatId: string, format: FormatId | "auto", keep: boolean, recordLength: number): void;
	clear(chatId: string): void;
}

const CHAT_ID = /^[A-Za-z0-9_-]{1,120}$/;
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);
export const validChatId = (value: unknown): value is string => typeof value === "string" && CHAT_ID.test(value) && !RESERVED.has(value);

export function createChoiceStore(dataDirectory: string): ChoiceStore {
	const file = path.join(dataDirectory, "chat-formats.json");
	const choices = new Map<string, Choice>();
	try {
		const saved = JSON.parse(readFileSync(file, "utf8")) as Record<string, { format?: unknown }>;
		for (const [chatId, value] of Object.entries(saved)) {
			if (validChatId(chatId) && isFormatId(value?.format)) choices.set(chatId, { format: value.format, keep: true, since: 0 });
		}
	} catch { /* no saved choices yet, or an unreadable file: start empty */ }
	const persist = () => {
		const kept = Object.fromEntries([...choices].filter(([, c]) => c.keep).map(([chatId, c]) => [chatId, { format: c.format }]));
		mkdirSync(dataDirectory, { recursive: true });
		const temp = `${file}.tmp`;
		writeFileSync(temp, JSON.stringify(kept, null, 2));
		renameSync(temp, file);
	};
	return {
		get: chatId => choices.get(chatId),
		set(chatId, format, keep, recordLength) {
			if (!validChatId(chatId)) throw new Error("Not a chat id.");
			const wasKept = choices.get(chatId)?.keep === true;
			if (format === "auto") choices.delete(chatId);
			else choices.set(chatId, { format, keep, since: keep ? 0 : recordLength });
			if (keep || wasKept) persist();
		},
		clear(chatId) {
			const choice = choices.get(chatId);
			if (!choice) return;
			choices.delete(chatId);
			if (choice.keep) persist();
		},
	};
}

/** Native check/probe tools; ask_user_question is a preference question, not one being tested. */
const NATIVE_QUESTIONS = new Set(["quiz", "explain", "probe", "recall"]);

/** True when a question was posed after the first `since` messages. Tolerates odd records. */
export function questionPosedSince(record: RecordLike, since: number): boolean {
	if (!Array.isArray(record?.messages)) return false;
	for (const raw of record.messages.slice(Math.max(0, since))) {
		const message = raw && typeof raw === "object" ? raw as { role?: unknown; content?: unknown; lhQuestions?: unknown } : null;
		if (message?.role !== "assistant") continue;
		const plugin = message.lhQuestions && typeof message.lhQuestions === "object" ? Object.values(message.lhQuestions as Record<string, unknown>) : [];
		if (plugin.some(q => q && typeof q === "object" && typeof (q as { questionId?: unknown }).questionId === "string")) return true;
		if (Array.isArray(message.content) && message.content.some(block => {
			const b = block && typeof block === "object" ? block as { type?: unknown; name?: unknown } : null;
			return b?.type === "toolCall" && typeof b.name === "string" && NATIVE_QUESTIONS.has(b.name);
		})) return true;
	}
	return false;
}

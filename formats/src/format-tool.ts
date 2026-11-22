// The per-turn tool that tells the tutor about the learner's format choice. The host
// rebuilds tools every turn for each chat, so the description can carry this chat's choice.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { questionPosedSince, type ChoiceStore, type RecordLike } from "./choices.ts";
import { formatLabel, type FormatId } from "./formats.ts";

const TOOL_FOR: Record<"teacher" | "prober", Record<FormatId, string>> = {
	teacher: { "multiple-choice": "quiz", written: "explain (or ask_user_question if explain isn't available)", blank: "fill_in_blank", graph: "choose_graph" },
	prober: { "multiple-choice": "probe", written: "recall", blank: "probe_fill_in_blank", graph: "probe_choose_graph" },
};

function describe(format: FormatId, keep: boolean, agent: "teacher" | "prober"): string {
	const how = `${formatLabel(format).toLowerCase()} (${TOOL_FOR[agent][format]})`;
	return keep
		? `The learner chose ${how} for questions in this chat. Use it whenever the question allows; when it can't be asked that way, say why in one line. This explicit choice outranks other question-format guidance. Calling this tool returns the choice.`
		: `The learner chose ${how} for the next question. Ask your next question in that format unless it can't be asked that way — then say why in one line. This explicit choice outranks other question-format guidance. Calling this tool returns the choice.`;
}

/** Called synchronously by the host every turn; never throws. */
export function formatTools(store: ChoiceStore, getSession: (chatId: string) => RecordLike | null, context: { chatId: string; agent: string }): AgentTool<any>[] {
	try {
		const choice = store.get(context.chatId);
		if (!choice) return [];
		if (!choice.keep) {
			let record: RecordLike | null = null;
			try { record = getSession(context.chatId); } catch { record = null; }
			if (record && questionPosedSince(record, choice.since)) { store.clear(context.chatId); return []; }
		}
		const agent = context.agent === "prober" ? "prober" : "teacher";
		const result = JSON.stringify({ format: choice.format, label: formatLabel(choice.format), keep: choice.keep });
		return [{
			name: "question_format",
			label: "Question format",
			description: describe(choice.format, choice.keep, agent),
			parameters: { type: "object", properties: {}, additionalProperties: false } as never,
			executionMode: "sequential",
			execute: async () => ({ content: [{ type: "text", text: result }], details: {} }) as never,
		} as unknown as AgentTool<any>];
	} catch {
		return [];
	}
}

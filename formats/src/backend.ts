// Formats' server half: the question types (validation and grading), the tutor's
// instructions, and the per-turn tool that carries the learner's format choice.
import type {
	JsonValue, PluginBackendContext, PluginQuestionAnswerValidationContext, PluginQuestionGradingContext,
	PluginQuestionTypeDefinition, PluginQuestionValidationContext,
} from "learnharness-plugin-api";
import { blankDefinition, gradeBlank, validateBlankAnswer, validateBlankQuestion, type BlankAnswer, type BlankPayload } from "./blank.ts";
import { gradeGraph, graphDefinition, validateGraphAnswer, validateGraphQuestion, type GraphAnswer, type GraphPayload } from "./graph.ts";
import { createChoiceStore, validChatId, type RecordLike } from "./choices.ts";
import { formatTools } from "./format-tool.ts";
import { isFormatId } from "./formats.ts";

type Definition = PluginQuestionTypeDefinition;
type Validate = PluginQuestionValidationContext;
type ValidateAnswer = PluginQuestionAnswerValidationContext;
type Grade = PluginQuestionGradingContext;

export function activate(ctx: PluginBackendContext): () => void {
	const off: (() => void)[] = [];
	off.push(ctx.registerQuestionType({
		...blankDefinition,
		validateQuestion: ({ input }: Validate) => validateBlankQuestion(input.payload as unknown as BlankPayload),
		validateAnswer: ({ input, answer }: ValidateAnswer) => validateBlankAnswer(input.payload as unknown as BlankPayload, answer as unknown as BlankAnswer),
		gradeAnswer: ({ input, answer }: Grade) => gradeBlank(input.payload as unknown as BlankPayload, answer as unknown as BlankAnswer) as unknown as JsonValue,
	} as unknown as Definition));
	off.push(ctx.registerQuestionType({
		...graphDefinition,
		validateQuestion: ({ input }: Validate) => validateGraphQuestion(input.payload as unknown as GraphPayload),
		validateAnswer: ({ input, answer }: ValidateAnswer) => validateGraphAnswer(input.payload as unknown as GraphPayload, answer as unknown as GraphAnswer),
		gradeAnswer: ({ input, answer }: Grade) => gradeGraph(input.payload as unknown as GraphPayload, answer as unknown as GraphAnswer) as unknown as JsonValue,
	} as unknown as Definition));

	// The learner's format choice per chat, carried to the tutor by a per-turn tool.
	const store = createChoiceStore(ctx.dataDirectory);
	const getSession = (chatId: string) => ctx.learning.getSession(chatId) as unknown as RecordLike | null;
	const recordLength = (chatId: string) => {
		try { const record = getSession(chatId); return Array.isArray(record?.messages) ? record.messages.length : 0; } catch { return 0; }
	};
	const view = (chatId: string) => { const choice = store.get(chatId); return { format: choice?.format ?? "auto", keep: choice?.keep ?? false }; };
	off.push(ctx.registerTools({ agents: ["teacher", "prober"], create: context => formatTools(store, getSession, context) }));
	off.push(ctx.handle("formats.get", input => {
		const chatId = (input as { chatId?: unknown } | null)?.chatId;
		if (!validChatId(chatId)) throw new Error("Not a chat id.");
		return view(chatId);
	}));
	off.push(ctx.handle("formats.set", input => {
		const { chatId, format, keep } = (input ?? {}) as { chatId?: unknown; format?: unknown; keep?: unknown };
		if (!validChatId(chatId)) throw new Error("Not a chat id.");
		if (format !== "auto" && !isFormatId(format)) throw new Error("Not a question format.");
		store.set(chatId, format, keep === true, recordLength(chatId));
		return view(chatId);
	}));
	return () => { for (const dispose of off.splice(0).reverse()) dispose(); };
}

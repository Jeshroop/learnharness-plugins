// Formats' server half: the question types (validation and grading), the tutor's
// instructions, and the per-turn tool that carries the learner's format choice.
import type {
	JsonValue, PluginBackendContext, PluginQuestionAnswerValidationContext, PluginQuestionGradingContext,
	PluginQuestionTypeDefinition, PluginQuestionValidationContext,
} from "learnharness-plugin-api";
import { blankDefinition, gradeBlank, validateBlankAnswer, validateBlankQuestion, type BlankAnswer, type BlankPayload } from "./blank.ts";
import { gradeGraph, graphDefinition, validateGraphAnswer, validateGraphQuestion, type GraphAnswer, type GraphPayload } from "./graph.ts";

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
	return () => { for (const dispose of off.splice(0).reverse()) dispose(); };
}

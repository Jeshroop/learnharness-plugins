// The formats a question can be asked in, shared by the cards, the Format button and grading.

export const FORMATS = [
	{ id: "multiple-choice", label: "Multiple choice" },
	{ id: "written", label: "Written answer" },
	{ id: "blank", label: "Fill in the blank" },
	{ id: "graph", label: "Choose the graph" },
] as const;
export type FormatId = (typeof FORMATS)[number]["id"];
export const FORMAT_IDS: readonly FormatId[] = FORMATS.map(f => f.id);

export const isFormatId = (value: unknown): value is FormatId => typeof value === "string" && (FORMAT_IDS as readonly string[]).includes(value);
export const formatLabel = (id: FormatId): string => FORMATS.find(f => f.id === id)!.label;

/** The other formats a card offers under "Ask as…". */
export function reformatChoices(current: FormatId): { id: FormatId; label: string }[] {
	return FORMATS.filter(f => f.id !== current).map(f => ({ id: f.id, label: f.label }));
}

/** The answer branch that means "ask this question again in another format". */
export function reformatAnswerSchema(current: FormatId) {
	return {
		type: "object", additionalProperties: false, required: ["reformat"],
		properties: { reformat: { type: "string", enum: FORMAT_IDS.filter(id => id !== current) } },
	} as const;
}

/** The requested format when the answer is a reformat request. */
export function readReformat(answer: unknown): FormatId | undefined {
	const value = answer && typeof answer === "object" && !Array.isArray(answer) ? (answer as { reformat?: unknown }).reformat : undefined;
	return isFormatId(value) ? value : undefined;
}

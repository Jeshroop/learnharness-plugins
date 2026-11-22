// The evidence log's event vocabulary. Every learner-authored string in these
// events is copied by code from the stored chat record, never from a model.

/** A graph idea id (`n_…`) or `label:<text>` for an idea not yet in the graph. */
export type IdeaKey = string;

export interface Base {
	v: 1;
	id: string;
	/** ISO timestamp, server clock. */
	at: string;
	/** sha256 hex of the previous raw line; 64 zeros on the first line. */
	prev: string;
}

export type Result = "correct" | "wrong" | "dontKnow";

/** The tutor names the ideas a question tests before it is asked. */
export interface DeclareEvent {
	type: "declare";
	chatId: string;
	/** The declare_tested call's id — a declaration whose call was taken back
	 *  with Undo never pairs with a later answer. */
	toolCallId?: string;
	ideas: IdeaKey[];
	names: Record<IdeaKey, string>;
}

/** What actually happened, copied from the record by code. */
export interface ObservedEvent {
	type: "observed";
	chatId: string;
	/** `${chatId}:${toolCallId}` — joins observed and judged events. */
	sourceKey: string;
	source: { kind: "question" | "problem"; toolCallId: string; messageId: string };
	declaration?: string;
	ideas: IdeaKey[];
	names: Record<IdeaKey, string>;
	posedAt: string;
	question: { text: string; format: "quiz" | "explain" | "practice" | "plugin"; options?: string[] };
	answer: {
		result: Result | "unmarked";
		hinted: boolean;
		picks?: string[];
		wordsOnly?: boolean;
		thinking?: string;
		text?: string;
		confidence?: number;
		outcome?: string;
		rung?: string | null;
		working?: string[];
		answeredAt: string;
	};
}

/** A span of his own words, located and copied from the record by code. */
export interface Quote {
	kind: "reasoning" | "confidence";
	shows: IdeaKey[];
	text: string;
	sha256: string;
	source: { chatId: string; messageId: string; field: string; start: number; end: number; at: string };
}

/** The tutor's judgement of one attempt. */
export interface JudgedEvent {
	type: "judged";
	chatId: string;
	sourceKey: string;
	/** The observed event this judges (teaching answers). Without it the
	 *  judgement applies to the latest observed event with this sourceKey. */
	observed?: string;
	/** Chat message ids this judgement relies on (quoted words, the latest
	 *  learner message when recorded). If one is taken back with Undo, the
	 *  judgement is voided. */
	anchors?: string[];
	/** hinted: the learner had help on this idea before answering — it can only lower credit. */
	verdicts: { idea: IdeaKey; result: Result; variant: boolean; hinted?: true }[];
	quotes: Quote[];
	grader: { provider?: string; model?: string };
}

/** Re-attributes evidence from a label or an id that left the graph. */
export interface LinkEvent {
	type: "link";
	from: IdeaKey;
	to: string;
	reason: string;
}

/** A correction: the target event stops counting. Only the learner (or their Undo). */
export interface VoidEvent {
	type: "void";
	target: string;
	reason: string;
	by: "learner" | "undo";
}

export type NewEvent = DeclareEvent | ObservedEvent | JudgedEvent | LinkEvent | VoidEvent;
export type LoggedEvent = Base & NewEvent;
export type EventType = NewEvent["type"];

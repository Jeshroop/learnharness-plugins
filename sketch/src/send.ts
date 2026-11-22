// "Send with my answer": attaches the chat's drawing to the next submission,
// and marks it sent only when the host acknowledges that submission.
import type { ImageContent } from "@earendil-works/pi-ai";
import type { PluginSubmissionInterceptor, PluginSubmissionTarget } from "learnharness-plugin-api";
import { isPending, markSent, pageElements, type Boards, type SceneElement } from "./state.ts";
import { appendImage } from "./submission.ts";

/** The drawing exactly as it was when a submission was prepared. */
export interface Capture {
	readonly sessionId: string;
	readonly version: number;
	readonly elements: readonly SceneElement[];
	readonly files: Readonly<Record<string, unknown>>;
}

export interface SendOptions {
	exportImage(capture: Capture, signal: AbortSignal): Promise<Readonly<ImageContent>>;
	/** After the host acknowledged a submission carrying this capture. */
	accepted?(capture: Capture, image: Readonly<ImageContent>): void;
}

/** Where a drawing alone can make the input sendable (choices still need a pick). */
function drawingCanStandAlone(target: PluginSubmissionTarget): boolean {
	return target.type === "text" || target.type === "thinking" || (target.type === "answer" && target.question.mode === "text");
}

export function createSendInterceptor(boards: Boards, options: SendOptions): PluginSubmissionInterceptor {
	return {
		id: "sketch-send",
		hasPendingInput(target) {
			const board = boards.peek(target.sessionId);
			return !!board && isPending(board) && drawingCanStandAlone(target);
		},
		async intercept(input, context) {
			const board = boards.peek(context.sessionId);
			if (!board || !isPending(board)) return undefined;
			// Capture before any await: later strokes belong to a later submission. Only the
			// current question's page goes; earlier pages stay on the board.
			const capture: Capture = { sessionId: context.sessionId, version: board.version, elements: pageElements(board), files: board.files };
			const image = await options.exportImage(capture, context.signal);
			context.signal.throwIfAborted();
			context.onAccepted(() => {
				markSent(board, capture.version);
				options.accepted?.(capture, image);
			});
			return appendImage(input, image);
		},
	};
}

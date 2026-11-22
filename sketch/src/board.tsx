// The Excalidraw board mounted inside the Sketch surface.
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { PluginFrontendContext } from "learnharness-plugin-api";
import { captureReference } from "./capture.ts";
import { exportPng, sceneJSON } from "./export.ts";
import type { Reference } from "./reference.ts";
import { hasReference, isPending, isReference, noteChange, pageElements, placeReference, planQuestion, REFERENCE_KEY, removeReference, startPage, type Board } from "./state.ts";

/** The app's own theme choice (html.dark / html.light), not the OS setting. */
function appTheme(): "dark" | "light" {
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export interface BoardHooks {
	/** The board's "pending" answer changed: the host must re-ask hasPendingInput. */
	pendingChanged(): void;
}
export interface BoardOptions {
	ctx: PluginFrontendContext;
	sessionId: string;
	/** The question on screen when the pad was opened, if any. */
	reference?: Reference;
	signal: AbortSignal;
}

function BoardView({ board, hooks, options, host }: { board: Board; hooks: BoardHooks; options: BoardOptions; host: HTMLElement }) {
	const [theme, setTheme] = useState(appTheme);
	const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
	// Identity of the question on screen when the pad opened (its learner-facing text).
	const questionKey = options.reference ? JSON.stringify(options.reference) : undefined;
	const [questionShown, setQuestionShown] = useState(() => pageElements(board).some(isReference));
	const [anyQuestion, setAnyQuestion] = useState(() => hasReference(board.elements));
	const [questionBusy, setQuestionBusy] = useState(false);
	const [questionError, setQuestionError] = useState("");
	const [send, setSend] = useState(board.send);
	const [save, setSave] = useState<{ label: string; title: string; busy?: boolean }>({ label: "Save", title: "Keep this drawing under Sketches" });
	const placedOnOpen = useRef(false);

	const toggleSend = () => {
		board.send = !board.send;
		setSend(board.send);
		hooks.pendingChanged();
	};

	const saveNow = async () => {
		if (!api || save.busy) return;
		const capture = { elements: api.getSceneElements(), files: api.getFiles() };
		if (!capture.elements.some(element => !isReference(element))) {
			setSave({ label: "Save", title: "Draw something first" });
			return;
		}
		setSave({ label: "Saving…", title: "Saving", busy: true });
		try {
			const image = await exportPng(capture as never, options.signal);
			await options.ctx.call("sketch.save", { chatId: options.sessionId, png: image.data, scene: sceneJSON(capture as never) });
			if (!options.signal.aborted) setSave({ label: "Saved ✓", title: "Kept under Sketches" });
		} catch (error) {
			if (!options.signal.aborted) setSave({ label: "Save failed", title: (error as Error)?.message ?? String(error) });
		}
	};

	useEffect(() => {
		const observer = new MutationObserver(() => setTheme(appTheme()));
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);

	/** "origin": the question at the top-left in place of any older one; "below": under everything already drawn. */
	const showQuestion = useCallback(async (target: ExcalidrawImperativeAPI, where: "origin" | "below") => {
		if (!options.reference) return;
		setQuestionBusy(true);
		setQuestionError("");
		try {
			const shot = await captureReference(options.ctx, options.reference, host, options.signal);
			const fileId = `sketch-question-${Date.now().toString(36)}`;
			target.addFiles([{ id: fileId, dataURL: shot.dataURL, mimeType: "image/png", created: Date.now() } as never]);
			const existing = target.getSceneElementsIncludingDeleted();
			const live = existing.filter(element => !element.isDeleted);
			let x = 0, y = 0;
			if (where === "below" && live.length) {
				const [minX, , , maxY] = getCommonBounds(live);
				x = minX;
				y = maxY + 120;
			}
			const [image] = convertToExcalidrawElements([{ type: "image", fileId, x, y, width: shot.width, height: shot.height } as never]);
			const question = { ...image!, locked: true, customData: { [REFERENCE_KEY]: true } };
			const elements = where === "origin" ? placeReference(existing, [question as never]) : [...existing, question as never];
			target.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
			target.scrollToContent(question as never, { fitToViewport: false, animate: false });
		} catch (error) {
			if (!options.signal.aborted) setQuestionError((error as Error)?.message ?? String(error));
		} finally {
			if (!options.signal.aborted) setQuestionBusy(false);
		}
	}, [host, options]);

	// On open, a new question either replaces the old one (no ink yet) or starts a new page
	// below the earlier working (nothing is erased).
	useEffect(() => {
		if (!api || placedOnOpen.current) return;
		placedOnOpen.current = true;
		const plan = planQuestion(board, questionKey);
		if (plan === "keep" || !questionKey) return;
		const before = isPending(board);
		startPage(board, questionKey, plan);
		if (isPending(board) !== before) hooks.pendingChanged();
		void showQuestion(api, plan === "new-page" ? "below" : "origin");
	}, [api, board, hooks, questionKey, showQuestion]);

	const toggleQuestion = () => {
		if (!api || questionBusy) return;
		const all = api.getSceneElementsIncludingDeleted();
		const pageCards = new Set(pageElements({ elements: all, pageStart: board.pageStart }).filter(isReference).map(element => element.id));
		if (pageCards.size) {
			api.updateScene({ elements: all.filter(element => !pageCards.has(element.id)), captureUpdate: CaptureUpdateAction.NEVER });
		} else if (options.reference) {
			void showQuestion(api, all.some(element => !element.isDeleted) ? "below" : "origin");
		} else {
			// No current question: only earlier questions' cards are left to remove.
			api.updateScene({ elements: removeReference(all), captureUpdate: CaptureUpdateAction.NEVER });
		}
	};

	return (
		<div className="sketch-board">
			<Excalidraw
				theme={theme}
				autoFocus
				excalidrawAPI={setApi}
				// The pen is the starting tool (set here: Excalidraw's scene load would reset a later setActiveTool).
				initialData={{ elements: board.elements, files: board.files, scrollToContent: true, appState: { activeTool: { type: "freedraw" } } } as never}
				onChange={(elements, _appState, files) => {
					const before = isPending(board);
					const changed = noteChange(board, elements, files as never);
					setQuestionShown(pageElements(board).some(isReference));
					setAnyQuestion(hasReference(elements));
					if (changed) setSave(current => current.label === "Save" || current.busy ? current : { label: "Save", title: "Keep this drawing under Sketches" });
					if (isPending(board) !== before) hooks.pendingChanged();
				}}
				renderTopRightUI={() => (
					<div className="sketch-controls">
						{(options.reference || anyQuestion) && (
							<button type="button" className="sketch-control" aria-pressed={questionShown} disabled={questionBusy}
								title={questionError ? `Couldn't show the question: ${questionError}`
									: questionShown ? "Hide the question" : options.reference ? "Show the question on the board" : "Remove the earlier questions"}
								onClick={toggleQuestion}>
								{questionBusy ? "Question…" : "Question"}
							</button>
						)}
						<button type="button" className="sketch-control" aria-pressed={send} onClick={toggleSend}
							title={send ? "Your drawing goes with your next answer or message (only when it has changed)" : "Your drawing stays on the pad"}>
							Send with answer
						</button>
						<button type="button" className="sketch-control" disabled={save.busy} title={save.title} onClick={() => void saveNow()}>
							{save.label}
						</button>
					</div>
				)}
				UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false } }}
			/>
		</div>
	);
}

export function mountBoard(container: HTMLElement, board: Board, hooks: BoardHooks, options: BoardOptions): () => void {
	const host = document.createElement("div");
	host.className = "sketch-host";
	container.append(host);
	const root = createRoot(host);
	root.render(<BoardView board={board} hooks={hooks} options={options} host={host} />);
	return () => { root.unmount(); host.remove(); };
}

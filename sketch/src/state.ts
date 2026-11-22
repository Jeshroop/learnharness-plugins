// Per-chat drawing state: what is on each board and whether it still needs sending.
// Lives in window memory only — nothing here is written to disk.

/** The parts of an Excalidraw element this module reads. */
export interface SceneElement {
	readonly id: string;
	readonly version: number;
	readonly isDeleted?: boolean;
	readonly customData?: Readonly<Record<string, unknown>>;
}

export interface Board {
	elements: readonly SceneElement[];
	files: Readonly<Record<string, unknown>>;
	/** Bumped whenever the drawing itself (ink, not the question image) changes. */
	version: number;
	/** The newest version accepted with a submission. */
	sentVersion: number;
	/** "Send with my answer". */
	send: boolean;
	/** Identity of the current page's ink, to tell real edits from selection or zoom changes. */
	signature: string;
	/** Elements that belong to earlier questions' pages (kept on the board, never sent again). */
	pageStart: ReadonlySet<string>;
	/** The question the current page belongs to. */
	pageQuestion?: string;
}

/** customData flag on the locked question image placed under the drawing. */
export const REFERENCE_KEY = "sketchReference";

export function isReference(element: SceneElement): boolean {
	return element.customData?.[REFERENCE_KEY] === true;
}

export function hasReference(elements: readonly SceneElement[]): boolean {
	return elements.some(element => !element.isDeleted && isReference(element));
}

export function removeReference<T extends SceneElement>(elements: readonly T[]): T[] {
	return elements.filter(element => !isReference(element));
}

/** The question goes at the bottom of the stack, replacing any older one. */
export function placeReference<T extends SceneElement>(elements: readonly T[], reference: readonly T[]): T[] {
	return [...reference, ...removeReference(elements)];
}

function ink(elements: readonly SceneElement[]): SceneElement[] {
	return elements.filter(element => !element.isDeleted && !isReference(element));
}

/** The current question's page: everything placed or drawn since its question appeared. */
export function pageElements<T extends SceneElement>(board: { elements: readonly T[]; pageStart: ReadonlySet<string> }): T[] {
	return board.elements.filter(element => !element.isDeleted && !board.pageStart.has(element.id));
}

/** Ink on the current page. */
export function hasInk(board: Board): boolean {
	return ink(pageElements(board)).length > 0;
}

/** Ink anywhere on the board, earlier pages included. */
export function hasAnyInk(board: Board): boolean {
	return ink(board.elements).length > 0;
}

function signatureOf(board: Board): string {
	return ink(pageElements(board)).map(element => `${element.id}:${element.version}`).join(",");
}

/** Record the board's current elements; returns true when the current page's drawing changed. */
export function noteChange(board: Board, elements: readonly SceneElement[], files?: Readonly<Record<string, unknown>>): boolean {
	board.elements = elements;
	if (files) board.files = files;
	const signature = signatureOf(board);
	if (signature === board.signature) return false;
	board.signature = signature;
	board.version++;
	return true;
}

export type QuestionPlan = "keep" | "replace" | "new-page";

/**
 * What opening the pad on question `key` does: the same question (or none) keeps the board
 * as it is; a board without ink takes the new question in place of the old; a board with
 * ink keeps everything and starts a new page below it for the new question.
 */
export function planQuestion(board: Board, key: string | undefined): QuestionPlan {
	if (key === undefined || key === board.pageQuestion) return "keep";
	return hasAnyInk(board) ? "new-page" : "replace";
}

/** The current page now belongs to `key`; on a new page, everything already on the board belongs to earlier pages. */
export function startPage(board: Board, key: string, plan: "replace" | "new-page"): void {
	board.pageQuestion = key;
	board.pageStart = plan === "new-page" ? new Set(board.elements.filter(element => !element.isDeleted).map(element => element.id)) : new Set();
	board.signature = signatureOf(board);
}

/** True when the next submission should carry this drawing. */
export function isPending(board: Board): boolean {
	return board.send && hasInk(board) && board.version !== board.sentVersion;
}

/** Called only after the host acknowledged a submission carrying `version`. */
export function markSent(board: Board, version: number): void {
	board.sentVersion = Math.max(board.sentVersion, version);
}

export interface Boards {
	/** The chat's board, created empty on first use. */
	get(sessionId: string): Board;
	/** The chat's board if one exists; never creates (safe in side-effect-free checks). */
	peek(sessionId: string): Board | undefined;
}

export function createBoards(): Boards {
	const boards = new Map<string, Board>();
	return {
		get(sessionId) {
			let board = boards.get(sessionId);
			if (!board) {
				board = { elements: [], files: {}, version: 0, sentVersion: 0, send: true, signature: "", pageStart: new Set() };
				boards.set(sessionId, board);
			}
			return board;
		},
		peek: sessionId => boards.get(sessionId),
	};
}

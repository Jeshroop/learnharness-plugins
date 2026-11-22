// "Ask as…" on a Formats card: pick another format, then Submit; Undo returns to answering.
import { el } from "./dom.ts";
import { formatLabel, reformatChoices, type FormatId } from "./formats.ts";

export interface ReformatHooks {
	/** Publish the reformat request as the card's answer. */
	pick(id: FormatId): void;
	/** Go back to the learner's own answer. */
	undo(): void;
	/** Grey out the card's own inputs while a request is chosen. */
	setDisabled(disabled: boolean): void;
}

export interface ReformatControl {
	/** Show a chosen request without publishing it (a redrawn card restoring its draft). */
	show(id: FormatId): void;
	/** Hide the request without publishing (the draft no longer holds one). */
	reset(): void;
	readonly showing: boolean;
	setActive(active: boolean): void;
	focusUndo(): void;
	dispose(): void;
}

export function mountReformat(root: HTMLElement, current: FormatId, hooks: ReformatHooks): ReformatControl {
	const bar = el("div", "fmt-reformat");
	bar.append(el("span", "fmt-reformat-label", "Ask as:"));
	const listeners: [HTMLElement, () => void][] = [];
	const on = (node: HTMLElement, run: () => void) => { node.addEventListener("click", run); listeners.push([node, run]); };
	const buttons: HTMLButtonElement[] = [];
	const note = el("p", "fmt-reformat-note");
	note.hidden = true;
	const text = el("span");
	const undo = el("button", "fmt-reformat-undo", "Undo");
	undo.type = "button";
	note.append(text, undo);
	let chosen: FormatId | null = null;

	const show = (id: FormatId) => {
		chosen = id;
		text.textContent = `Press Submit to get this as “${formatLabel(id)}” instead. `;
		note.hidden = false;
		bar.hidden = true;
		hooks.setDisabled(true);
	};
	const reset = () => {
		chosen = null;
		note.hidden = true;
		bar.hidden = false;
		hooks.setDisabled(false);
	};
	for (const choice of reformatChoices(current)) {
		const button = el("button", "fmt-reformat-choice", choice.label);
		button.type = "button";
		on(button, () => { show(choice.id); hooks.pick(choice.id); });
		bar.append(button);
		buttons.push(button);
	}
	on(undo, () => { reset(); hooks.undo(); });
	root.append(bar, note);
	return {
		show, reset,
		get showing() { return chosen !== null; },
		setActive(active) { for (const button of [...buttons, undo]) button.disabled = !active; },
		focusUndo() { undo.focus(); },
		dispose() {
			for (const [node, run] of listeners.splice(0)) node.removeEventListener("click", run);
			bar.remove();
			note.remove();
		},
	};
}

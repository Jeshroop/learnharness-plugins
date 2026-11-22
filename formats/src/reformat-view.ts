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

export function mountReformat(root: HTMLElement, current: FormatId, hooks: ReformatHooks): { dispose(): void } {
	const bar = el("div", "fmt-reformat");
	bar.append(el("span", "fmt-reformat-label", "Ask as:"));
	const listeners: [HTMLElement, () => void][] = [];
	const on = (node: HTMLElement, run: () => void) => { node.addEventListener("click", run); listeners.push([node, run]); };
	for (const choice of reformatChoices(current)) {
		const button = el("button", "fmt-reformat-choice", choice.label);
		button.type = "button";
		on(button, () => choose(choice.id));
		bar.append(button);
	}
	const note = el("p", "fmt-reformat-note");
	note.hidden = true;
	const text = el("span");
	const undo = el("button", "fmt-reformat-undo", "Undo");
	undo.type = "button";
	note.append(text, undo);
	root.append(bar, note);

	function choose(id: FormatId) {
		text.textContent = `Press Submit to get this as “${formatLabel(id)}” instead. `;
		note.hidden = false;
		bar.hidden = true;
		hooks.setDisabled(true);
		hooks.pick(id);
	}
	on(undo, () => {
		note.hidden = true;
		bar.hidden = false;
		hooks.setDisabled(false);
		hooks.undo();
	});
	return {
		dispose() {
			for (const [node, run] of listeners.splice(0)) node.removeEventListener("click", run);
			bar.remove();
			note.remove();
		},
	};
}

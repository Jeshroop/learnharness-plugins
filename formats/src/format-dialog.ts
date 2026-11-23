// The Format button's dialog: the format of the next question, optionally kept for the chat.
import type { PluginFrontendContext } from "learnharness-plugin-api";
import { el } from "./dom.ts";
import { createChoiceEditor, type FormatValue } from "./choice-editor.ts";
import { FORMATS } from "./formats.ts";

export function openFormatDialog(ctx: PluginFrontendContext, chatId: string): void {
	ctx.ui.openDialog({
		title: "Question format",
		content: (host, signal) => {
			const root = el("div", "fmt-dialog");
			const rowsHost = el("div");
			const note = el("p", "fmt-dialog-note", "Applies from the tutor's next question. “Tutor decides” lets the tutor pick the best format each time.");
			root.append(el("h2", "fmt-dialog-title", "Question format"), rowsHost, note);
			host.append(root);
			const editor = createChoiceEditor(
				next => ctx.call("formats.set", { chatId, format: next.format, keep: next.keep }) as Promise<FormatValue>,
				() => { if (!signal.aborted) handle.update({ rows: rows() }); },
			);
			const failed = (what: string) => (error: unknown) => {
				if (!signal.aborted) note.textContent = `${what}: ${(error as Error)?.message ?? String(error)}`;
			};
			const rows = () => [
				{
					type: "dropdown" as const, key: "format", label: "Next question", value: editor.value.format,
					options: [{ value: "auto", label: "Tutor decides" }, ...FORMATS.map(f => ({ value: f.id, label: f.label }))],
					onChange: (format: string) => { editor.change({ format }).catch(failed("Couldn't save")); },
				},
				{
					type: "toggle" as const, key: "keep", label: "Keep for this chat",
					description: "Use this format for every question in this chat until you change it.",
					value: editor.value.keep, disabled: editor.value.format === "auto",
					onChange: (keep: boolean) => { editor.change({ keep }).catch(failed("Couldn't save")); },
				},
			];
			const handle = ctx.ui.mountSettingsRows(rowsHost, { rows: rows() }, { signal });
			(ctx.call("formats.get", { chatId }) as Promise<FormatValue>)
				.then(stored => { if (!signal.aborted) editor.loaded(stored); }, failed("Couldn't load the current choice"));
		},
	}, { signal: ctx.signal });
}

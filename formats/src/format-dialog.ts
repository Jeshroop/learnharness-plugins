// The Format button's dialog: the format of the next question, optionally kept for the chat.
import type { PluginFrontendContext } from "learnharness-plugin-api";
import { el } from "./dom.ts";
import { FORMATS } from "./formats.ts";

interface Value { format: string; keep: boolean }

export function openFormatDialog(ctx: PluginFrontendContext, chatId: string): void {
	ctx.ui.openDialog({
		title: "Question format",
		content: (host, signal) => {
			const root = el("div", "fmt-dialog");
			const rowsHost = el("div");
			const note = el("p", "fmt-dialog-note", "Applies from the tutor's next question. “Tutor decides” lets the tutor pick the best format each time.");
			root.append(el("h2", "fmt-dialog-title", "Question format"), rowsHost, note);
			host.append(root);
			let value: Value = { format: "auto", keep: false };
			const save = async (next: Value) => {
				try { value = await ctx.call("formats.set", { chatId, format: next.format, keep: next.keep }) as Value; }
				catch (error) { if (!signal.aborted) note.textContent = `Couldn't save: ${(error as Error)?.message ?? String(error)}`; }
				if (!signal.aborted) handle.update({ rows: rows() });
			};
			const rows = () => [
				{
					type: "dropdown" as const, key: "format", label: "Next question", value: value.format,
					options: [{ value: "auto", label: "Tutor decides" }, ...FORMATS.map(f => ({ value: f.id, label: f.label }))],
					onChange: (format: string) => { void save({ format, keep: format === "auto" ? false : value.keep }); },
				},
				{
					type: "toggle" as const, key: "keep", label: "Keep for this chat",
					description: "Use this format for every question in this chat until you change it.",
					value: value.keep, disabled: value.format === "auto",
					onChange: (keep: boolean) => { void save({ format: value.format, keep }); },
				},
			];
			const handle = ctx.ui.mountSettingsRows(rowsHost, { rows: rows() }, { signal });
			void (async () => {
				try {
					value = await ctx.call("formats.get", { chatId }) as Value;
					if (!signal.aborted) handle.update({ rows: rows() });
				} catch (error) {
					if (!signal.aborted) note.textContent = `Couldn't load the current choice: ${(error as Error)?.message ?? String(error)}`;
				}
			})();
		},
	}, { signal: ctx.signal });
}

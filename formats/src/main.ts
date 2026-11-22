// Formats' window half: the question renderers and the top-bar Format button.
import type { PluginFrontendContext, PluginQuestionRenderer } from "learnharness-plugin-api";
import { blankRenderer } from "./blank-view.ts";
import { openFormatDialog } from "./format-dialog.ts";
import { graphRenderer } from "./graph-view.ts";

const FORMAT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="7" rx="1.5"/><path d="M14 6h7M14 10h5"/><path d="M3 20c2-4 4-4 6 0s4 4 6-1"/><path d="M18 14v6M15 17h6"/></svg>`;

export function activate(ctx: PluginFrontendContext): () => void {
	const off: (() => void)[] = [];
	off.push(ctx.registerQuestionRenderer(blankRenderer(ctx.ui) as unknown as PluginQuestionRenderer));
	off.push(ctx.registerQuestionRenderer(graphRenderer(ctx.ui) as unknown as PluginQuestionRenderer));
	off.push(ctx.registerAction({
		id: "format", name: "Format", icon: FORMAT_ICON,
		run(context) { if (context.surface === "session") openFormatDialog(ctx, (context as unknown as { sessionId: string }).sessionId); },
	}));
	off.push(ctx.placeAction({ id: "session-format", actionId: "format", location: "top-bar", sessions: ["teaching"] }));
	return () => { for (const dispose of off.splice(0).reverse()) dispose(); };
}

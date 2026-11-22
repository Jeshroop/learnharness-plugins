// Formats' window half: the question renderers and the top-bar Format button.
import type { PluginFrontendContext, PluginQuestionRenderer } from "learnharness-plugin-api";
import { blankRenderer } from "./blank-view.ts";

export function activate(ctx: PluginFrontendContext): () => void {
	const off: (() => void)[] = [];
	off.push(ctx.registerQuestionRenderer(blankRenderer(ctx.ui) as unknown as PluginQuestionRenderer));
	return () => { for (const dispose of off.splice(0).reverse()) dispose(); };
}

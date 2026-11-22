// Formats' window half: the question renderers and the top-bar Format button.
import type { PluginFrontendContext } from "learnharness-plugin-api";

export function activate(_ctx: PluginFrontendContext): () => void {
	const off: (() => void)[] = [];
	return () => { for (const dispose of off.splice(0).reverse()) dispose(); };
}

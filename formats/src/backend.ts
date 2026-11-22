// Formats' server half: the question types (validation and grading), the tutor's
// instructions, and the per-turn tool that carries the learner's format choice.
import type { PluginBackendContext } from "learnharness-plugin-api";

export function activate(_ctx: PluginBackendContext): () => void {
	const off: (() => void)[] = [];
	return () => { for (const dispose of off.splice(0).reverse()) dispose(); };
}

// Pieces every Formats card shares: the tutor's prompt and the "why this format" line.
import type { PluginFrontendContext } from "learnharness-plugin-api";
import { el, type bag } from "./dom.ts";

type Ui = PluginFrontendContext["ui"];

export function mountPrompt(root: HTMLElement, ui: Ui, question: string, signal: AbortSignal, cleanup: ReturnType<typeof bag>): void {
	if (!question.trim()) return;
	const target = el("div", "fmt-prompt");
	root.append(target);
	cleanup.add(ui.mountMarkdown(target, { text: question }, { signal }));
}

export function mountWhy(root: HTMLElement, why: string): void {
	if (!why.trim()) return;
	const line = el("p", "fmt-why");
	line.append(el("span", "fmt-why-label", "Why this format: "), document.createTextNode(why));
	root.append(line);
}

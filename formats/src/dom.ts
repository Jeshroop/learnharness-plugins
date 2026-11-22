// Small DOM helpers shared by the cards. Text always goes in as text, never as HTML.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

/** Escape Markdown (and $ maths) so learner text shows literally inside host-rendered Markdown. */
export function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+\-.!$|<>~]/g, "\\$&");
}

export interface Disposable { dispose(): void }

/** Collects widget handles and cleanups; dispose runs them all once, newest first. */
export function bag() {
	const items: (() => void)[] = [];
	let done = false;
	return {
		add(item: Disposable | (() => void) | undefined) {
			if (!item) return;
			const run = typeof item === "function" ? item : () => item.dispose();
			if (done) run(); else items.push(run);
		},
		dispose() {
			if (done) return;
			done = true;
			for (const run of items.splice(0).reverse()) { try { run(); } catch { /* keep disposing */ } }
		},
	};
}

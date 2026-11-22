// The Sketches view: every drawing that was kept, newest first.
import type { PluginFrontendContext } from "learnharness-plugin-api";
import { rowFor } from "./gallery-model.ts";
import type { SavedSketch } from "./save.ts";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function openSketch(ctx: PluginFrontendContext, src: string, when: string, signal: AbortSignal): void {
	ctx.ui.openDialog({
		title: `Sketch from ${when}`,
		content: host => {
			const image = el("img", "sketch-dialog__image");
			image.src = src;
			image.alt = `Sketch from ${when}`;
			host.append(image);
		},
	}, { signal });
}

export function mountSketchesView(ctx: PluginFrontendContext, container: HTMLElement, signal: AbortSignal): () => void {
	const root = el("div", "sketch-gallery");
	const status = el("p", "sketch-gallery__status", "Loading…");
	root.append(el("h2", "sketch-gallery__title", "Sketches"), status);
	container.append(root);
	void (async () => {
		try {
			const { sketches } = await ctx.call("sketch.list", {}) as { sketches: SavedSketch[] };
			if (signal.aborted) return;
			if (!sketches.length) {
				status.textContent = "Nothing kept yet. Press Save on the Sketch pad, or the tutor keeps a drawing that shows an error in your working.";
				return;
			}
			status.remove();
			const list = el("ul", "sketch-gallery__list");
			root.append(list);
			const images: [HTMLImageElement, string][] = [];
			for (const sketch of sketches) {
				const row = rowFor(sketch);
				const item = el("li", "sketch-gallery__item");
				const thumb = el("button", "sketch-gallery__thumb");
				thumb.type = "button";
				thumb.setAttribute("aria-label", `Open the sketch from ${row.when}`);
				const image = el("img", "sketch-gallery__image");
				image.alt = "";
				thumb.append(image);
				thumb.addEventListener("click", () => { if (image.src) openSketch(ctx, image.src, row.when, signal); });
				const meta = el("div", "sketch-gallery__meta");
				meta.append(el("div", "sketch-gallery__when", row.when), el("div", "sketch-gallery__who", row.who));
				if (row.reason) meta.append(el("div", "sketch-gallery__reason", row.reason));
				item.append(thumb, meta);
				list.append(item);
				images.push([image, sketch.name]);
			}
			// One at a time, so a long list never floods the bridge.
			for (const [image, name] of images) {
				if (signal.aborted) return;
				try {
					const { png } = await ctx.call("sketch.image", { name }) as { png: string };
					if (!signal.aborted) image.src = `data:image/png;base64,${png}`;
				} catch { image.alt = "Image missing"; }
			}
		} catch (error) {
			if (!signal.aborted) status.textContent = `Couldn't load your sketches: ${(error as Error)?.message ?? String(error)}`;
		}
	})();
	return () => root.remove();
}

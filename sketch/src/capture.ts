// Renders the current question offscreen and rasterises it for the board.
// The readiness wait and SVG capture follow Drawing Pad's capture.ts (LearnHarness, AGPL-3.0).
import { toSvg } from "html-to-image";
import type { PluginFrontendContext } from "learnharness-plugin-api";
import { abortable, frame } from "./abort.ts";
import { referenceFontCSS } from "./fonts.ts";
import { mountReference, type Reference } from "./reference.ts";

export interface ReferenceImage { dataURL: string; width: number; height: number }

/** Observe only the plugin-owned reference and generic browser/ARIA readiness. */
async function waitForReference(root: HTMLElement, slots: readonly HTMLElement[], signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();
	await new Promise<void>((resolve, reject) => {
		let running = false, revision = 0, settled = false;
		const cleanup = () => {
			settled = true; observer.disconnect(); signal.removeEventListener("abort", abort);
			root.removeEventListener("load", schedule, true); root.removeEventListener("error", schedule, true);
		};
		const fail = (error: unknown) => { cleanup(); reject(error); };
		const abort = () => fail(signal.reason);
		const check = async () => {
			if (running || settled) return;
			running = true;
			try {
				const before = revision;
				await frame(signal);
				if (slots.some(slot => !slot.hasChildNodes()) || root.querySelector('[aria-busy="true"]')) { running = false; return; }
				await abortable(document.fonts.ready, signal);
				await abortable(Promise.all([...root.querySelectorAll("img")].map(image => image.decode())), signal);
				await frame(signal); await frame(signal);
				running = false;
				if (revision !== before) { schedule(); return; }
				cleanup(); resolve();
			} catch (error) { fail(error); }
		};
		const schedule = () => { if (!settled) void check(); };
		const observer = new MutationObserver(() => { revision++; schedule(); });
		observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
		root.addEventListener("load", schedule, true); root.addEventListener("error", schedule, true);
		signal.addEventListener("abort", abort, { once: true });
		schedule();
	});
}

/**
 * Dark text on white whatever the app theme: Excalidraw's dark mode inverts the whole
 * canvas (images included) and its light export does not, so this reads in both.
 */
export async function captureReference(ctx: PluginFrontendContext, reference: Reference, host: HTMLElement, signal: AbortSignal): Promise<ReferenceImage> {
	const root = document.createElement("div");
	root.className = "sketch-reference";
	host.append(root);
	const mounted = mountReference(root, ctx, reference, signal);
	try {
		await waitForReference(root, mounted.slots, signal);
		const fontEmbedCSS = await referenceFontCSS(root, signal);
		const width = root.clientWidth, height = root.scrollHeight;
		if (!width || !height) throw new Error("The question could not be laid out.");
		const svg = await abortable(toSvg(root, { fontEmbedCSS, width, height,
			style: { position: "static", left: "0", top: "0", width: `${width}px`, height: `${height}px`, maxHeight: "none", overflow: "visible" } }), signal);
		const image = new Image();
		image.src = svg;
		await abortable(image.decode(), signal);
		const scale = 2;
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(width * scale);
		canvas.height = Math.round(height * scale);
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Drawing is unavailable in this browser.");
		if (document.documentElement.classList.contains("dark")) context.filter = "invert(1) hue-rotate(180deg)";
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		signal.throwIfAborted();
		return { dataURL: canvas.toDataURL("image/png"), width, height };
	} finally {
		mounted.dispose();
		root.remove();
	}
}

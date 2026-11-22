// Sketch's window half: the top-bar action that opens the pad, and the
// interceptor that sends a drawing with an answer.
import type { PluginFrontendContext, PluginSessionViewInput } from "learnharness-plugin-api";
import { mountSketchesView } from "./gallery.ts";
import { createPadToggle } from "./pad-toggle.ts";
import { referenceFor } from "./reference.ts";
import { createSendInterceptor } from "./send.ts";
import { createBoards } from "./state.ts";

const SHAPES_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1"/><circle cx="17" cy="17" r="4"/><path d="M14 4l6 6M4 20l6-6"/></svg>`;

const GALLERY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 15c2-3 3-3 5 0s3 3 5-1"/><circle cx="8.5" cy="9" r="1.5"/></svg>`;

interface SessionContext { surface: string; sessionId: string; surfaceTarget: unknown; view?: { input: PluginSessionViewInput } }

export function activate(ctx: PluginFrontendContext): () => void {
	// Excalidraw resolves its fonts against this base; the host serves dist/assets/.
	if (typeof window !== "undefined") (window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = new URL("./assets/", import.meta.url).href;

	const boards = createBoards();
	const hooks = { pendingChanged: () => ctx.refreshSubmissions() };
	let opening: SessionContext | undefined;
	const pads = createPadToggle(pad => {
		const context = opening!;
		// The learner-facing question as shown when the pad opens (never grading data).
		const reference = context.view ? referenceFor(context.view.input) : undefined;
		return ctx.ui.openSurface(context.surfaceTarget as never, {
			title: "Sketch", background: "opaque",
			content(container: HTMLElement, signal: AbortSignal) {
				let unmount: (() => void) | undefined;
				let departed = false;
				// Excalidraw loads only on first open, so the plugin costs nothing until used.
				import("./board.tsx")
					.then(({ mountBoard }) => {
						if (!signal.aborted && !departed) unmount = mountBoard(container, boards.get(pad.sessionId), hooks, { ctx, sessionId: pad.sessionId, reference, signal });
					})
					.catch((error: unknown) => { if (!departed) container.textContent = `Sketch failed to load: ${(error as Error)?.message ?? String(error)}`; });
				return pad.departs(() => { departed = true; unmount?.(); });
			},
			onClose: () => pad.close(),
		}, { signal: pad.signal });
	});
	const toggle = (context: SessionContext) => {
		opening = context;
		try { pads.toggle(context.sessionId); } finally { opening = undefined; }
	};

	const off: (() => void)[] = [];
	off.push(ctx.registerAction({ id: "sketch", name: "Sketch", icon: SHAPES_ICON, run(context) { if (context.surface === "session") toggle(context as unknown as SessionContext); } }));
	off.push(ctx.placeAction({ id: "session-sketch", actionId: "sketch", location: "top-bar", sessions: ["teaching", "practice"] }));
	off.push(ctx.registerSubmissionInterceptor(createSendInterceptor(boards, {
		async exportImage(capture, signal) {
			const { exportPng } = await import("./export.ts");
			return exportPng(capture, signal);
		},
		accepted(capture, image) {
			ctx.refreshSubmissions();
			// Held in the backend's memory so the tutor can keep it if it matters; never written otherwise.
			void import("./export.ts")
				.then(({ sceneJSON }) => ctx.call("sketch.sent", { chatId: capture.sessionId, png: image.data, scene: sceneJSON(capture) }))
				.catch((error: unknown) => console.warn("Sketch: the tutor won't be able to keep this drawing.", error));
		},
	})));
	off.push(ctx.registerView({ id: "sketches", name: "Sketches", mount: (container, signal) => mountSketchesView(ctx, container, signal) }));
	off.push(ctx.registerAction({ id: "sketches", name: "Sketches", icon: GALLERY_ICON, run: () => ctx.app.openView("sketches") }));
	off.push(ctx.placeAction({ id: "sketches-sidebar", actionId: "sketches", location: "sidebar" }));
	return () => { pads.close(); for (const dispose of off.splice(0)) dispose(); };
}

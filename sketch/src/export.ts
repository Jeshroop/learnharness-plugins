// PNG export of a captured drawing (loaded lazily with Excalidraw).
import type { ImageContent } from "@earendil-works/pi-ai";
import { exportToBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import { toBase64 } from "./bytes.ts";
import type { Capture } from "./send.ts";

/** Black on white whatever the app theme; within the host's 2000 px bound (never upscaled). */
export async function exportPng(capture: Pick<Capture, "elements" | "files">, signal?: AbortSignal): Promise<Readonly<ImageContent>> {
	const blob = await exportToBlob({
		elements: capture.elements.filter(element => !element.isDeleted) as never,
		files: capture.files as never,
		appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false } as never,
		mimeType: "image/png",
		maxWidthOrHeight: 2000,
		exportPadding: 24,
	});
	signal?.throwIfAborted();
	return { type: "image", mimeType: "image/png", data: toBase64(new Uint8Array(await blob.arrayBuffer())) };
}

/** The editable .excalidraw scene (opens in Excalidraw and Obsidian's Excalidraw plugin). */
export function sceneJSON(capture: Pick<Capture, "elements" | "files">): string {
	return serializeAsJSON(capture.elements.filter(element => !element.isDeleted) as never, { viewBackgroundColor: "#ffffff" } as never, capture.files as never, "local");
}

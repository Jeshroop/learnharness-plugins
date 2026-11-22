// What one row of the Sketches view says.
import type { SavedSketch } from "./save.ts";

export interface SketchRow { name: string; chatId: string; when: string; who: string; reason: string }

export function rowFor(sketch: SavedSketch, locale?: string): SketchRow {
	const when = new Date(sketch.at).toLocaleString(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
	return { name: sketch.name, chatId: sketch.chatId, when, who: sketch.by === "tutor" ? "Kept by the tutor" : "Saved by you", reason: sketch.reason ?? "" };
}

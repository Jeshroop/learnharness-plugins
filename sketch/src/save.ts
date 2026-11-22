// Kept sketches in the plugin's data folder: the PNG, the editable scene, and who kept it and why.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MAX_PNG_BYTES = 12 * 1024 * 1024;
const MAX_SCENE_CHARS = 32 * 1024 * 1024;
const MAX_REASON = 500;
const CHAT_ID = /^[A-Za-z0-9_-]{1,100}$/;
const NAME = /^\d{8}-\d{6}-[A-Za-z0-9_-]{1,120}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type SavedBy = "learner" | "tutor";
export interface SavedSketch { name: string; chatId: string; at: string; by: SavedBy; reason?: string }
export interface Sketch { chatId: string; png: Buffer; scene: string }
export interface SaveOptions { now?: Date; by?: SavedBy; reason?: string }

/** Only chatId, png (base64) and scene are read from the window; anything else is ignored. */
export function validateSketch(input: unknown): Sketch {
	const value = (input ?? {}) as Record<string, unknown>;
	if (typeof value.chatId !== "string" || !CHAT_ID.test(value.chatId)) throw new Error("Sketch needs a valid chat id.");
	if (typeof value.png !== "string" || value.png.length % 4 !== 0 || !BASE64.test(value.png)) throw new Error("The drawing is not a PNG image.");
	if (value.png.length > (MAX_PNG_BYTES / 3) * 4 + 8) throw new Error("The drawing is too large to keep (12 MB at most).");
	const png = Buffer.from(value.png, "base64");
	if (png.length > MAX_PNG_BYTES) throw new Error("The drawing is too large to keep (12 MB at most).");
	if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("The drawing is not a PNG image.");
	if (typeof value.scene !== "string" || value.scene.length > MAX_SCENE_CHARS) throw new Error("The drawing's scene is missing or too large.");
	let scene: unknown;
	try { scene = JSON.parse(value.scene); } catch { throw new Error("The drawing's scene is not valid JSON."); }
	if (!scene || typeof scene !== "object" || (scene as { type?: unknown }).type !== "excalidraw") throw new Error("The drawing's scene is not an Excalidraw scene.");
	return { chatId: value.chatId, png, scene: value.scene };
}

const two = (n: number) => String(n).padStart(2, "0");
/** Local time, as people read it in the folder: YYYYMMDD-HHMMSS. */
function stamp(now: Date): string {
	return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
}

/** Writes a validated sketch; never overwrites (a same-second save gets -2, -3, …). */
export function writeSketch(dataDirectory: string, sketch: Sketch, options: SaveOptions = {}): SavedSketch {
	const by = options.by ?? "learner";
	const reason = options.reason?.trim();
	if (reason !== undefined && (!reason || reason.length > MAX_REASON)) throw new Error(`A reason must be 1–${MAX_REASON} characters.`);
	const now = options.now ?? new Date();
	const folder = path.join(dataDirectory, "sketches");
	mkdirSync(folder, { recursive: true });
	const base = `${stamp(now)}-${sketch.chatId}`;
	for (let n = 1; ; n++) {
		const name = n === 1 ? base : `${base}-${n}`;
		const file = (extension: string) => path.join(folder, `${name}.${extension}`);
		try { writeFileSync(file("png"), sketch.png, { flag: "wx" }); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") continue; throw error; }
		const meta: SavedSketch = { name, chatId: sketch.chatId, at: now.toISOString(), by, ...(reason ? { reason } : {}) };
		try {
			writeFileSync(file("excalidraw"), sketch.scene, { flag: "wx" });
			writeFileSync(file("json"), JSON.stringify({ chatId: meta.chatId, at: meta.at, by, ...(reason ? { reason } : {}) }, null, 2), { flag: "wx" });
		} catch (error) {
			for (const extension of ["png", "excalidraw", "json"]) rmSync(file(extension), { force: true });
			throw error;
		}
		return meta;
	}
}

export function saveSketch(dataDirectory: string, input: unknown, options: SaveOptions = {}): SavedSketch {
	return writeSketch(dataDirectory, validateSketch(input), options);
}

/** Newest first; unreadable entries are skipped. */
export function listSketches(dataDirectory: string): SavedSketch[] {
	const folder = path.join(dataDirectory, "sketches");
	if (!existsSync(folder)) return [];
	const sketches: SavedSketch[] = [];
	for (const file of readdirSync(folder)) {
		if (!file.endsWith(".json")) continue;
		const name = file.slice(0, -".json".length);
		if (!NAME.test(name)) continue;
		try {
			const meta = JSON.parse(readFileSync(path.join(folder, file), "utf8")) as Record<string, unknown>;
			if (typeof meta.chatId !== "string" || typeof meta.at !== "string" || (meta.by !== "learner" && meta.by !== "tutor")) continue;
			sketches.push({ name, chatId: meta.chatId, at: meta.at, by: meta.by, ...(typeof meta.reason === "string" ? { reason: meta.reason } : {}) });
		} catch { /* skip unreadable */ }
	}
	return sketches.sort((a, b) => b.at.localeCompare(a.at) || b.name.localeCompare(a.name));
}

export function readSketchImage(dataDirectory: string, name: string): string {
	if (!NAME.test(name)) throw new Error("Not a sketch name.");
	const file = path.join(dataDirectory, "sketches", `${name}.png`);
	if (!existsSync(file)) throw new Error("Sketch not found.");
	return readFileSync(file).toString("base64");
}

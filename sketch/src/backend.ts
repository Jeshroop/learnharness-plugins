// Sketch's server half: Save, the Sketches list, and the tutor's keep_sketch tool.
// Drawings that were sent are held in memory only, so nothing reaches disk unless
// the learner presses Save or the tutor keeps a drawing because it matters.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { PluginBackendContext } from "learnharness-plugin-api";
import { listSketches, readSketchImage, saveSketch, validateSketch, writeSketch, type Sketch } from "./save.ts";

export const KEEP_INSTRUCTIONS = [
	"Sketch pad: the learner can send a drawing of their working with an answer or message; it arrives as an image.",
	"Drawings are not kept unless they matter. When a drawing they sent shows an error in their working, or reasoning worth keeping,",
	"call keep_sketch with a one-line reason (once per drawing). Otherwise don't call it.",
].join(" ");

type ToolResult = { content: { type: "text"; text: string }[]; details: unknown; isError?: true };
const ok = (text: string, details: unknown = {}): ToolResult => ({ content: [{ type: "text", text }], details });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], details: {}, isError: true });

export function activate(ctx: PluginBackendContext): () => void {
	const sent = new Map<string, { sketch: Sketch; kept: boolean }>();

	const keepTool = (chatId: string): AgentTool<any> => ({
		name: "keep_sketch",
		label: "Keep sketch",
		description: "Keep the drawing the learner most recently sent in this chat from the Sketch pad, because it shows an error in their working or reasoning worth keeping. Drawings are otherwise not kept.",
		parameters: { type: "object", additionalProperties: false, required: ["reason"], properties: { reason: { type: "string", description: "One line: what the drawing shows, e.g. the error." } } } as never,
		executionMode: "sequential",
		execute: async (_toolCallId: string, input: unknown) => {
			const reason = typeof (input as { reason?: unknown })?.reason === "string" ? (input as { reason: string }).reason.trim() : "";
			if (!reason) return fail("Give a one-line reason for keeping the drawing.") as never;
			const entry = sent.get(chatId);
			if (!entry) return fail("No drawing has been sent in this chat since the app started, so there is nothing to keep.") as never;
			if (entry.kept) return fail("That drawing is already kept.") as never;
			try {
				const saved = writeSketch(ctx.dataDirectory, entry.sketch, { by: "tutor", reason });
				entry.kept = true;
				return ok(`Kept the drawing as ${saved.name}. The learner can see it under Sketches.`, { name: saved.name }) as never;
			} catch (error) {
				return fail(`Could not keep the drawing: ${(error as Error).message}`) as never;
			}
		},
	}) as unknown as AgentTool<any>;

	const off = [
		ctx.handle("sketch.save", input => saveSketch(ctx.dataDirectory, input)),
		ctx.handle("sketch.sent", input => {
			const sketch = validateSketch(input);
			sent.set(sketch.chatId, { sketch, kept: false });
			return { ok: true };
		}),
		ctx.handle("sketch.list", () => ({ sketches: listSketches(ctx.dataDirectory) })),
		ctx.handle("sketch.image", input => ({ png: readSketchImage(ctx.dataDirectory, String((input as { name?: unknown })?.name ?? "")) })),
		ctx.registerInstructions({ agents: ["teacher", "practice"], text: KEEP_INSTRUCTIONS }),
		ctx.registerTools({ agents: ["teacher", "practice"], create: context => [keepTool(context.chatId)] }),
	];
	return () => { for (const dispose of off) dispose(); sent.clear(); };
}

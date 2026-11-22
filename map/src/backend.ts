// The Map plugin's server half: the evidence log, the tutor's tools and
// instructions, reconciliation on turn events, and the view's operations.
import path from "node:path";
import type { PluginBackendContext } from "learnharness-plugin-api";
import { PRACTICE_INSTRUCTIONS, TEACHER_INSTRUCTIONS } from "./instructions.ts";
import { openLog } from "./log.ts";
import { reconcile } from "./reconcile.ts";
import type { RecordLike } from "./record.ts";
import { readyNext } from "./map.ts";
import { ideaStates } from "./rule.ts";
import { evidenceFor, loadMap, practiceTools, teacherTools, voidRecord, type Services } from "./tools.ts";
import { treeData } from "./view-model.ts";

const RECONCILE_ON = new Set(["turn-started", "turn-settled", "record-changed"]);

export function activate(ctx: PluginBackendContext): () => void {
	const log = openLog(path.join(ctx.dataDirectory, "evidence.jsonl"));
	const s: Services = { ctx, log };
	const off: (() => void)[] = [];

	off.push(ctx.registerInstructions({ agents: ["teacher"], text: TEACHER_INSTRUCTIONS }));
	off.push(ctx.registerInstructions({ agents: ["practice"], text: PRACTICE_INSTRUCTIONS }));
	off.push(ctx.registerTools({ agents: ["teacher"], create: context => teacherTools(s, context) }));
	off.push(ctx.registerTools({ agents: ["practice"], create: context => practiceTools(s, context) }));

	off.push(ctx.events.on(event => {
		const chatId = (event as { chatId?: unknown }).chatId;
		if (!RECONCILE_ON.has(event.type) || typeof chatId !== "string" || ctx.signal.aborted) return;
		let names: (id: string) => string | undefined = () => undefined;
		try { const model = loadMap(ctx); names = id => model.ideas.get(id)?.name; } catch { /* graph unreadable: names stay empty */ }
		reconcile(chatId, id => ctx.learning.getSession(id) as unknown as RecordLike | null, log, names)
			.then(count => { if (count) ctx.events.emit("changed", { chatId }); })
			.catch(() => { /* never break the host's turn */ });
	}));

	off.push(ctx.handle("map.tree", () => {
		const model = loadMap(ctx);
		const { events, damage } = log.read();
		const { states, orphans } = ideaStates(events, id => model.ideas.has(id));
		const passed = new Set([...states].filter(([, state]) => state.passed).map(([id]) => id));
		const titles = new Map(ctx.learning.listSessions().map(session => [session.id, session.title]));
		const verification = log.verify();
		return { ...treeData({ model, states, ready: readyNext(model, passed), orphans, damage: damage.length, titles }), ...(verification.ok ? {} : { edited: verification.firstBreak }) };
	}));
	off.push(ctx.handle("map.evidence", input => {
		const found = evidenceFor(s, String((input as { idea?: unknown } | null)?.idea ?? ""));
		if ("error" in found) throw new Error(found.error);
		return found;
	}));
	off.push(ctx.handle("map.void", input => voidRecord(s, input)));

	return () => { for (const dispose of off.splice(0)) dispose(); };
}

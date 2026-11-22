// The tutor's tools and the view's operations. Models supply pointers and
// judgements only; every learner word stored here is copied from the record.
import path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { PluginBackendContext, PluginToolContext } from "learnharness-plugin-api";
import type { IdeaKey, LoggedEvent, ObservedEvent, Quote, Result } from "./events.ts";
import type { EvidenceLog } from "./log.ts";
import { buildMap, readRelations, type ChainLine, type MapModel, type NodeLine } from "./map.ts";
import { reconcile } from "./reconcile.ts";
import { findQuote, learnerTexts, problemRuns, type RecordLike } from "./record.ts";
import { ideaStates, join, MIN_REASONING_WORDS, wordCount, type IdeaState } from "./rule.ts";

export interface Services { ctx: PluginBackendContext; log: EvidenceLog }
interface ToolResult { content: { type: "text"; text: string }[]; details: unknown; isError?: true }
type Observed = LoggedEvent & ObservedEvent;

const RESULTS: readonly Result[] = ["correct", "wrong", "dontKnow"];
const iso = (ms: number) => new Date(ms).toISOString();
const ok = (text: string, details: unknown = {}): ToolResult => ({ content: [{ type: "text", text }], details });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], details: {}, isError: true });

// ─── The graph, read fresh ────────────────────────────────────────────────────

export function loadMap(ctx: PluginBackendContext): MapModel {
	const read = <T>(name: "nodes.jsonl" | "chains.jsonl"): T[] => {
		try { return ctx.learning.readGraphFile(name) as unknown as T[]; } catch { return []; }
	};
	return buildMap(read<NodeLine>("nodes.jsonl"), read<ChainLine>("chains.jsonl"), readRelations(path.join(ctx.learning.directory, "graph", "relations.jsonl")));
}

const tokens = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
function closest(model: MapModel, query: string, count = 3): string[] {
	const wanted = tokens(query);
	return [...model.ideas.values()]
		.map(idea => {
			const have = tokens(idea.name);
			const shared = [...wanted].filter(t => have.has(t)).length;
			return { name: idea.name, score: shared / (new Set([...wanted, ...have]).size || 1) };
		})
		.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
		.slice(0, count).map(c => c.name);
}

/** An id, an exact name or an exact alias (case-insensitive) → one live idea. */
export function resolveIdea(model: MapModel, input: string): { id: string } | { error: string } {
	const raw = input.trim();
	if (model.ideas.has(raw)) return { id: raw };
	const lower = raw.toLowerCase();
	for (const field of ["name", "alias"] as const) {
		const hits = [...model.ideas.values()].filter(i => (field === "name" ? i.name.toLowerCase() === lower : i.aliases.some(a => a.toLowerCase() === lower)));
		if (hits.length === 1) return { id: hits[0]!.id };
		if (hits.length > 1) return { error: `"${raw}" matches several ideas: ${hits.map(h => `${h.name} [${h.id}]`).join(", ")}. Use the id.` };
	}
	return { error: `Not in the map: "${raw}" (closest: ${closest(model, raw).map(n => `"${n}"`).join(", ")}).` };
}

/** A verdict's or quote's idea → one of the declared keys, or null. */
function matchDeclared(model: MapModel, keys: readonly IdeaKey[], names: Record<IdeaKey, string>, input: string): IdeaKey | null {
	const raw = input.trim();
	if (keys.includes(raw)) return raw;
	if (keys.includes(`label:${raw}`)) return `label:${raw}`;
	const byName = keys.find(k => names[k]?.toLowerCase() === raw.toLowerCase());
	if (byName) return byName;
	const resolved = resolveIdea(model, raw);
	return "id" in resolved && keys.includes(resolved.id) ? resolved.id : null;
}

/** The time of the tutor's first saved reply after a message (∞ when there is none yet). */
function replyAfter(record: RecordLike, messageId: string): number {
	let seen = false;
	for (const raw of record.messages) {
		const m = raw as { id?: unknown; role?: unknown; timestamp?: unknown };
		if (!seen) { seen = m.id === messageId; continue; }
		if (m.role === "assistant" && typeof m.timestamp === "number") return m.timestamp;
	}
	return Number.POSITIVE_INFINITY;
}

function latestModel(record: RecordLike): { provider?: string; model?: string } {
	for (let index = record.messages.length - 1; index >= 0; index--) {
		const m = record.messages[index] as Record<string, unknown> | null;
		if (m?.role === "assistant" && typeof m.model === "string") return { ...(typeof m.provider === "string" ? { provider: m.provider } : {}), model: m.model };
	}
	return {};
}

function describe(model: MapModel, key: IdeaKey, names: Record<IdeaKey, string>, state: IdeaState | undefined): string {
	const name = model.ideas.get(key)?.name ?? names[key] ?? key.replace(/^label:/, "");
	if (!model.ideas.has(key)) return `${name}: not in the graph yet — link it with link_evidence once it appears.`;
	if (!state) return `${name}: no evidence yet.`;
	if (state.passed) return `${name}: passed${state.weakPass ? " (one more check later would make it solid)" : ""}.`;
	return `${name}: not passed yet (${state.path ?? "no path yet"}) — still needs ${state.needs.join(", ")}.`;
}

// ─── Tool bodies ─────────────────────────────────────────────────────────────

async function declareTested(s: Services, context: PluginToolContext, input: { ideas?: unknown; newIdeas?: unknown }, toolCallId: string): Promise<ToolResult> {
	const model = loadMap(s.ctx);
	const asked = Array.isArray(input.ideas) ? input.ideas.filter((x): x is string => typeof x === "string") : [];
	const fresh = Array.isArray(input.newIdeas) ? input.newIdeas.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
	if (asked.length + fresh.length === 0) return fail("Name at least one idea the question tests (ideas, or newIdeas for ideas not in the graph yet).");
	const keys: IdeaKey[] = [], names: Record<IdeaKey, string> = {}, problems: string[] = [];
	for (const raw of asked) {
		const resolved = resolveIdea(model, raw);
		if ("error" in resolved) { problems.push(resolved.error); continue; }
		if (!keys.includes(resolved.id)) { keys.push(resolved.id); names[resolved.id] = model.ideas.get(resolved.id)!.name; }
	}
	if (problems.length) return fail(`${problems.join(" ")} Use exact names or ids; put ideas not in the graph yet in newIdeas.`);
	for (const raw of fresh) {
		const key = `label:${raw.trim()}`;
		if (!keys.includes(key)) { keys.push(key); names[key] = raw.trim(); }
	}
	const logged = await s.log.append({ type: "declare", chatId: context.chatId, ...(toolCallId ? { toolCallId } : {}), ideas: keys, names });
	s.ctx.events.emit("changed", { chatId: context.chatId });
	return ok(`Declared ${logged.id} for your next question: ${keys.map(k => names[k]).join("; ")}. After the answer arrives, call record_attempt with declaration "${logged.id}".`, { declaration: logged.id, ideas: keys });
}

interface RecordInput { declaration?: unknown; verdicts?: unknown; quotes?: unknown }

async function recordAttempt(s: Services, context: PluginToolContext, input: RecordInput): Promise<ToolResult> {
	const { ctx, log } = s;
	const model = loadMap(ctx);
	const getSession = (id: string) => ctx.learning.getSession(id) as unknown as RecordLike | null;
	await reconcile(context.chatId, getSession, log, id => model.ideas.get(id)?.name);
	const record = getSession(context.chatId);
	if (!record) return fail("This chat's record is unavailable.");
	const events = log.read().events;
	const voided = new Set(events.flatMap(e => (e.type === "void" ? [e.target] : [])));

	let target: { sourceKey: string; posedAt: string; ideas: IdeaKey[]; names: Record<IdeaKey, string>; observed?: Observed };
	if (context.agent === "teacher") {
		if (typeof input.declaration !== "string") return fail("Give the declaration id that declare_tested returned.");
		const declaration = events.find(e => e.type === "declare" && e.id === input.declaration && e.chatId === context.chatId);
		if (!declaration) return fail(`There is no declaration ${input.declaration} in this chat.`);
		const observed = [...events].reverse().find((e): e is Observed => e.type === "observed" && e.declaration === declaration.id && !voided.has(e.id));
		if (!observed) return fail("The learner hasn't answered the question for that declaration yet (or dismissed it). Record it after the answer arrives.");
		target = { sourceKey: observed.sourceKey, posedAt: observed.posedAt, ideas: observed.ideas, names: observed.names, observed };
	} else {
		const run = problemRuns(record).at(-1);
		if (!run) return fail("No problem has been posed in this chat.");
		if (run.target.length === 0) return fail("This problem has no target ideas, so there is nothing to record.");
		const names = Object.fromEntries(run.target.map(id => [id, model.ideas.get(id)?.name ?? id]));
		target = { sourceKey: `${context.chatId}:${run.toolCallId}`, posedAt: iso(run.posedAt), ideas: run.target, names };
	}

	// One judgement per attempt: a second call can never overwrite the first.
	// Only the learner corrects, by voiding from the Map view.
	const existing = events.find(e => e.type === "judged" && !voided.has(e.id) && e.sourceKey === target.sourceKey
		&& (target.observed ? e.observed === target.observed.id : e.observed === undefined));
	if (existing) return fail(`Already recorded as ${existing.id}. If that judgement was wrong, the learner can void it from the Map view.`);

	const problems: string[] = [];
	const verdicts: { idea: IdeaKey; result: Result; variant: boolean; hinted?: true }[] = [];
	for (const raw of Array.isArray(input.verdicts) ? input.verdicts : []) {
		const v = (raw ?? {}) as { idea?: unknown; result?: unknown; variant?: unknown; hinted?: unknown };
		const key = matchDeclared(model, target.ideas, target.names, String(v.idea ?? ""));
		if (!key) { problems.push(`"${String(v.idea ?? "")}" was not declared for this question`); continue; }
		if (!RESULTS.includes(v.result as Result)) { problems.push(`the result for "${target.names[key] ?? key}" must be correct, wrong or dontKnow`); continue; }
		if (typeof v.variant !== "boolean") { problems.push(`say whether this is a variant for "${target.names[key] ?? key}"`); continue; }
		if (v.hinted !== undefined && typeof v.hinted !== "boolean") { problems.push(`hinted for "${target.names[key] ?? key}" must be true or false`); continue; }
		if (!verdicts.some(x => x.idea === key)) verdicts.push({ idea: key, result: v.result as Result, variant: v.variant, ...(v.hinted === true ? { hinted: true as const } : {}) });
	}
	const missing = target.ideas.filter(k => !verdicts.some(v => v.idea === k));
	if (missing.length) problems.push(`give a verdict for every declared idea — missing ${missing.map(k => `"${target.names[k] ?? k}"`).join(", ")}`);
	if (problems.length) return fail(`Not recorded: ${problems.join("; ")}.`);

	// Proof comes from the answer, the thinking box, or anything written
	// before the tutor replied — never words written after the tutor's reply.
	const until = target.observed ? replyAfter(record, target.observed.source.messageId) : Number.POSITIVE_INFINITY;
	const texts = learnerTexts(record, Date.parse(target.posedAt)).filter(t => t.at < until);
	const quotes: Quote[] = [];
	for (const raw of Array.isArray(input.quotes) ? input.quotes : []) {
		const q = (raw ?? {}) as { text?: unknown; shows?: unknown; kind?: unknown };
		if (q.kind !== "reasoning" && q.kind !== "confidence") return fail("Each quote's kind must be reasoning or confidence.");
		const shows = (Array.isArray(q.shows) ? q.shows : []).map(x => matchDeclared(model, target.ideas, target.names, String(x)));
		if (shows.length === 0 || shows.some(x => x === null)) return fail("Each quote must name the declared ideas it shows.");
		if (q.kind === "reasoning" && wordCount(String(q.text ?? "")) < MIN_REASONING_WORDS) {
			return fail(`Not recorded: a reasoning quote needs at least ${MIN_REASONING_WORDS} words of the learner's own reasoning: "${String(q.text ?? "")}".`);
		}
		const found = findQuote(texts, String(q.text ?? ""));
		if (!found) return fail(`Not recorded: that isn't in the learner's own words from the question up to before your reply — copy them exactly from their answer, thinking or earlier messages: "${String(q.text ?? "")}".`);
		quotes.push({
			kind: q.kind, shows: shows as IdeaKey[], text: found.text, sha256: found.sha256,
			source: { chatId: context.chatId, messageId: found.source.messageId, field: found.source.field, start: found.start, end: found.end, at: iso(found.source.at) },
		});
	}

	// The messages this judgement relies on: if one is taken back with Undo, reconcile voids it.
	const latest = learnerTexts(record, 0).at(-1)?.messageId;
	const anchors = [...new Set([...quotes.map(q => q.source.messageId), ...(latest ? [latest] : [])])];
	const logged = await log.append({
		type: "judged", chatId: context.chatId, sourceKey: target.sourceKey,
		...(target.observed ? { observed: target.observed.id } : {}), anchors, verdicts, quotes, grader: latestModel(record),
	});
	ctx.events.emit("changed", { chatId: context.chatId });
	try {
		const { states } = ideaStates(log.read().events, id => model.ideas.has(id));
		const lines = target.ideas.map(k => describe(model, k, target.names, states.get(k)));
		if (!target.observed) lines.push("Recorded. The outcome is read from your conclude when this turn ends.");
		return ok(lines.join("\n"), { judged: logged.id, states: target.ideas.flatMap(k => (states.has(k) ? [states.get(k)!] : [])) });
	} catch {
		return ok(`Recorded as ${logged.id}. (The map could not compute the new states just now.)`, { judged: logged.id, states: [] });
	}
}

/** An idea's state and its attempts, the learner's words verbatim. */
export function evidenceFor(s: Services, ideaInput: string): { idea: string; name: string; state: IdeaState | null; attempts: unknown[]; offMap: number } | { error: string } {
	const model = loadMap(s.ctx);
	const events = s.log.read().events;
	const { states, orphans } = ideaStates(events, id => model.ideas.has(id));
	const raw = ideaInput.trim();
	const orphan = orphans.find(o => o.key === raw || o.key === `label:${raw}` || o.name.toLowerCase() === raw.toLowerCase());
	const resolved = orphan ? { id: orphan.key } : resolveIdea(model, raw);
	if ("error" in resolved) return resolved;
	const idea = resolved.id;
	const { attempts, resolve } = join(events);
	const mine = attempts.filter(a => a.observed.ideas.some(k => resolve(k) === idea)).map(a => {
		const verdict = a.judged?.verdicts.find(v => resolve(v.idea) === idea);
		const answer = a.observed.answer;
		return {
			id: a.observed.id, at: a.observed.answer.answeredAt, voided: a.voided, format: a.observed.question.format,
			question: a.observed.question.text, result: answer.result, hinted: answer.hinted,
			...(answer.picks?.length ? { picks: answer.picks } : {}), ...(answer.thinking ? { thinking: answer.thinking } : {}),
			...(answer.text ? { text: answer.text } : {}), ...(answer.working?.length ? { working: answer.working } : {}),
			...(answer.confidence !== undefined ? { confidence: answer.confidence } : {}), ...(answer.outcome ? { outcome: answer.outcome } : {}),
			...(verdict ? { verdict: verdict.result, variant: verdict.variant } : {}),
			quotes: (a.judged?.quotes ?? []).filter(q => q.shows.some(k => resolve(k) === idea)).map(q => ({ kind: q.kind, text: q.text })),
			...(a.judged?.grader.model ? { grader: a.judged.grader.model } : {}),
		};
	});
	const name = model.ideas.get(idea)?.name ?? orphan?.name ?? idea;
	return { idea, name, state: states.get(idea) ?? null, attempts: mine, offMap: orphans.length };
}

async function readEvidence(s: Services, input: { idea?: unknown }): Promise<ToolResult> {
	const found = evidenceFor(s, String(input.idea ?? ""));
	if ("error" in found) return fail(found.error);
	const head = found.state ? describe(loadMap(s.ctx), found.idea, { [found.idea]: found.name }, found.state) : `${found.name}: no evidence yet.`;
	const body = (found.attempts as { at: string; question: string; result: string; verdict?: string; variant?: boolean; voided: boolean; quotes: { text: string }[] }[])
		.map(a => `- ${a.at.slice(0, 16)} ${a.voided ? "[voided] " : ""}${a.question} → ${a.verdict ?? a.result}${a.variant ? " (variant)" : ""}${a.quotes.length ? ` — quoted: ${a.quotes.map(q => `"${q.text}"`).join(" ")}` : ""}`);
	const tail = found.offMap ? [`${found.offMap} item(s) of evidence are off the map — see link_evidence.`] : [];
	return ok([head, ...body, ...tail].join("\n"), found);
}

async function linkEvidence(s: Services, input: { from?: unknown; to?: unknown; reason?: unknown }): Promise<ToolResult> {
	const model = loadMap(s.ctx);
	const { orphans } = ideaStates(s.log.read().events, id => model.ideas.has(id));
	const raw = String(input.from ?? "").trim();
	const from = orphans.find(o => o.key === raw || o.key === `label:${raw}` || o.name.toLowerCase() === raw.toLowerCase());
	if (!from) return fail(`Nothing off the map is called "${raw}". Off the map now: ${orphans.map(o => `"${o.name}"`).join(", ") || "nothing"}.`);
	const to = resolveIdea(model, String(input.to ?? ""));
	if ("error" in to) return fail(to.error);
	const reason = String(input.reason ?? "").trim();
	if (!reason) return fail("Give a short reason for the link.");
	await s.log.append({ type: "link", from: from.key, to: to.id, reason });
	s.ctx.events.emit("changed", {});
	return ok(`Linked "${from.name}" to "${model.ideas.get(to.id)!.name}".`, { from: from.key, to: to.id });
}

/** The learner's correction from the view. Never exposed as an agent tool. */
export async function voidRecord(s: Services, input: unknown): Promise<{ voided: string }> {
	const { eventId, reason } = (input ?? {}) as { eventId?: unknown; reason?: unknown };
	if (typeof reason !== "string" || !reason.trim()) throw new Error("A reason is required to void a record.");
	const events = s.log.read().events;
	const target = events.find(e => e.id === eventId);
	if (!target || target.type === "void") throw new Error("No such record.");
	if (events.some(e => e.type === "void" && e.target === eventId)) throw new Error("That record is already voided.");
	const logged = await s.log.append({ type: "void", target: target.id, reason: reason.trim(), by: "learner" });
	s.ctx.events.emit("changed", {});
	return { voided: logged.id };
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const strings = (description: string) => ({ type: "array", items: { type: "string" }, description });
const VERDICTS = {
	type: "array", minItems: 1,
	description: "One verdict per declared idea.",
	items: {
		type: "object", additionalProperties: false, required: ["idea", "result", "variant"],
		properties: {
			idea: { type: "string", description: "The idea's id or exact name." },
			result: { type: "string", enum: RESULTS },
			variant: { type: "boolean", description: "True when this differs in numbers or setup from every earlier question on the idea." },
			hinted: { type: "boolean", description: "True when the learner had help on this idea before answering (a hint from you or the side helper). Only lowers credit." },
		},
	},
};
const QUOTES = {
	type: "array",
	description: "The learner's own words, copied exactly from the chat since the question was asked.",
	items: {
		type: "object", additionalProperties: false, required: ["text", "shows", "kind"],
		properties: { text: { type: "string" }, shows: strings("The declared ideas this quote shows."), kind: { type: "string", enum: ["reasoning", "confidence"] } },
	},
};

function tool(s: Services, name: string, label: string, description: string, parameters: object, run: (input: Record<string, unknown>, toolCallId: string) => Promise<ToolResult>): AgentTool<any> {
	return {
		name, label, description, parameters: parameters as never, executionMode: "sequential",
		execute: async (toolCallId: string, input: unknown, signal?: AbortSignal) => {
			if (signal?.aborted || s.ctx.signal.aborted) throw new Error("Map tool cancelled");
			return run((input ?? {}) as Record<string, unknown>, toolCallId) as never;
		},
	} as unknown as AgentTool<any>;
}

function sharedTools(s: Services, context: PluginToolContext, recordDescription: string): AgentTool<any>[] {
	return [
		tool(s, "record_attempt", "Record attempt", recordDescription,
			{ type: "object", additionalProperties: false, required: ["verdicts"], properties: { declaration: { type: "string", description: "The id declare_tested returned (teaching questions)." }, verdicts: VERDICTS, quotes: QUOTES } },
			input => recordAttempt(s, context, input)),
		tool(s, "read_evidence", "Read evidence", "Read an idea's mastery state and the logged attempts behind it, the learner's words verbatim.",
			{ type: "object", additionalProperties: false, required: ["idea"], properties: { idea: { type: "string", description: "The idea's id or exact name, or an off-map label." } } },
			input => readEvidence(s, input)),
		tool(s, "link_evidence", "Link evidence", "Re-attribute evidence that is off the map (a declared new idea, or an idea that left the graph) to an idea in the graph.",
			{ type: "object", additionalProperties: false, required: ["from", "to", "reason"], properties: { from: { type: "string" }, to: { type: "string" }, reason: { type: "string" } } },
			input => linkEvidence(s, input)),
	];
}

export function teacherTools(s: Services, context: PluginToolContext): AgentTool<any>[] {
	return [
		tool(s, "declare_tested", "Declare tested ideas", "Declare the ideas the next question tests (quiz, explain, or a plugin question such as fill_in_blank), before asking it. Returns a declaration id for record_attempt.",
			{ type: "object", additionalProperties: false, required: ["ideas"], properties: { ideas: strings("Graph ids or exact names of the ideas it tests."), newIdeas: strings("Ideas it tests that are not in the graph yet.") } },
			(input, toolCallId) => declareTested(s, context, input, toolCallId)),
		...sharedTools(s, context, "Record the learner's attempt at the declared question after the answer arrives: a verdict per declared idea, whether it is a variant, and exact quotes of their words. Returns each idea's state."),
	];
}

export function practiceTools(s: Services, context: PluginToolContext): AgentTool<any>[] {
	return sharedTools(s, context, "Record the learner's attempt at the current problem when you conclude it: a verdict per target idea, whether it is a variant, and exact quotes from their working. Returns each idea's state.");
}

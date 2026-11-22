// Test-only stand-ins for the LearnHarness plugin contexts. They record every
// registration so tests can assert what the plugin wires up, and give the
// backend a disposable data directory.
import { mkdirSync, writeFileSync } from "node:fs";
import { tempDir } from "./tmp.ts";
import path from "node:path";
import type { PluginBackendContext, PluginFrontendContext } from "learnharness-plugin-api";

export interface Captured {
	instructions: { agents: string[]; text: string }[];
	tools: { agents: string[]; create: (context: { chatId: string; agent: string }) => unknown[] }[];
	handlers: Map<string, (input: unknown) => unknown>;
	listeners: ((event: { type: string; chatId?: string }) => void)[];
	emitted: { topic: string; data?: unknown }[];
}

export function fakeBackendContext(options: { sessions?: Map<string, unknown>; nodes?: unknown[]; chains?: unknown[]; relations?: unknown[] } = {}) {
	const dataDirectory = tempDir("map-plugin-data-");
	const learningDirectory = tempDir("map-learning-");
	if (options.relations) {
		mkdirSync(path.join(learningDirectory, "graph"), { recursive: true });
		writeFileSync(path.join(learningDirectory, "graph", "relations.jsonl"), options.relations.map(r => JSON.stringify(r)).join("\n") + "\n");
	}
	const graphFiles: Record<string, unknown[]> = { "nodes.jsonl": options.nodes ?? [], "chains.jsonl": options.chains ?? [] };
	const sessions = options.sessions ?? new Map<string, unknown>();
	const captured: Captured = { instructions: [], tools: [], handlers: new Map(), listeners: [], emitted: [] };
	const controller = new AbortController();
	const ctx = {
		manifest: { id: "map" },
		directory: path.join(dataDirectory, "..", "dist"),
		dataDirectory,
		signal: controller.signal,
		cleanup() {},
		learning: {
			directory: learningDirectory,
			listSessions: () => [...sessions.values()].map(s => ({ id: (s as { id: string }).id, title: (s as { title?: string }).title ?? "" })),
			getSession: (id: string) => (sessions.get(id) as never) ?? null,
			graph: () => { throw new Error("graph() is not used by the map plugin"); },
			readGraphFile: (name: string) => graphFiles[name] ?? [],
		},
		registerInstructions(contribution: { agents: string[]; text: string }) { captured.instructions.push(contribution); return () => {}; },
		registerTools(contribution: Captured["tools"][number]) { captured.tools.push(contribution); return () => {}; },
		handle(name: string, handler: (input: unknown) => unknown) { captured.handlers.set(name, handler); return () => {}; },
		events: {
			on(listener: Captured["listeners"][number]) { captured.listeners.push(listener); return () => {}; },
			emit(topic: string, data?: unknown) { captured.emitted.push({ topic, data }); },
		},
	};
	return { ctx: ctx as unknown as PluginBackendContext, captured, sessions, dataDirectory, learningDirectory, abort: () => controller.abort() };
}

export function fakeFrontendContext() {
	const views: unknown[] = [], actions: unknown[] = [], placements: unknown[] = [];
	const ctx = {
		manifest: { id: "map" },
		signal: new AbortController().signal,
		cleanup() {},
		registerView(view: unknown) { views.push(view); return () => {}; },
		registerAction(action: unknown) { actions.push(action); return () => {}; },
		placeAction(placement: unknown) { placements.push(placement); return () => {}; },
		onNotification: () => () => {},
		onAppEvent: () => () => {},
		onResync: () => () => {},
		call: async () => ({}),
		app: { openView() {}, pathname: () => "/" },
	};
	return { ctx: ctx as unknown as PluginFrontendContext, views, actions, placements };
}

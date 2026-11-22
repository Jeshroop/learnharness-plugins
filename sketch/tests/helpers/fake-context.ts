// Test-only stand-ins for the LearnHarness plugin contexts (Sketch).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginBackendContext, PluginFrontendContext } from "learnharness-plugin-api";

const made: string[] = [];
process.once("exit", () => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
export function tempDir(prefix: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), prefix));
	made.push(dir);
	return dir;
}

export function fakeFrontendContext() {
	const actions: { id: string }[] = [], placements: { id: string; actionId: string; location: string; sessions?: string[] }[] = [];
	const interceptors: { id: string; hasPendingInput?: (target: unknown) => boolean; intercept: (input: unknown, context: unknown) => unknown }[] = [];
	let refreshed = 0;
	const views: { id: string }[] = [];
	const ctx = {
		manifest: { id: "sketch" },
		signal: new AbortController().signal,
		cleanup() {},
		registerView(view: { id: string }) { views.push(view); return () => {}; },
		registerAction(action: { id: string }) { actions.push(action); return () => {}; },
		placeAction(placement: (typeof placements)[number]) { placements.push(placement); return () => {}; },
		registerSubmissionInterceptor(definition: (typeof interceptors)[number]) { interceptors.push(definition); return () => {}; },
		refreshSubmissions() { refreshed++; },
		onNotification: () => () => {},
		onAppEvent: () => () => {},
		onResync: () => () => {},
		call: async () => ({}),
		app: { openView() {}, pathname: () => "/" },
	};
	return { ctx: ctx as unknown as PluginFrontendContext, actions, placements, interceptors, views, refreshed: () => refreshed };
}

interface FakeTool { name: string; execute(toolCallId: string, input: unknown, signal?: AbortSignal): Promise<unknown> }
export function fakeBackendContext() {
	const dataDirectory = tempDir("sketch-data-");
	const handlers = new Map<string, (input: unknown) => unknown>();
	const creators = new Map<string, (context: { chatId: string; agent: string }) => FakeTool[]>();
	const instructions: { agents: string[]; text: string }[] = [];
	const ctx = {
		manifest: { id: "sketch" }, dataDirectory, signal: new AbortController().signal, cleanup() {},
		handle(name: string, handler: (input: unknown) => unknown) { handlers.set(name, handler); return () => {}; },
		events: { on: () => () => {}, emit() {} },
		registerTools(definition: { agents: string[]; create(context: { chatId: string; agent: string }): FakeTool[] }) {
			for (const agent of definition.agents) creators.set(agent, definition.create);
			return () => {};
		},
		registerInstructions(definition: { agents: string[]; text: string }) { instructions.push(definition); return () => {}; },
	};
	const toolsFor = (agent: string, chatId: string): FakeTool[] => creators.get(agent)?.({ chatId, agent }) ?? [];
	return { ctx: ctx as unknown as PluginBackendContext, handlers, dataDirectory, instructions, toolsFor };
}

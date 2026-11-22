// Test-only stand-ins for the LearnHarness plugin contexts (Formats).
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

export interface FakeTool { name: string; description: string; execute(toolCallId: string, input: unknown, signal?: AbortSignal): Promise<unknown> }
type Definition = Record<string, unknown> & { id: string };

export function fakeBackendContext(dataDirectory = tempDir("formats-data-")) {
	const handlers = new Map<string, (input: unknown) => unknown>();
	const questionTypes: Definition[] = [];
	const instructions: { agents: string[]; text: string }[] = [];
	const factories: { agents: string[]; create(context: { chatId: string; agent: string }): FakeTool[] }[] = [];
	const sessions = new Map<string, { messages: unknown[] }>();
	const ctx = {
		manifest: { id: "formats" }, dataDirectory, signal: new AbortController().signal, cleanup() {},
		handle(name: string, handler: (input: unknown) => unknown) { handlers.set(name, handler); return () => {}; },
		registerQuestionType(definition: Definition) { questionTypes.push(definition); return () => {}; },
		registerInstructions(definition: { agents: string[]; text: string }) { instructions.push(definition); return () => {}; },
		registerTools(definition: (typeof factories)[number]) { factories.push(definition); return () => {}; },
		events: { on: () => () => {}, emit() {} },
		learning: { getSession: (chatId: string) => sessions.get(chatId) ?? null },
	};
	const toolsFor = (agent: string, chatId: string): FakeTool[] =>
		factories.filter(f => f.agents.includes(agent)).flatMap(f => f.create({ chatId, agent }));
	return { ctx: ctx as unknown as PluginBackendContext, handlers, questionTypes, instructions, factories, sessions, toolsFor, dataDirectory };
}

export function fakeFrontendContext() {
	const renderers: { id: string }[] = [], actions: { id: string; run?: (context: unknown) => void }[] = [];
	const placements: { id: string; actionId: string; location: string; sessions?: string[] }[] = [];
	const calls: { name: string; input: unknown }[] = [];
	const ctx = {
		manifest: { id: "formats" }, signal: new AbortController().signal, cleanup() {},
		registerQuestionRenderer(renderer: { id: string }) { renderers.push(renderer); return () => {}; },
		registerAction(action: (typeof actions)[number]) { actions.push(action); return () => {}; },
		placeAction(placement: (typeof placements)[number]) { placements.push(placement); return () => {}; },
		call: async (name: string, input: unknown) => { calls.push({ name, input }); return {}; },
		ui: {},
		onNotification: () => () => {}, onAppEvent: () => () => {}, onResync: () => () => {},
	};
	return { ctx: ctx as unknown as PluginFrontendContext, renderers, actions, placements, calls };
}

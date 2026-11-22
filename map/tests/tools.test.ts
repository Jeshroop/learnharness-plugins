import { describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { activate } from "../src/backend.ts";
import { openLog } from "../src/log.ts";
import { fakeBackendContext, type Captured } from "./helpers/fake-context.ts";
import { call, marker, quizAnswer, result, type Message } from "./helpers/records.ts";

const node = (id: string, name: string) => ({ id, name, statement: `${name}.`, aliases: [], createdAt: "2026-01-05T10:00:00.000Z", provenance: [{ chatId: "chat_fm1", messageId: "msg_1" }] });
const nodes = [
	node("n_zero_acc", "Zero acceleration at maximum velocity"),
	node("n_fma", "F = ma for constant mass"),
	node("n_power", "Power of a driving force"),
	{ ...node("n_fma", "F equals m a") },
];
const signal = new AbortController().signal;
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const now = () => Date.now();

interface ToolResult { content: { type: string; text: string }[]; details: any; isError?: boolean }
type Tool = { name: string; execute(id: string, input: unknown, signal: AbortSignal): Promise<ToolResult> };
const toolsFor = (captured: Captured, agent: string, chatId = "chat_test") => Object.fromEntries(
	(captured.tools.find(t => t.agents.includes(agent))!.create({ chatId, agent }) as Tool[]).map(t => [t.name, t]),
) as Record<string, Tool>;
const text = (r: ToolResult) => r.content.map(c => c.text).join("\n");

function setup(messages: Message[] = []) {
	const chat = { id: "chat_test", title: "Mechanics", messages };
	const harness = fakeBackendContext({ sessions: new Map([["chat_test", chat]]), nodes, chains: [], relations: [] });
	activate(harness.ctx);
	const log = openLog(path.join(harness.dataDirectory, "evidence.jsonl"));
	const teacher = toolsFor(harness.captured, "teacher");
	// The host saves each tool call in the chat when the turn ends; mirror that
	// for declare_tested so pairing sees the declaration's call.
	const declare = teacher.declare_tested!;
	teacher.declare_tested = {
		...declare,
		execute: async (id, input, abort) => {
			const outcome = await declare.execute(id, input, abort);
			if (!outcome.isError) chat.messages.push({ ...call("declare_tested", id, input as Record<string, unknown>, 0), timestamp: now() });
			return outcome;
		},
	};
	return { ...harness, chat, log, teacher, practice: toolsFor(harness.captured, "practice") };
}
const answer = (callId: string, fields: Record<string, unknown>) => {
	const when = now();
	return [call("quiz", callId, { question: "q" }, 0), result(callId, "quiz", quizAnswer(0, { answeredAt: new Date(when).toISOString(), ...fields }), 0)];
};

describe("teacher flow", () => {
	test("declare → answer → record twice: a wrong first answer then a quoted correct variant passes", async () => {
		const { teacher, chat, log } = setup();
		const d1 = await teacher.declare_tested!.execute("t1", { ideas: ["Zero acceleration at maximum velocity"] }, signal);
		assert.ok(!d1.isError, text(d1));
		await tick();
		chat.messages.push(...answer("call_q1", { questionText: "Find the car's greatest speed.", correct: false, thinking: "Gravity alone." }));
		await tick();
		const r1 = await teacher.record_attempt!.execute("t2", { declaration: d1.details.declaration, verdicts: [{ idea: "Zero acceleration at maximum velocity", result: "wrong", variant: false }] }, signal);
		assert.ok(!r1.isError, text(r1));
		const d2 = await teacher.declare_tested!.execute("t3", { ideas: ["n_zero_acc"] }, signal);
		await tick();
		chat.messages.push(...answer("call_q2", { questionText: "Find the cyclist's greatest speed.", correct: true, thinking: "Top speed is reached when the driving\nforce equals the resistance." }));
		await tick();
		const r2 = await teacher.record_attempt!.execute("t4", {
			declaration: d2.details.declaration,
			verdicts: [{ idea: "n_zero_acc", result: "correct", variant: true }],
			quotes: [{ text: "Top speed is reached when the driving force equals the resistance.", shows: ["n_zero_acc"], kind: "reasoning" }],
		}, signal);
		assert.ok(!r2.isError, text(r2));
		const state = r2.details.states.find((s: { idea: string }) => s.idea === "n_zero_acc");
		assert.equal(state.path, "wrong-first");
		assert.equal(state.passed, true);
		assert.deepEqual(log.read().events.map(e => e.type), ["declare", "observed", "judged", "declare", "observed", "judged"]);
		const judged = log.read().events[5] as { quotes: { text: string }[]; observed?: string };
		assert.equal(judged.quotes[0]!.text, "Top speed is reached when the driving\nforce equals the resistance.");
		assert.equal(judged.observed, log.read().events[4]!.id);
	});

	test("names, aliases and new ideas resolve; an unknown name is refused with the closest names", async () => {
		const { teacher, log } = setup();
		const alias = await teacher.declare_tested!.execute("t1", { ideas: ["f equals m a"], newIdeas: ["Power at top speed"] }, signal);
		assert.deepEqual(alias.details.ideas, ["n_fma", "label:Power at top speed"]);
		const unknown = await teacher.declare_tested!.execute("t2", { ideas: ["Greatest power of a driving engine"] }, signal);
		assert.equal(unknown.isError, true);
		assert.match(text(unknown), /Not in the map: "Greatest power of a driving engine"/);
		assert.match(text(unknown), /Power of a driving force/);
		assert.equal(log.read().events.length, 1);
	});

	test("recording before he has answered is refused", async () => {
		const { teacher, log } = setup();
		const d1 = await teacher.declare_tested!.execute("t1", { ideas: ["n_fma"] }, signal);
		const early = await teacher.record_attempt!.execute("t2", { declaration: d1.details.declaration, verdicts: [{ idea: "n_fma", result: "correct", variant: false }] }, signal);
		assert.equal(early.isError, true);
		assert.match(text(early), /hasn't answered/);
		assert.equal(log.read().events.length, 1);
	});

	test("a quote that is not in his own words is refused and nothing is logged", async () => {
		const { teacher, chat, log } = setup();
		const d1 = await teacher.declare_tested!.execute("t1", { ideas: ["n_fma"] }, signal);
		await tick();
		chat.messages.push(...answer("call_q1", { correct: true, thinking: "Mass is constant here." }));
		await tick();
		const bad = await teacher.record_attempt!.execute("t2", {
			declaration: d1.details.declaration, verdicts: [{ idea: "n_fma", result: "correct", variant: false }],
			quotes: [{ text: "Newton's second law with constant mass.", shows: ["n_fma"], kind: "reasoning" }],
		}, signal);
		assert.equal(bad.isError, true);
		assert.match(text(bad), /copy them exactly/);
		assert.deepEqual(log.read().events.map(e => e.type), ["declare", "observed"]);
	});

	test("verdicts must cover exactly the declared ideas", async () => {
		const { teacher, chat } = setup();
		const d1 = await teacher.declare_tested!.execute("t1", { ideas: ["n_fma", "n_power"] }, signal);
		await tick();
		chat.messages.push(...answer("call_q1", { correct: true }));
		await tick();
		const missing = await teacher.record_attempt!.execute("t2", { declaration: d1.details.declaration, verdicts: [{ idea: "n_fma", result: "correct", variant: false }] }, signal);
		assert.equal(missing.isError, true);
		assert.match(text(missing), /Power of a driving force/);
		const extra = await teacher.record_attempt!.execute("t3", { declaration: d1.details.declaration, verdicts: [
			{ idea: "n_fma", result: "correct", variant: false }, { idea: "n_power", result: "correct", variant: false }, { idea: "n_zero_acc", result: "correct", variant: false },
		] }, signal);
		assert.equal(extra.isError, true);
		assert.match(text(extra), /not declared/);
	});
});

describe("final-review fixes", () => {
	test("recording the same attempt twice is refused", async () => {
		const { teacher, chat, log } = setup();
		const d1 = await teacher.declare_tested!.execute("t1", { ideas: ["n_fma"] }, signal);
		await tick();
		chat.messages.push(...answer("call_q1", { correct: true }));
		await tick();
		const first = await teacher.record_attempt!.execute("t2", { declaration: d1.details.declaration, verdicts: [{ idea: "n_fma", result: "correct", variant: false }] }, signal);
		assert.ok(!first.isError, text(first));
		const second = await teacher.record_attempt!.execute("t3", { declaration: d1.details.declaration, verdicts: [{ idea: "n_fma", result: "wrong", variant: false }] }, signal);
		assert.equal(second.isError, true);
		assert.match(text(second), /Already recorded/);
		assert.equal(log.read().events.filter(e => e.type === "judged").length, 1);
	});

	test("a malformed log line is reported as damage and the map still loads", async () => {
		const { captured, dataDirectory } = setup();
		const { appendFileSync } = await import("node:fs");
		appendFileSync(path.join(dataDirectory, "evidence.jsonl"), `${JSON.stringify({ v: 1, id: "ev_aaaaaaaaaaaa", at: new Date().toISOString(), prev: "0".repeat(64), type: "judged", chatId: "c", sourceKey: "c:x", verdicts: [null], quotes: [], grader: {} })}\n`);
		const tree = await captured.handlers.get("map.tree")!(undefined) as { damage: number };
		assert.equal(tree.damage, 1);
	});

	test("an edited log line is reported by the map", async () => {
		const { teacher, captured, dataDirectory } = setup();
		await teacher.declare_tested!.execute("t1", { ideas: ["n_fma"] }, signal);
		await teacher.declare_tested!.execute("t2", { ideas: ["n_power"] }, signal);
		const { readFileSync, writeFileSync } = await import("node:fs");
		const file = path.join(dataDirectory, "evidence.jsonl");
		writeFileSync(file, readFileSync(file, "utf8").replace("F = ma for constant mass", "F = ma, edited"));
		const tree = await captured.handlers.get("map.tree")!(undefined) as { edited?: number };
		assert.equal(tree.edited, 1);
	});
});

describe("rulings on proof and help", () => {
	const answered = async (thinking: string) => {
		const s = setup();
		const d1 = await s.teacher.declare_tested!.execute("t1", { ideas: ["n_power"] }, signal);
		await tick();
		s.chat.messages.push(...answer("call_q1", { correct: true, thinking }));
		await tick();
		return { ...s, declaration: d1.details.declaration as string };
	};

	test("words written after the tutor replied cannot be quoted; the thinking written with the answer can", async () => {
		const { teacher, chat, declaration } = await answered("Speed is greatest when the forces balance out.");
		chat.messages.push({ id: "msg_tutor", role: "assistant", provider: "claude-code", model: "sonnet", timestamp: now(), content: [{ type: "text", text: "Right — at top speed the driving force equals the resistance." }] });
		await tick();
		chat.messages.push({ id: "msg_echo", role: "user", content: "Oh right, the driving force equals the resistance at top speed.", timestamp: now() });
		await tick();
		const echo = await teacher.record_attempt!.execute("t2", { declaration, verdicts: [{ idea: "n_power", result: "correct", variant: false }], quotes: [{ text: "the driving force equals the resistance at top speed", shows: ["n_power"], kind: "reasoning" }] }, signal);
		assert.equal(echo.isError, true);
		assert.match(text(echo), /before your reply/);
		const own = await teacher.record_attempt!.execute("t3", { declaration, verdicts: [{ idea: "n_power", result: "correct", variant: false }], quotes: [{ text: "Speed is greatest when the forces balance out.", shows: ["n_power"], kind: "reasoning" }] }, signal);
		assert.ok(!own.isError, text(own));
	});

	test("a reasoning quote under three words is refused", async () => {
		const { teacher, declaration } = await answered("Balanced forces.");
		const short = await teacher.record_attempt!.execute("t2", { declaration, verdicts: [{ idea: "n_power", result: "correct", variant: false }], quotes: [{ text: "Balanced forces.", shows: ["n_power"], kind: "reasoning" }] }, signal);
		assert.equal(short.isError, true);
		assert.match(text(short), /at least 3 words/);
	});

	test("a verdict can be marked as helped and is stored that way", async () => {
		const { teacher, declaration, log } = await answered("Speed is greatest when the forces balance out.");
		const helped = await teacher.record_attempt!.execute("t2", { declaration, verdicts: [{ idea: "n_power", result: "correct", variant: false, hinted: true }] }, signal);
		assert.ok(!helped.isError, text(helped));
		const judged = log.read().events.find(e => e.type === "judged") as { verdicts: { hinted?: boolean }[] };
		assert.equal(judged.verdicts[0]!.hinted, true);
	});
});

describe("practice flow", () => {
	test("a judgement made before the conclusion settles with it on turn-settled", async () => {
		const posed = now();
		const messages: Message[] = [
			{ ...call("problem", "call_p1", { statement: "Find the driving force at 20 m/s.", mode: "recall", target: ["n_power"], modelSolution: "…" }, 0), timestamp: posed },
			{ ...result("call_p1", "problem", null, 0), timestamp: posed },
		];
		const { practice, chat, log, captured } = setup(messages);
		await tick();
		chat.messages.push({ ...marker("practice-thinking", { problemCallId: "call_p1", text: "P = Fv so F = P/v." }, 0), timestamp: now() });
		await tick();
		const judged = await practice.record_attempt!.execute("t1", {
			verdicts: [{ idea: "n_power", result: "correct", variant: false }],
			quotes: [{ text: "P = Fv so F = P/v.", shows: ["n_power"], kind: "reasoning" }],
		}, signal);
		assert.ok(!judged.isError, text(judged));
		assert.deepEqual(log.read().events.map(e => e.type), ["judged"]);
		chat.messages.push(
			{ ...call("conclude", "call_c1", { outcome: "solved", verdict: "…", rung: null, missClass: null, retest: false }, 0), timestamp: now() },
			{ ...result("call_c1", "conclude", null, 0), timestamp: now() },
		);
		captured.listeners[0]!({ type: "turn-settled", chatId: "chat_test" });
		for (let i = 0; i < 50 && log.read().events.length < 2; i++) await tick();
		assert.deepEqual(log.read().events.map(e => e.type), ["judged", "observed"]);
		const evidence = await practice.read_evidence!.execute("t2", { idea: "Power of a driving force" }, signal);
		assert.equal(evidence.details.state.attempts, 1);
		assert.equal(evidence.details.state.path, "right-first");
	});
});

describe("view handlers", () => {
	test("void needs a reason, a known target and is accepted once", async () => {
		const { teacher, chat, log, captured } = setup();
		const d1 = await teacher.declare_tested!.execute("t1", { ideas: ["n_fma"] }, signal);
		await tick();
		chat.messages.push(...answer("call_q1", { correct: false }));
		await tick();
		await teacher.record_attempt!.execute("t2", { declaration: d1.details.declaration, verdicts: [{ idea: "n_fma", result: "wrong", variant: false }] }, signal);
		const observedId = log.read().events.find(e => e.type === "observed")!.id;
		const voidIt = captured.handlers.get("map.void")!;
		await assert.rejects(async () => voidIt({ eventId: observedId, reason: "  " }), /reason/);
		await assert.rejects(async () => voidIt({ eventId: "ev_000000000000", reason: "misclick" }), /no such/i);
		await voidIt({ eventId: observedId, reason: "I misclicked" });
		await assert.rejects(async () => voidIt({ eventId: observedId, reason: "again" }), /already/);
		const last = log.read().events.at(-1)!;
		assert.deepEqual({ type: last.type, target: (last as { target?: string }).target, by: (last as { by?: string }).by }, { type: "void", target: observedId, by: "learner" });
	});

	test("evidence for an idea lists its attempts with his words", async () => {
		const { teacher, chat, captured } = setup();
		const d1 = await teacher.declare_tested!.execute("t1", { ideas: ["n_fma"] }, signal);
		await tick();
		chat.messages.push(...answer("call_q1", { questionText: "Why is F = ma valid here?", correct: true, thinking: "The mass never changes." }));
		await tick();
		await teacher.record_attempt!.execute("t2", { declaration: d1.details.declaration, verdicts: [{ idea: "n_fma", result: "correct", variant: false }] }, signal);
		const evidence = await captured.handlers.get("map.evidence")!({ idea: "n_fma" }) as { state: { attempts: number }; attempts: { question: string; thinking?: string }[] };
		assert.equal(evidence.state.attempts, 1);
		assert.equal(evidence.attempts[0]!.question, "Why is F = ma valid here?");
		assert.equal(evidence.attempts[0]!.thinking, "The mass never changes.");
	});
});

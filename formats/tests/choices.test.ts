import { test } from "node:test";
import assert from "node:assert/strict";
import { createChoiceStore, questionPosedSince, validChatId } from "../src/choices.ts";
import { currentChoice, formatTools } from "../src/format-tool.ts";
import { tempDir } from "./helpers/fake-context.ts";

const call = (name: string) => ({ role: "assistant", content: [{ type: "toolCall", id: `c-${name}`, name, arguments: {} }] });
const plugin = { role: "assistant", content: [{ type: "toolCall", id: "c-p", name: "fill_in_blank", arguments: {} }], lhQuestions: { 0: { questionId: "q1", pluginId: "formats" } } };
const user = { role: "user", content: "hi" };

test("a choice kept for the chat survives a restart; a one-shot choice doesn't", () => {
	const dir = tempDir("formats-store-");
	const store = createChoiceStore(dir);
	store.set("chat_a", "blank", true);
	store.set("chat_b", "graph", false);
	const again = createChoiceStore(dir);
	assert.deepEqual(again.get("chat_a"), { format: "blank", keep: true });
	assert.equal(again.get("chat_b"), undefined);
});

test("'Tutor decides' removes the choice, kept or not", () => {
	const dir = tempDir("formats-store-");
	const store = createChoiceStore(dir);
	store.set("chat_a", "blank", true);
	store.set("chat_a", "auto", false);
	assert.equal(store.get("chat_a"), undefined);
	assert.equal(createChoiceStore(dir).get("chat_a"), undefined);
});

test("only a real question posed after the choice counts", () => {
	const record = { messages: [user, call("quiz"), user] };
	assert.equal(questionPosedSince(record, 0), true);
	assert.equal(questionPosedSince(record, 2), false);
	assert.equal(questionPosedSince({ messages: [user, plugin] }, 1), true);
	assert.equal(questionPosedSince({ messages: [user, call("ask_user_question")] }, 1), false);
	assert.equal(questionPosedSince({ messages: [user, call("probe")] }, 0), true);
});

test("chat ids are checked before they become storage keys", () => {
	assert.equal(validChatId("chat_mvo6ipv6_8c1d"), true);
	for (const bad of ["", "../x", "__proto__", "a b", "x".repeat(200)]) assert.equal(validChatId(bad), false, bad);
});

test("the tutor hears about a one-shot choice until a question has been posed", async () => {
	const store = createChoiceStore(tempDir("formats-store-"));
	const sessions = new Map<string, { messages: unknown[] }>([["chat_a", { messages: [user] }]]);
	const get = (id: string) => sessions.get(id) ?? null;
	assert.deepEqual(formatTools(store, get, { chatId: "chat_a", agent: "teacher" }), []);
	store.set("chat_a", "blank", false);
	const [tool] = formatTools(store, get, { chatId: "chat_a", agent: "teacher" });
	assert.equal(tool?.name, "question_format");
	assert.match(tool!.description, /next question/i);
	assert.match(tool!.description, /fill_in_blank/);
	const result = await tool!.execute("t1", {}) as { content: { text: string }[] };
	assert.equal(JSON.parse(result.content[0]!.text).format, "blank");
	sessions.set("chat_a", { messages: [user, user, call("quiz")] }); // a question was posed (in another format)
	assert.deepEqual(formatTools(store, get, { chatId: "chat_a", agent: "teacher" }), []);
	assert.equal(store.get("chat_a"), undefined);
});

test("a kept choice stays after questions, and the prober hears its own tool names", () => {
	const store = createChoiceStore(tempDir("formats-store-"));
	store.set("chat_a", "graph", true);
	const get = () => ({ messages: [user, call("probe"), call("quiz")] });
	const [tool] = formatTools(store, get, { chatId: "chat_a", agent: "prober" });
	assert.match(tool!.description, /this chat/i);
	assert.match(tool!.description, /probe_choose_graph/);
});

test("a choice made while the tutor is still answering survives that turn's question (the tutor hadn't seen it)", () => {
	const store = createChoiceStore(tempDir("formats-store-"));
	const sessions = new Map<string, { messages: unknown[] }>([["chat_a", { messages: [user] }]]);
	const get = (id: string) => sessions.get(id) ?? null;
	store.set("chat_a", "graph", false);                                   // chosen mid-turn…
	sessions.set("chat_a", { messages: [user, call("quiz")] });            // …and that turn ends with a question
	assert.equal(formatTools(store, get, { chatId: "chat_a", agent: "teacher" }).length, 1, "still offered next turn");
	sessions.set("chat_a", { messages: [user, call("quiz"), user, call("quiz")] }); // a question after the tutor saw it
	assert.deepEqual(formatTools(store, get, { chatId: "chat_a", agent: "teacher" }), []);
});

test("Undo below the window re-anchors it, so the choice still covers exactly one question", () => {
	const store = createChoiceStore(tempDir("formats-store-"));
	const sessions = new Map<string, { messages: unknown[] }>([["chat_a", { messages: [user, user, user, user, user] }]]);
	const get = (id: string) => sessions.get(id) ?? null;
	store.set("chat_a", "blank", false);
	formatTools(store, get, { chatId: "chat_a", agent: "teacher" });       // seen at length 5
	sessions.set("chat_a", { messages: [user, user, user] });              // Undo
	assert.equal(formatTools(store, get, { chatId: "chat_a", agent: "teacher" }).length, 1);
	sessions.set("chat_a", { messages: [user, user, user, call("quiz")] }); // a question at index 3
	assert.deepEqual(formatTools(store, get, { chatId: "chat_a", agent: "teacher" }), []);
});

test("a question call that failed doesn't use up the choice", () => {
	const store = createChoiceStore(tempDir("formats-store-"));
	const failed = { role: "toolResult", toolCallId: "c-quiz", toolName: "quiz", isError: true, content: [] };
	const sessions = new Map<string, { messages: unknown[] }>([["chat_a", { messages: [user] }]]);
	const get = (id: string) => sessions.get(id) ?? null;
	store.set("chat_a", "graph", false);
	formatTools(store, get, { chatId: "chat_a", agent: "teacher" });
	sessions.set("chat_a", { messages: [user, call("quiz"), failed] });
	assert.equal(formatTools(store, get, { chatId: "chat_a", agent: "teacher" }).length, 1);
});

test("the dialog shows a used-up choice as gone, without starting the window itself", () => {
	const store = createChoiceStore(tempDir("formats-store-"));
	const sessions = new Map<string, { messages: unknown[] }>([["chat_a", { messages: [user] }]]);
	const get = (id: string) => sessions.get(id) ?? null;
	store.set("chat_a", "blank", false);
	sessions.set("chat_a", { messages: [user, call("quiz")] });
	assert.equal(currentChoice(store, get, "chat_a")?.format, "blank", "unseen: still pending");
	formatTools(store, get, { chatId: "chat_a", agent: "teacher" });
	sessions.set("chat_a", { messages: [user, call("quiz"), user, call("quiz")] });
	assert.equal(currentChoice(store, get, "chat_a"), undefined, "used up after the tutor saw it");
});

test("a broken record never makes the tool factory throw", () => {
	const store = createChoiceStore(tempDir("formats-store-"));
	store.set("chat_a", "blank", false);
	assert.deepEqual(formatTools(store, () => { throw new Error("unreadable"); }, { chatId: "chat_a", agent: "teacher" }).length, 1);
	assert.deepEqual(formatTools(store, () => ({ messages: "nope" } as never), { chatId: "chat_a", agent: "teacher" }).length, 1);
});

test("a one-shot written choice is used up by ask_user_question, the fallback the tutor is told to use without explain", () => {
	const store = createChoiceStore(tempDir("formats-choice-"));
	const record = { messages: [user] as unknown[] };
	store.set("chat_w", "written", false);
	formatTools(store, () => record, { chatId: "chat_w", agent: "teacher" }); // the tutor sees it: the window starts
	record.messages.push(call("ask_user_question"));
	assert.equal(currentChoice(store, () => record, "chat_w"), undefined, "used up");
	store.set("chat_b", "blank", false);
	const other = { messages: [user] as unknown[] };
	formatTools(store, () => other, { chatId: "chat_b", agent: "teacher" });
	other.messages.push(call("ask_user_question"));
	assert.equal(currentChoice(store, () => other, "chat_b")?.format, "blank", "a preference question doesn't use up another format");
});

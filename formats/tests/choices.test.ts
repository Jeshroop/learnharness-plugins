import { test } from "node:test";
import assert from "node:assert/strict";
import { createChoiceStore, questionPosedSince, validChatId } from "../src/choices.ts";
import { formatTools } from "../src/format-tool.ts";
import { tempDir } from "./helpers/fake-context.ts";

const call = (name: string) => ({ role: "assistant", content: [{ type: "toolCall", id: `c-${name}`, name, arguments: {} }] });
const plugin = { role: "assistant", content: [{ type: "toolCall", id: "c-p", name: "fill_in_blank", arguments: {} }], lhQuestions: { 0: { questionId: "q1", pluginId: "formats" } } };
const user = { role: "user", content: "hi" };

test("a choice kept for the chat survives a restart; a one-shot choice doesn't", () => {
	const dir = tempDir("formats-store-");
	const store = createChoiceStore(dir);
	store.set("chat_a", "blank", true, 3);
	store.set("chat_b", "graph", false, 3);
	const again = createChoiceStore(dir);
	assert.deepEqual(again.get("chat_a"), { format: "blank", keep: true, since: 0 });
	assert.equal(again.get("chat_b"), undefined);
});

test("'Tutor decides' removes the choice, kept or not", () => {
	const dir = tempDir("formats-store-");
	const store = createChoiceStore(dir);
	store.set("chat_a", "blank", true, 0);
	store.set("chat_a", "auto", false, 0);
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
	store.set("chat_a", "blank", false, 1);
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
	store.set("chat_a", "graph", true, 0);
	const get = () => ({ messages: [user, call("probe"), call("quiz")] });
	const [tool] = formatTools(store, get, { chatId: "chat_a", agent: "prober" });
	assert.match(tool!.description, /this chat/i);
	assert.match(tool!.description, /probe_choose_graph/);
});

test("a broken record never makes the tool factory throw", () => {
	const store = createChoiceStore(tempDir("formats-store-"));
	store.set("chat_a", "blank", false, 0);
	assert.deepEqual(formatTools(store, () => { throw new Error("unreadable"); }, { chatId: "chat_a", agent: "teacher" }).length, 1);
	assert.deepEqual(formatTools(store, () => ({ messages: "nope" } as never), { chatId: "chat_a", agent: "teacher" }).length, 1);
});

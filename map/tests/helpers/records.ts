// Hand-built chat records in LearnHarness's native message shapes. All content
// is invented; timestamps are explicit so tests can reason about order.

export type Message = Record<string, unknown> & { id: string; role: string; timestamp: number };
let counter = 0;
const id = (prefix: string) => `${prefix}_${(++counter).toString(36).padStart(4, "0")}`;

export const at = (minute: number) => Date.UTC(2026, 0, 5, 10, minute);
export const iso = (minute: number) => new Date(at(minute)).toISOString();

export function user(text: string, minute: number): Message {
	return { id: id("msg"), role: "user", content: text, timestamp: at(minute) };
}

export function call(name: string, toolCallId: string, args: Record<string, unknown>, minute: number): Message {
	return {
		id: id("msg"), role: "assistant", provider: "claude-code", model: "sonnet", timestamp: at(minute),
		content: [{ type: "toolCall", id: toolCallId, name, arguments: args }],
	};
}

export function result(toolCallId: string, toolName: string, details: unknown, minute: number, isError = false): Message {
	return { id: id("msg"), role: "toolResult", toolCallId, toolName, content: [{ type: "text", text: "" }], details, isError, timestamp: at(minute) };
}

export function marker(customType: string, details: unknown, minute: number, content = ""): Message {
	return { id: id("msg"), role: "custom", customType, content, display: true, details, timestamp: at(minute) };
}

export function quizAnswer(minute: number, fields: Record<string, unknown>): Record<string, unknown> {
	return {
		kind: "quiz", tool: "quiz", questionText: "Which force keeps the bead on the hoop?",
		options: [{ index: 1, label: "Tension" }, { index: 2, label: "Normal reaction" }],
		answers: [{ label: "Normal reaction", value: "normal", index: 2 }],
		dontKnow: false, answeredAt: iso(minute), ...fields,
	};
}

export function record(messages: Message[], extra: Record<string, unknown> = {}) {
	return { id: "chat_test", title: "Test chat", createdAt: iso(0), updatedAt: iso(59), messages, ...extra };
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { createPadToggle, type PadSurface } from "../src/pad-toggle.ts";

/** A host like LearnHarness: content mounts at once; disposing runs its cleanup and never calls onClose. */
function host() {
	const opened: { pad: PadSurface; disposed: boolean; cleanup: () => void }[] = [];
	const toggle = createPadToggle(pad => {
		const entry = { pad, disposed: false, cleanup: pad.departs(() => {}) };
		opened.push(entry);
		return { dispose() { entry.disposed = true; entry.cleanup(); } };
	});
	return { toggle, opened };
}
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test("clicking Sketch opens the chat's pad, and clicking again closes it", async () => {
	const { toggle, opened } = host();
	toggle.toggle("chat_a");
	assert.equal(opened.length, 1);
	assert.equal(toggle.openFor(), "chat_a");
	toggle.toggle("chat_a");
	await tick();
	assert.equal(opened[0]!.disposed, true);
	assert.equal(opened[0]!.pad.signal.aborted, true);
	assert.equal(toggle.openFor(), undefined);
	assert.equal(opened.length, 1);
});

test("after the host disposes the pad without onClose (leaving the page), the next click opens it again", async () => {
	const { toggle, opened } = host();
	toggle.toggle("chat_a");
	opened[0]!.cleanup(); // page leave: the content departs, onClose is never called
	await tick();
	assert.equal(toggle.openFor(), undefined);
	toggle.toggle("chat_a");
	assert.equal(opened.length, 2);
	assert.equal(toggle.openFor(), "chat_a");
});

test("a content mount the host replays at once does not count as leaving", async () => {
	const { toggle, opened } = host();
	toggle.toggle("chat_a");
	const first = opened[0]!;
	first.cleanup();
	first.cleanup = first.pad.departs(() => {});
	await tick();
	assert.equal(toggle.openFor(), "chat_a");
});

test("opening another chat's pad closes the first", async () => {
	const { toggle, opened } = host();
	toggle.toggle("chat_a");
	toggle.toggle("chat_b");
	await tick();
	assert.equal(opened[0]!.disposed, true);
	assert.equal(toggle.openFor(), "chat_b");
});

test("the surface's own close (X or Escape) closes the pad", async () => {
	const { toggle, opened } = host();
	toggle.toggle("chat_a");
	opened[0]!.pad.close();
	assert.equal(toggle.openFor(), undefined);
	toggle.toggle("chat_a");
	assert.equal(opened.length, 2);
});

test("if opening fails, the next click tries again", () => {
	let fail = true;
	const toggle = createPadToggle(() => { if (fail) throw new Error("no page boundary"); return { dispose() {} }; });
	assert.throws(() => toggle.toggle("chat_a"), /no page boundary/);
	assert.equal(toggle.openFor(), undefined);
	fail = false;
	toggle.toggle("chat_a");
	assert.equal(toggle.openFor(), "chat_a");
});

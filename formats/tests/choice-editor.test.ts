import { test } from "node:test";
import assert from "node:assert/strict";
import { createChoiceEditor, type FormatValue } from "../src/choice-editor.ts";

function slowSaves() {
	const calls: { value: FormatValue; resolve: (v: FormatValue) => void; reject: (e: Error) => void }[] = [];
	const save = (value: FormatValue) => new Promise<FormatValue>((resolve, reject) => { calls.push({ value, resolve, reject }); });
	return { calls, save };
}

test("a quick second change builds on the first, and an older reply landing last never undoes it", async () => {
	const { calls, save } = slowSaves();
	const shown: FormatValue[] = [];
	const editor = createChoiceEditor(save, value => shown.push(value));
	editor.loaded({ format: "graph", keep: false });
	const first = editor.change({ format: "blank" });
	const second = editor.change({ keep: true });
	assert.deepEqual(calls.map(c => c.value), [{ format: "blank", keep: false }, { format: "blank", keep: true }]);
	assert.deepEqual(shown.at(-1), { format: "blank", keep: true }, "shown at once, before the saves return");
	calls[1]!.resolve({ format: "blank", keep: true });
	calls[0]!.resolve({ format: "blank", keep: false });
	await Promise.all([first, second]);
	assert.deepEqual(editor.value, { format: "blank", keep: true });
	assert.deepEqual(shown.at(-1), { format: "blank", keep: true });
});

test("the stored choice arriving after the learner changed something does not undo the change", async () => {
	const { calls, save } = slowSaves();
	const editor = createChoiceEditor(save, () => {});
	const change = editor.change({ format: "written" });
	editor.loaded({ format: "auto", keep: false });
	assert.deepEqual(editor.value, { format: "written", keep: false });
	calls[0]!.resolve({ format: "written", keep: false });
	await change;
	assert.deepEqual(editor.value, { format: "written", keep: false });
});

test("Tutor decides clears Keep, and a failed save shows the last saved choice again", async () => {
	const { calls, save } = slowSaves();
	const editor = createChoiceEditor(save, () => {});
	editor.loaded({ format: "blank", keep: true });
	const change = editor.change({ format: "auto" });
	assert.deepEqual(calls[0]!.value, { format: "auto", keep: false });
	calls[0]!.reject(new Error("disk full"));
	await assert.rejects(change, /disk full/);
	assert.deepEqual(editor.value, { format: "blank", keep: true });
});

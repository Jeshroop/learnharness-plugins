import { test } from "node:test";
import assert from "node:assert/strict";
import { buttonsOf, fakeDocument, FakeElement } from "./helpers/fake-dom.ts";
import { mountReformat } from "../src/reformat-view.ts";

function mount() {
	const root = new FakeElement("div");
	const picked: string[] = [];
	let undone = 0;
	const control = mountReformat(root as unknown as HTMLElement, "blank", { pick: id => picked.push(id), undo: () => undone++, setDisabled: () => {} });
	const [first, second, third, undo] = buttonsOf(root);
	return { control, picked, undone: () => undone, first: first!, second: second!, third: third!, undo: undo! };
}
const focused = () => fakeDocument.activeElement as unknown as Element;

test("Tab from the card's last field reaches the Ask-as choices, and Tab moves along them", () => {
	const { control, first, second, third } = mount();
	assert.equal(control.focusFirst(), true);
	assert.equal(fakeDocument.activeElement, first);
	assert.equal(control.handleKey("Tab", focused()), true);
	assert.equal(fakeDocument.activeElement, second);
	assert.equal(control.handleKey("Tab", focused()), true);
	assert.equal(fakeDocument.activeElement, third);
	assert.equal(control.handleKey("Tab", focused()), false, "the last choice hands Tab back to the host");
});

test("Enter presses the focused choice and moves focus to Undo; Enter on Undo goes back to the choices", () => {
	const { control, picked, undone, first, second, undo } = mount();
	second.focus();
	assert.equal(control.handleKey("Enter", focused()), true, "the host must not submit instead");
	assert.deepEqual(picked, ["written"]);
	assert.equal(fakeDocument.activeElement, undo);
	assert.equal(undo.shown, true);
	assert.equal(control.handleKey("Enter", focused()), true);
	assert.equal(undone(), 1);
	assert.equal(fakeDocument.activeElement, first);
	assert.equal(control.showing, false);
});

test("keys elsewhere, or while the card is inactive, are left to the host", () => {
	const { control, first } = mount();
	assert.equal(control.handleKey("Enter", null), false);
	control.setActive(false);
	first.focus();
	assert.equal(control.handleKey("Enter", first as unknown as Element), false);
	assert.equal(control.focusFirst(), false);
});

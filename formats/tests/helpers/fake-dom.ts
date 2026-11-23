// The few DOM pieces the "Ask as…" control touches, for node tests (no browser here).
type Listener = () => void;
export class FakeElement {
	className = ""; textContent = ""; hidden = false; disabled = false; type = ""; parent: FakeElement | null = null;
	readonly children: FakeElement[] = [];
	private readonly listeners = new Map<string, Listener[]>();
	constructor(readonly tagName: string) {}
	append(...nodes: FakeElement[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
	remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
	addEventListener(type: string, run: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), run]); }
	removeEventListener(type: string, run: Listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(r => r !== run)); }
	click() { if (!this.disabled) for (const run of this.listeners.get("click") ?? []) run(); }
	focus() { if (!this.disabled) fakeDocument.activeElement = this; }
	/** Visible when neither it nor an ancestor is hidden. */
	get shown(): boolean { return !this.hidden && (this.parent ? this.parent.shown : true); }
}
export const fakeDocument = { activeElement: null as FakeElement | null, createElement: (tag: string) => new FakeElement(tag) };
(globalThis as { document?: unknown }).document = fakeDocument;
export const buttonsOf = (root: FakeElement): FakeElement[] => root.children.flatMap(child => [...(child.tagName === "button" ? [child] : []), ...buttonsOf(child)]);

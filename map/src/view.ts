// The map view: a host tree of ideas with lit / ready / dim states, and an
// evidence surface that shows the learner's words verbatim with a Void… per attempt.
import type { PluginFrontendContext } from "learnharness-plugin-api";
import { rowModels, shownQuestion, type RowModel, type TreeData } from "./view-model.ts";

type Content = (container: HTMLElement, signal: AbortSignal) => void | (() => void);
interface TreeRow { key: string; content: string | Content; cells?: Record<string, string>; disclosure?: { label: string; expanded: boolean; onChange: (expanded: boolean) => void }; children?: TreeRow[] }
interface Attempt {
	id: string; at: string; voided: boolean; format: string; question: string; result: string; hinted: boolean;
	picks?: string[]; thinking?: string; text?: string; working?: string[]; confidence?: number; outcome?: string;
	verdict?: string; variant?: boolean; quotes: { kind: string; text: string }[]; grader?: string;
}
interface Evidence { name: string; state: { passed: boolean; weakPass: boolean; path: string | null; needs: string[]; attempts: number } | null; attempts: Attempt[] }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function mountMapView(ctx: PluginFrontendContext, container: HTMLElement, signal: AbortSignal): () => void {
	const root = el("div", "lh-map");
	const header = el("header", "lh-map__header");
	const summary = el("p", "lh-map__summary", "Loading the map…");
	header.append(el("h2", "lh-map__title", "Map"), summary);
	const legend = el("p", "lh-map__legend");
	for (const [state, words] of [["passed", "passed"], ["ready", "ready next"], ["dim", "not yet"]] as const) {
		const item = el("span", "lh-map__legend-item");
		item.append(el("span", `lh-map__dot lh-map__dot--${state}`), el("span", undefined, words));
		legend.append(item);
	}
	header.append(legend);
	const treeHost = el("div", "lh-map__tree");
	root.append(header, treeHost);
	container.append(root);

	const toggled = new Set<string>();
	let contents = new Map<string, Content>();
	let data: TreeData | null = null;
	let tree: { update(props: { rows: TreeRow[] }): void } | null = null;

	// Same row, same look → same function, so the host keeps the mounted content.
	const contentFor = (r: RowModel): { id: string; content: Content } => {
		const id = `${r.key}|${r.kind}|${r.label}|${r.state ?? ""}|${r.weakPass ? 1 : 0}|${r.title ?? ""}`;
		const cached = contents.get(id);
		if (cached) return { id, content: cached };
		const content: Content = (host, contentSignal) => {
			const wrap = el("span", `lh-map__row lh-map__row--${r.kind}${r.state ? ` lh-map__row--${r.state}` : ""}`);
			if (r.kind === "idea" && r.ideaId) {
				const dot = el("span", `lh-map__dot lh-map__dot--${r.state}`);
				dot.setAttribute("aria-hidden", "true");
				const name = el("button", "lh-map__name", r.label);
				name.type = "button";
				if (r.title) name.title = r.title;
				const ideaId = r.ideaId;
				name.addEventListener("click", () => openEvidence(ideaId), { signal: contentSignal });
				wrap.append(dot, name);
				if (r.weakPass) {
					const badge = el("span", "lh-map__badge");
					wrap.append(badge);
					ctx.ui.mountBadge(badge, { text: "check again" }, { signal: contentSignal });
				}
			} else {
				wrap.textContent = r.label;
				if (r.title) wrap.title = r.title;
			}
			host.append(wrap);
			return () => wrap.remove();
		};
		return { id, content };
	};

	const toRow = (r: RowModel, used: Map<string, Content>): TreeRow => {
		const { id, content } = contentFor(r);
		used.set(id, content);
		return {
			key: r.key, content,
			...(r.kind === "idea" ? { cells: { evidence: r.evidence ? String(r.evidence) : "" } } : {}),
			...(r.expanded !== undefined ? {
				disclosure: {
					label: r.expanded ? `Collapse ${r.label}` : `Expand ${r.label}`, expanded: r.expanded,
					onChange: () => { if (toggled.has(r.key)) toggled.delete(r.key); else toggled.add(r.key); render(); },
				},
			} : {}),
			children: r.children.map(child => toRow(child, used)),
		};
	};

	function render(): void {
		if (!data || signal.aborted) return;
		const passedWords = `${data.totals.passed} of ${data.totals.total} ideas passed`;
		const notes = [
			...(data.damage ? [`${data.damage} unreadable log line${data.damage === 1 ? "" : "s"} (kept, not counted)`] : []),
			...(data.edited ? [`the log was edited at line ${data.edited}`] : []),
		];
		summary.textContent = [passedWords, ...notes].join(" · ");
		const used = new Map<string, Content>();
		const rows = rowModels(data, toggled).map(r => toRow(r, used));
		contents = used; // drop content no row uses any more
		if (rows.length === 0) {
			summary.textContent = "No ideas in the graph yet.";
		}
		if (tree) tree.update({ rows });
		else tree = ctx.ui.mountTree(treeHost, { label: "Map of ideas", rows, columns: [{ key: "evidence", header: "Evidence", width: 72, align: "right" }] } as never, { signal }) as never;
	}

	async function refresh(): Promise<void> {
		try {
			data = await ctx.call<TreeData>("map.tree");
			render();
		} catch (error) {
			if (!signal.aborted) summary.textContent = `The map could not load: ${(error as Error).message}`;
		}
	}
	let queued = false;
	const schedule = () => {
		if (queued || signal.aborted) return;
		queued = true;
		setTimeout(() => { queued = false; void refresh(); }, 60);
	};

	function openEvidence(ideaId: string): void {
		const surfaceController = new AbortController();
		signal.addEventListener("abort", () => surfaceController.abort(), { once: true });
		ctx.ui.openSurface({
			title: "Evidence", background: "opaque",
			content: (host, contentSignal) => {
				const page = el("div", "lh-evidence");
				host.append(page);
				const load = async () => {
					page.replaceChildren(el("p", "lh-evidence__meta", "Loading…"));
					try {
						const evidence = await ctx.call<Evidence>("map.evidence", { idea: ideaId });
						if (!contentSignal.aborted) drawEvidence(page, evidence, contentSignal, load);
					} catch (error) {
						page.replaceChildren(el("p", "lh-evidence__meta", `Could not load the evidence: ${(error as Error).message}`));
					}
				};
				void load();
				return () => page.remove();
			},
			onClose: () => surfaceController.abort(),
		}, { signal: surfaceController.signal });
	}

	function drawEvidence(page: HTMLElement, evidence: Evidence, contentSignal: AbortSignal, reload: () => Promise<void>): void {
		page.replaceChildren();
		page.append(el("h2", "lh-evidence__title", evidence.name));
		const state = evidence.state;
		page.append(el("p", "lh-evidence__state", !state ? "No evidence yet."
			: state.passed ? `Passed${state.weakPass ? " — one more check later would make it solid" : ""}.`
			: `Not passed yet${state.path ? ` (${state.path === "right-first" ? "right first time" : "wrong first time"})` : ""} — still needs ${state.needs.join(", ")}.`));
		for (const attempt of [...evidence.attempts].reverse()) {
			const card = el("article", `lh-evidence__attempt${attempt.voided ? " lh-evidence__attempt--voided" : ""}`);
			const meta = [when(attempt.at), attempt.format, attempt.verdict ? `judged ${attempt.verdict}` : `answer ${attempt.result}`];
			if (attempt.variant) meta.push("variant");
			if (attempt.hinted) meta.push("with hints");
			if (attempt.confidence !== undefined) meta.push(`confidence ${attempt.confidence}%`);
			if (attempt.grader) meta.push(`by ${attempt.grader}`);
			if (attempt.voided) meta.push("voided");
			card.append(el("p", "lh-evidence__meta", meta.join(" · ")), el("p", "lh-evidence__question", shownQuestion(attempt.format, attempt.question)));
			const words = (label: string, text: string) => {
				card.append(el("p", "lh-evidence__label", label));
				card.append(el("blockquote", "lh-evidence__words", text));
			};
			if (attempt.picks?.length) words("Your pick", attempt.picks.join(", "));
			if (attempt.thinking) words("Your thinking", attempt.thinking);
			if (attempt.text) words("Your answer", attempt.text);
			for (const working of attempt.working ?? []) words("Your working", working);
			for (const quote of attempt.quotes) words(quote.kind === "confidence" ? "Quoted: confidence" : "Quoted: reasoning", quote.text);
			if (!attempt.voided) {
				const actions = el("div", "lh-evidence__actions");
				card.append(actions);
				ctx.ui.mountButton(actions, { label: "Void…", variant: "outline", size: "sm", onClick: () => openVoid(attempt, reload) }, { signal: contentSignal });
			}
			page.append(card);
		}
	}

	function openVoid(attempt: Attempt, reload: () => Promise<void>): void {
		const dialogController = new AbortController();
		const dialog = ctx.ui.openDialog({
			title: "Void this record",
			content: (host, dialogSignal) => {
				const box = el("div", "lh-void");
				const reason = el("textarea", "lh-void__reason");
				reason.placeholder = "Why should this record stop counting?";
				reason.setAttribute("data-plugin-initial-focus", "");
				const note = el("p", "lh-void__note", "It stays in the log, marked void, and stops counting toward the map.");
				const error = el("p", "lh-void__error");
				const actions = el("div", "lh-void__actions");
				box.append(reason, note, error, actions);
				host.append(box);
				ctx.ui.mountButton(actions, {
					label: "Void it", variant: "outline",
					onClick: async () => {
						try {
							await ctx.call("map.void", { eventId: attempt.id, reason: reason.value });
							dialog.dispose();
							void reload();
							schedule();
						} catch (cause) { error.textContent = (cause as Error).message; }
					},
				}, { signal: dialogSignal });
				return () => box.remove();
			},
			onClose: () => dialogController.abort(),
		}, { signal: dialogController.signal });
	}

	const offs = [
		ctx.onNotification(event => { if (event.topic === "changed") schedule(); }),
		ctx.onResync(schedule),
		ctx.onAppEvent(event => { if (event.type === "turn-settled" || event.type === "activity-changed" || event.type === "chats-changed") schedule(); }),
	];
	void refresh();
	return () => { for (const dispose of offs) dispose(); root.remove(); };
}

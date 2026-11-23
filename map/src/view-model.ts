// The map tree as plain data: built on the server (treeData) and turned into
// rows in the window (rowModels). No DOM and no Node imports — both bundles use it.
import type { MapModel } from "./map.ts";
import type { IdeaState, Orphan } from "./rule.ts";

export type IdeaStatus = "passed" | "ready" | "dim";
export interface TreeRowData {
	id: string;
	name: string;
	statement: string;
	state: IdeaStatus;
	weakPass: boolean;
	evidence: number;
	counted: boolean;
	children: TreeRowData[];
}
export interface TreeGroup { key: string; title: string; passed: number; total: number; rows: TreeRowData[] }
/** edited: the first log line whose content no longer matches the chain (a hand edit). */
export interface TreeData { totals: { passed: number; total: number }; groups: TreeGroup[]; offMap: Orphan[]; damage: number; edited?: number }

export function treeData(input: { model: MapModel; states: Map<string, IdeaState>; ready: ReadonlySet<string>; orphans: Orphan[]; damage: number; titles: ReadonlyMap<string, string> }): TreeData {
	const { model, states, ready } = input;

	// Derivation depth: roots 0; otherwise one more than the shallowest route's deepest premise.
	const routes = new Map<string, string[][]>();
	for (const c of model.chains) routes.set(c.conclusion, [...(routes.get(c.conclusion) ?? []), [...c.premises]]);
	const depthMemo = new Map<string, number>();
	const depth = (id: string, visiting = new Set<string>()): number => {
		const known = depthMemo.get(id);
		if (known !== undefined) return known;
		if (visiting.has(id)) return 0;
		visiting.add(id);
		const ways = routes.get(id);
		const value = ways ? 1 + Math.min(...ways.map(premises => Math.max(0, ...premises.map(p => depth(p, visiting))))) : 0;
		visiting.delete(id);
		depthMemo.set(id, value);
		return value;
	};

	const childrenOf = new Map<string, string[]>();
	for (const [child, parent] of model.mainParent) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child]);
	const order = (ids: string[]) => ids.sort((a, b) => depth(a) - depth(b) || model.ideas.get(a)!.name.localeCompare(model.ideas.get(b)!.name));

	const row = (id: string): TreeRowData => {
		const idea = model.ideas.get(id)!, state = states.get(id);
		const status: IdeaStatus = state?.passed ? "passed" : ready.has(id) ? "ready" : "dim";
		return {
			id, name: idea.name, statement: idea.statement, state: status, weakPass: state?.weakPass ?? false,
			evidence: state?.attempts ?? 0, counted: model.counted.has(id), children: order([...(childrenOf.get(id) ?? [])]).map(row),
		};
	};
	const tally = (rows: TreeRowData[]): { passed: number; total: number } => rows.reduce((sum, r) => {
		const below = tally(r.children);
		return { passed: sum.passed + below.passed + (r.counted && r.state === "passed" ? 1 : 0), total: sum.total + below.total + (r.counted ? 1 : 0) };
	}, { passed: 0, total: 0 });

	const byChat = new Map<string, string[]>();
	for (const id of model.ideas.keys()) {
		if (model.mainParent.has(id)) continue;
		const chat = model.ideas.get(id)!.firstChatId ?? "";
		byChat.set(chat, [...(byChat.get(chat) ?? []), id]);
	}
	const groups = [...byChat].map(([chat, ids]): TreeGroup => {
		const rows = order(ids).map(row);
		return { key: `group:${chat || "none"}`, title: input.titles.get(chat) ?? (chat ? "A removed chat" : "No chat"), ...tally(rows), rows };
	}).sort((a, b) => a.title.localeCompare(b.title));
	const totals = groups.reduce((sum, g) => ({ passed: sum.passed + g.passed, total: sum.total + g.total }), { passed: 0, total: 0 });
	return { totals, groups, offMap: input.orphans, damage: input.damage };
}

export interface RowModel {
	key: string;
	kind: "group" | "idea" | "orphan";
	label: string;
	ideaId?: string;
	state?: IdeaStatus;
	weakPass?: boolean;
	evidence?: number;
	title?: string;
	/** undefined = no disclosure (nothing below it) */
	expanded?: boolean;
	children: RowModel[];
}

const STATE_WORDS: Record<IdeaStatus, string> = {
	passed: "Passed.",
	ready: "Ready next: everything it builds on is passed.",
	dim: "Not yet: it builds on ideas that are not passed.",
};

/** Groups start open, ideas with applications start closed; `toggled` holds keys flipped from that default. */
export function rowModels(data: TreeData, toggled: ReadonlySet<string>): RowModel[] {
	const open = (key: string, byDefault: boolean) => (toggled.has(key) ? !byDefault : byDefault);
	const idea = (r: TreeRowData): RowModel => {
		const key = `idea:${r.id}`;
		const words = r.weakPass ? `${STATE_WORDS.passed} One more check later would make it solid.` : STATE_WORDS[r.state];
		return {
			key, kind: "idea", label: r.name, ideaId: r.id, state: r.state, weakPass: r.weakPass, evidence: r.evidence,
			title: `${r.statement}\n${r.counted ? words : `${words} A worked result of its method.`}`,
			...(r.children.length ? { expanded: open(key, false) } : {}), children: r.children.map(idea),
		};
	};
	const rows: RowModel[] = data.groups.map(g => ({
		key: g.key, kind: "group", label: `${g.title} — ${g.passed} of ${g.total} passed`, expanded: open(g.key, true), children: g.rows.map(idea),
	}));
	if (data.offMap.length) {
		rows.push({
			key: "offmap", kind: "group", label: `Off the map — ${data.offMap.length}`, expanded: open("offmap", true),
			children: data.offMap.map(o => ({ key: `orphan:${o.key}`, kind: "orphan", label: `${o.name} — ${o.attempts} attempt${o.attempts === 1 ? "" : "s"}`, title: "Evidence for an idea that is not in the graph. The tutor can link it to an idea with link_evidence.", children: [] })),
		});
	}
	return rows;
}

/** A plugin question's stored text ends with its payload as one JSON line, so that variants differ for
 *  the pass rule. The evidence page shows only the prompt: the payload can hold the answer key. */
export function shownQuestion(format: string, text: string): string {
	if (format !== "plugin") return text;
	const cut = text.lastIndexOf("\n");
	const tail = text.slice(cut + 1);
	try { JSON.parse(tail); } catch { return text; }
	return text.slice(0, Math.max(cut, 0)).trim() || "A question in another plugin's format";
}

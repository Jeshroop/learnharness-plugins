// The map's read model: ideas, derivation chains, application → principle
// relations, which ideas fold away, and the exact "ready next" fringe.
import { existsSync, readFileSync } from "node:fs";

export interface NodeLine {
	id: string;
	name: string;
	statement: string;
	aliases?: readonly string[];
	provenance?: readonly { chatId: string }[];
}
export interface ChainLine { id: string; premises: readonly string[]; conclusion: string }
export interface Relation { id: string; from: string; to: string; createdAt: string }
export interface Idea { id: string; name: string; statement: string; aliases: string[]; firstChatId?: string }
export interface MapModel {
	ideas: Map<string, Idea>;
	chains: ChainLine[];
	/** application → the principles it applies, in relation order */
	parents: Map<string, string[]>;
	mainParent: Map<string, string>;
	folded: Set<string>;
	counted: Set<string>;
}

/** `specialises` relations (application → principle); missing file → none. */
export function readRelations(file: string): Relation[] {
	if (!existsSync(file)) return [];
	const relations: Relation[] = [];
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			const r = JSON.parse(line) as Record<string, unknown>;
			if (r.kind === "specialises" && typeof r.id === "string" && typeof r.from === "string" && typeof r.to === "string") {
				relations.push({ id: r.id, from: r.from, to: r.to, createdAt: typeof r.createdAt === "string" ? r.createdAt : "" });
			}
		} catch { /* a torn or foreign line: skipped */ }
	}
	return relations;
}

export function buildMap(nodes: readonly NodeLine[], chains: readonly ChainLine[], relations: readonly Relation[]): MapModel {
	// The first line for an id defines the idea; later lines are other wordings.
	const ideas = new Map<string, Idea>();
	for (const n of nodes) {
		const existing = ideas.get(n.id);
		if (!existing) {
			const firstChatId = n.provenance?.[0]?.chatId;
			ideas.set(n.id, { id: n.id, name: n.name, statement: n.statement, aliases: [...new Set((n.aliases ?? []).filter(a => a !== n.name))], ...(firstChatId ? { firstChatId } : {}) });
			continue;
		}
		for (const alias of [n.name, ...(n.aliases ?? [])]) {
			if (alias && alias !== existing.name && !existing.aliases.includes(alias)) existing.aliases.push(alias);
		}
	}

	const seen = new Set<string>();
	const live: ChainLine[] = [];
	for (const c of chains) {
		if (seen.has(c.id)) continue;
		seen.add(c.id);
		if (ideas.has(c.conclusion) && c.premises.every(p => ideas.has(p))) live.push(c);
	}

	const parents = new Map<string, string[]>();
	for (const r of relations) {
		if (r.from === r.to || !ideas.has(r.from) || !ideas.has(r.to)) continue;
		const list = parents.get(r.from) ?? [];
		if (!list.includes(r.to)) list.push(r.to);
		parents.set(r.from, list);
	}

	// Relations are acyclic by construction, so each application picking its
	// earliest-named parent is already the optimum; the guard covers hand edits.
	const mainParent = new Map<string, string>();
	const closesCycle = (child: string, parent: string) => {
		const visited = new Set<string>();
		for (let current: string | undefined = parent; current !== undefined && !visited.has(current); current = mainParent.get(current)) {
			if (current === child) return true;
			visited.add(current);
		}
		return false;
	};
	for (const [child, list] of parents) {
		const chosen = list.find(parent => !closesCycle(child, parent));
		if (chosen) mainParent.set(child, chosen);
	}

	// Fold only dead-end applications (design decision: fold dead ends).
	const premises = new Set(live.flatMap(c => c.premises));
	const folded = new Set([...parents.keys()].filter(child => !premises.has(child)));
	const counted = new Set([...ideas.keys()].filter(id => !folded.has(id)));
	return { ideas, chains: live, parents, mainParent, folded, counted };
}

export function isFolded(model: MapModel, id: string): boolean {
	return model.folded.has(id);
}

/** Counted, unpassed ideas with no route at all, or a route whose premises are all passed. */
export function readyNext(model: MapModel, passed: ReadonlySet<string>): Set<string> {
	const routes = new Map<string, ChainLine[]>();
	for (const c of model.chains) routes.set(c.conclusion, [...(routes.get(c.conclusion) ?? []), c]);
	const ready = new Set<string>();
	for (const id of model.counted) {
		if (passed.has(id)) continue;
		const ways = routes.get(id);
		if (!ways || ways.some(c => c.premises.every(p => passed.has(p)))) ready.add(id);
	}
	return ready;
}

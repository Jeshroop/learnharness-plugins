// The pass rule and a mastery probability, computed from the log alone.
// Nothing here is ever asserted by a model: a pass exists only when the
// logged evidence satisfies the rule.
import { createHash } from "node:crypto";
import type { IdeaKey, JudgedEvent, LoggedEvent, ObservedEvent, Quote, Result } from "./events.ts";

/** Priors for one learner (not fitted on a population). */
export const BKT = { prior: 0.3, learn: 0.1, slip: 0.1, guess: 0.2, guessWithReasoning: 0.01, strong: 0.95 } as const;

export const NEEDS = {
	variant: "a new variant of the question",
	correct: "a correct answer without hints",
	quote: "a quote of the correct reasoning",
	confidence: "stated confidence (90% or more, or in words)",
	attempt: "a new attempt",
} as const;

export interface IdeaState {
	idea: string;
	attempts: number;
	path: "right-first" | "wrong-first" | null;
	passed: boolean;
	passedAt?: string;
	passedBy?: string;
	pKnown: number;
	weakPass: boolean;
	needs: string[];
}

export interface Orphan { key: IdeaKey; name: string; attempts: number }

type Observed = LoggedEvent & ObservedEvent;
type Judged = LoggedEvent & JudgedEvent;
export interface Attempt { observed: Observed; judged?: Judged; voided: boolean }

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const normalised = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
export const MIN_REASONING_WORDS = 3;
export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Every observed attempt joined to its judgement, plus link resolution. */
export function join(events: readonly LoggedEvent[]): { attempts: Attempt[]; resolve: (key: IdeaKey) => string } {
	const voided = new Set(events.flatMap(e => (e.type === "void" ? [e.target] : [])));

	// Links: a label or a departed id re-attributed to another idea.
	const links = new Map<IdeaKey, IdeaKey>();
	for (const e of events) if (e.type === "link" && !voided.has(e.id)) links.set(e.from, e.to);
	const resolve = (key: IdeaKey) => {
		let current = key;
		const seen = new Set<IdeaKey>();
		while (links.has(current) && !seen.has(current)) { seen.add(current); current = links.get(current)!; }
		return current;
	};

	const attempts: Attempt[] = events
		.filter((e): e is Observed => e.type === "observed")
		.map(observed => ({ observed, voided: voided.has(observed.id) }));
	const byId = new Map(attempts.map(a => [a.observed.id, a]));
	for (const e of events) {
		if (e.type !== "judged" || voided.has(e.id)) continue;
		const target = e.observed !== undefined ? byId.get(e.observed)
			: [...attempts].reverse().find(a => a.observed.sourceKey === e.sourceKey && !a.voided);
		if (target) target.judged = e;
	}
	return { attempts, resolve };
}

export function ideaStates(events: readonly LoggedEvent[], isLive: (id: string) => boolean): { states: Map<string, IdeaState>; orphans: Orphan[] } {
	const { attempts, resolve } = join(events);

	// Group attempts by resolved idea, in log order.
	const perIdea = new Map<string, { attempt: Attempt; key: IdeaKey }[]>();
	for (const attempt of attempts) {
		const seen = new Set<string>();
		for (const key of attempt.observed.ideas) {
			const idea = resolve(key);
			if (seen.has(idea)) continue;
			seen.add(idea);
			const list = perIdea.get(idea) ?? [];
			list.push({ attempt, key });
			perIdea.set(idea, list);
		}
	}

	const states = new Map<string, IdeaState>();
	const orphans: Orphan[] = [];
	for (const [idea, list] of perIdea) {
		if (!isLive(idea)) {
			const first = list[0]!;
			const name = first.attempt.observed.names[first.key] ?? first.attempt.observed.names[idea] ?? idea.replace(/^label:/, "");
			orphans.push({ key: idea, name, attempts: list.filter(entry => !entry.attempt.voided).length });
			continue;
		}
		states.set(idea, stateOf(idea, list.map(entry => entry.attempt), resolve));
	}

	// Passing only goes one way: an idea is passed from the first moment the log
	// satisfied the rule. Later events written by agents (another judgement, a
	// late judgement of an older answer, a link) cannot take it back; the learner's voids
	// apply throughout, so voiding the evidence a pass rests on still removes it.
	const firsts = firstPasses(events, isLive);
	for (const [idea, state] of states) {
		const first = firsts.get(idea);
		if (!first && !state.passed) continue;
		state.passed = true;
		state.passedAt = first?.at ?? state.passedAt;
		state.passedBy = first?.by ?? state.passedBy;
		state.needs = [];
		state.weakPass = state.pKnown < BKT.strong;
	}
	return { states, orphans };
}

/** Replay the log in order (voids applied at every point) and keep the first moment each idea passed. */
function firstPasses(events: readonly LoggedEvent[], isLive: (id: string) => boolean): Map<string, { at: string; by: string }> {
	const voided = new Set(events.flatMap(e => (e.type === "void" ? [e.target] : [])));
	const links = new Map<IdeaKey, IdeaKey>();
	const resolve = (key: IdeaKey) => {
		let current = key;
		const seen = new Set<IdeaKey>();
		while (links.has(current) && !seen.has(current)) { seen.add(current); current = links.get(current)!; }
		return current;
	};
	const attempts: Attempt[] = [];
	const byId = new Map<string, Attempt>();
	const pinned = new Map<string, Judged>(), unpinned = new Map<string, Judged>();
	const latestLive = (sourceKey: string) => {
		for (let index = attempts.length - 1; index >= 0; index--) if (attempts[index]!.observed.sourceKey === sourceKey && !attempts[index]!.voided) return attempts[index];
		return undefined;
	};
	const ideasOf = (a: Attempt) => [...new Set(a.observed.ideas.map(resolve))];
	const first = new Map<string, { at: string; by: string }>();

	for (const e of events) {
		let touched: string[] = [];
		if (e.type === "observed") {
			const attempt: Attempt = { observed: e, voided: voided.has(e.id) };
			attempts.push(attempt);
			byId.set(e.id, attempt);
			touched = ideasOf(attempt);
		} else if (e.type === "judged" && !voided.has(e.id)) {
			if (e.observed !== undefined) pinned.set(e.observed, e); else unpinned.set(e.sourceKey, e);
			const target = e.observed !== undefined ? byId.get(e.observed) : latestLive(e.sourceKey);
			touched = target ? ideasOf(target) : [];
		} else if (e.type === "link" && !voided.has(e.id)) {
			links.set(e.from, e.to);
			touched = [resolve(e.to)];
		}
		for (const idea of touched) {
			if (first.has(idea) || !isLive(idea)) continue;
			const list = attempts
				.filter(a => a.observed.ideas.some(key => resolve(key) === idea))
				.map(a => ({ ...a, judged: pinned.get(a.observed.id) ?? (latestLive(a.observed.sourceKey) === a ? unpinned.get(a.observed.sourceKey) : undefined) }));
			const state = stateOf(idea, list, resolve);
			if (state.passed && state.passedBy) first.set(idea, { at: e.at, by: state.passedBy });
		}
	}
	return first;
}

function stateOf(idea: string, attempts: Attempt[], resolve: (key: IdeaKey) => string): IdeaState {
	const verdict = (a: Attempt): Result | null => {
		const judged = a.judged?.verdicts.find(v => resolve(v.idea) === idea);
		if (judged) return judged.result;
		return a.observed.answer.result === "unmarked" ? null : a.observed.answer.result;
	};
	// Help on the idea — practice hints or the tutor's "hinted" mark — makes it an attempt, never a pass.
	const helped = (a: Attempt) => a.observed.answer.hinted || a.judged?.verdicts.find(v => resolve(v.idea) === idea)?.hinted === true;
	const clean = (a: Attempt) => verdict(a) === "correct"
		&& (a.observed.answer.result === "correct" || a.observed.answer.result === "unmarked") && !helped(a);
	const verified = (a: Attempt, q: Quote) => sha256(q.text) === q.sha256
		&& Date.parse(q.source.at) >= Date.parse(a.observed.posedAt) && q.shows.some(key => resolve(key) === idea);
	// A reasoning quote is at least three words of the learner's own reasoning.
	const hasQuote = (a: Attempt) => !!a.judged?.quotes.some(q => q.kind === "reasoning" && wordCount(q.text) >= MIN_REASONING_WORDS && verified(a, q));
	const hasConfidence = (a: Attempt) => (a.observed.answer.confidence ?? -1) >= 90
		|| !!a.judged?.quotes.some(q => q.kind === "confidence" && verified(a, q));
	const isVariant = (index: number) => {
		const a = attempts[index]!;
		const flagged = a.judged?.verdicts.find(v => resolve(v.idea) === idea)?.variant === true;
		const text = normalised(a.observed.question.text);
		return flagged && attempts.slice(0, index).every(earlier => normalised(earlier.observed.question.text) !== text);
	};

	// The path: decided by the first attempt that is not a voided right answer.
	const deciding = attempts.findIndex(a => !(a.voided && clean(a)));
	const path: IdeaState["path"] = deciding < 0 ? null
		: clean(attempts[deciding]!) && !attempts[deciding]!.voided ? "right-first" : "wrong-first";

	// The pass: the first later attempt meeting every condition. Permanent.
	let passedAt: string | undefined, passedBy: string | undefined;
	if (deciding >= 0) {
		for (let index = deciding + 1; index < attempts.length; index++) {
			const a = attempts[index]!;
			if (a.voided || !clean(a) || !isVariant(index) || !hasQuote(a)) continue;
			if (path === "right-first" && !hasConfidence(a)) continue;
			passedAt = a.judged?.at ?? a.observed.at;
			passedBy = a.observed.id;
			break;
		}
	}

	// What the next pass still needs, read from the latest counted attempt.
	const needs: string[] = [];
	if (!passedBy) {
		if (deciding < 0) needs.push(NEEDS.attempt);
		else {
			let latest = -1;
			for (let index = attempts.length - 1; index > deciding; index--) if (!attempts[index]!.voided) { latest = index; break; }
			const a = latest >= 0 ? attempts[latest]! : undefined;
			if (!a || !isVariant(latest)) needs.push(NEEDS.variant);
			if (!a || !clean(a)) needs.push(NEEDS.correct);
			if (!a || !hasQuote(a)) needs.push(NEEDS.quote);
			if (path === "right-first" && (!a || !hasConfidence(a))) needs.push(NEEDS.confidence);
		}
	}

	// Bayesian Knowledge Tracing over the counted attempts.
	let known: number = BKT.prior;
	const counted = attempts.filter(a => !a.voided);
	counted.forEach((a, index) => {
		if (index > 0) known = known + (1 - known) * BKT.learn;
		const guess = hasQuote(a) ? BKT.guessWithReasoning : BKT.guess;
		known = clean(a)
			? (known * (1 - BKT.slip)) / (known * (1 - BKT.slip) + (1 - known) * guess)
			: (known * BKT.slip) / (known * BKT.slip + (1 - known) * (1 - guess));
	});

	const passed = passedBy !== undefined;
	return {
		idea, attempts: counted.length, path, passed,
		...(passedAt ? { passedAt } : {}), ...(passedBy ? { passedBy } : {}),
		pKnown: known, weakPass: passed && known < BKT.strong, needs,
	};
}

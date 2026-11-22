import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildMap, readyNext } from "../src/map.ts";
import type { IdeaState } from "../src/rule.ts";
import { rowModels, treeData, type RowModel } from "../src/view-model.ts";
import { familyChains, familyNodes, familyRelations } from "./helpers/graph.ts";

const model = buildMap(familyNodes, familyChains, familyRelations);
const passedState = (idea: string, weakPass = false): IdeaState =>
	({ idea, attempts: 2, path: "wrong-first", passed: true, pKnown: weakPass ? 0.9 : 0.99, weakPass, needs: [] });
const titles = new Map([["chat_fm1", "Further mechanics 1"], ["chat_review", "Mechanics test review"]]);
const data = (passed: string[] = [], orphans: { key: string; name: string; attempts: number }[] = []) => {
	const states = new Map(passed.map(id => [id, passedState(id, id === "n_power")]));
	return treeData({ model, states, ready: readyNext(model, new Set(passed)), orphans, damage: 0, titles });
};
const keys = (rows: readonly RowModel[]): string[] => rows.flatMap(r => [r.key, ...keys(r.children)]);

describe("treeData", () => {
	test("ideas group by the chat they came from; applications nest under their main parent", () => {
		const tree = data();
		assert.deepEqual(tree.groups.map(g => g.title), ["Further mechanics 1", "Mechanics test review"]);
		const fm1 = tree.groups[0]!;
		assert.deepEqual(fm1.rows.map(r => r.id), ["n_momentum", "n_stationary", "n_deriv", "n_work"]);
		const stationary = fm1.rows.find(r => r.id === "n_stationary")!;
		assert.deepEqual(stationary.children.map(c => c.id), ["n_zero_acc"]);
		assert.deepEqual(stationary.children[0]!.children.map(c => c.id), ["n_greatest"]);
		assert.deepEqual(fm1.rows.find(r => r.id === "n_momentum")!.children.map(c => c.id), ["n_fma"]);
	});

	test("counts cover counted ideas only, per chat and in total", () => {
		const tree = data(["n_power", "n_greatest"]);
		assert.deepEqual(tree.totals, { passed: 1, total: 7 });
		assert.deepEqual(tree.groups.map(g => [g.passed, g.total]), [[0, 6], [1, 1]]);
	});

	test("states: passed lit, ready-next ready, everything else dim; a weak pass is flagged", () => {
		const tree = data(["n_power"]);
		const review = tree.groups[1]!.rows[0]!;
		assert.deepEqual([review.state, review.weakPass], ["passed", true]);
		const fm1 = tree.groups[0]!.rows;
		assert.equal(fm1.find(r => r.id === "n_momentum")!.state, "ready");
		assert.equal(fm1.find(r => r.id === "n_work")!.state, "dim");
	});

	test("an off-map list appears only when there is off-map evidence", () => {
		assert.deepEqual(data().offMap, []);
		assert.equal(data([], [{ key: "label:X", name: "X", attempts: 1 }]).offMap.length, 1);
	});
});

describe("rowModels", () => {
	test("every row key is unique, including rows below collapsed parents", () => {
		const all = keys(rowModels(data([], [{ key: "label:X", name: "X", attempts: 1 }]), new Set()));
		assert.equal(new Set(all).size, all.length);
		assert.ok(all.includes("orphan:label:X"));
	});

	test("groups start open, ideas with applications start closed, and a toggle flips the default", () => {
		const rows = rowModels(data(), new Set());
		const fm1 = rows.find(r => r.key === "group:chat_fm1")!;
		assert.equal(fm1.expanded, true);
		const stationary = fm1.children.find(r => r.ideaId === "n_stationary")!;
		assert.equal(stationary.expanded, false);
		assert.equal(fm1.children.find(r => r.ideaId === "n_work")!.expanded, undefined);
		const toggled = rowModels(data(), new Set([stationary.key, "group:chat_fm1"]));
		assert.equal(toggled.find(r => r.key === "group:chat_fm1")!.expanded, false);
		assert.equal(toggled.find(r => r.key === "group:chat_fm1")!.children.find(r => r.ideaId === "n_stationary")!.expanded, true);
	});

	test("an idea row carries its state words for hover", () => {
		const rows = rowModels(data(["n_power"]), new Set());
		const power = rows.find(r => r.key === "group:chat_review")!.children[0]!;
		assert.match(power.title!, /Power of a driving force\./);
		assert.match(power.title!, /Passed/);
	});
});

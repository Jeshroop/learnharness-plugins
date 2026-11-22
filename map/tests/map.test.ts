import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tempDir } from "./helpers/tmp.ts";
import path from "node:path";
import { buildMap, isFolded, readRelations, readyNext } from "../src/map.ts";
import { familyChains as chains, familyNodes as nodes, familyRelations as relations, graphNode as node, relation as rel } from "./helpers/graph.ts";

describe("buildMap", () => {
	const model = buildMap(nodes, chains, relations);

	test("an application's main parent is the principle its earliest relation names", () => {
		assert.equal(model.mainParent.get("n_greatest"), "n_zero_acc");
		assert.deepEqual(model.parents.get("n_greatest"), ["n_zero_acc", "n_fma", "n_power"]);
	});

	test("a dead-end application folds; an application other ideas build on is counted", () => {
		assert.equal(isFolded(model, "n_greatest"), true);
		assert.equal(isFolded(model, "n_fma"), false);
		assert.equal(isFolded(model, "n_zero_acc"), false);
		assert.deepEqual([...model.counted].sort(), ["n_deriv", "n_fma", "n_momentum", "n_power", "n_stationary", "n_work", "n_zero_acc"]);
	});

	test("later node lines become aliases and the first chat is kept", () => {
		assert.equal(model.ideas.get("n_fma")!.name, "F = ma for constant mass");
		assert.deepEqual(model.ideas.get("n_fma")!.aliases, ["F equals m a"]);
		assert.equal(model.ideas.get("n_power")!.firstChatId, "chat_review");
	});
});

describe("readyNext", () => {
	const model = buildMap(nodes, chains, relations);

	test("with nothing passed, exactly the unpassed roots are ready", () => {
		assert.deepEqual([...readyNext(model, new Set())].sort(), ["n_deriv", "n_momentum", "n_power", "n_stationary"]);
	});

	test("a principle reachable only through a counted application turns ready when that application passes", () => {
		assert.ok(!readyNext(model, new Set(["n_momentum", "n_deriv"])).has("n_work"));
		assert.ok(readyNext(model, new Set(["n_momentum", "n_deriv"])).has("n_fma"));
		assert.ok(readyNext(model, new Set(["n_fma"])).has("n_work"));
	});

	test("a passed idea is never ready again", () => {
		assert.ok(!readyNext(model, new Set(["n_power"])).has("n_power"));
	});
});

describe("relations", () => {
	test("a hand-made relation cycle terminates and keeps one direction", () => {
		const model = buildMap([node("n_x", "X"), node("n_y", "Y")], [], [rel("n_x", "n_y"), rel("n_y", "n_x")]);
		assert.equal(model.mainParent.get("n_x"), "n_y");
		assert.equal(model.mainParent.has("n_y"), false);
	});

	test("without a relations file every idea is counted", () => {
		const missing = path.join(tempDir("map-rel-"), "relations.jsonl");
		const model = buildMap(nodes, chains, readRelations(missing));
		assert.equal(model.folded.size, 0);
		assert.equal(model.counted.size, 8);
	});

	test("a torn or invalid relation line is skipped", () => {
		const file = path.join(tempDir("map-rel-"), "relations.jsonl");
		writeFileSync(file, `${JSON.stringify({ id: "rel_ok", kind: "specialises", from: "n_a", to: "n_b", provenance: [], createdAt: "2026-01-05T10:00:00.000Z" })}\n{"id":"rel_bad","from":3}\n{"id":"rel_torn`);
		assert.deepEqual(readRelations(file).map(x => x.id), ["rel_ok"]);
	});
});

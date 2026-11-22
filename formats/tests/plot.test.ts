import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/expr.ts";
import { axisTicks, fitY, samplePaths, toSvgPath } from "../src/plot.ts";

const fn = (source: string) => {
	const compiled = compile(source);
	if (!compiled.ok) throw new Error(compiled.error);
	return compiled.fn;
};
const X: [number, number] = [-5, 5];

test("1/x splits at the asymptote: no path crosses x = 0", () => {
	const paths = samplePaths(fn("1/x"), X);
	assert.ok(paths.length >= 2);
	for (const path of paths) assert.ok(path.every(([x]) => x < 0) || path.every(([x]) => x > 0), "a path bridges the asymptote");
});

test("tan x splits at each asymptote in view", () => {
	assert.ok(samplePaths(fn("tan(x)"), X).length >= 4);
});

test("sqrt(x) and ln(x) draw only where they are defined", () => {
	for (const path of samplePaths(fn("sqrt(x)"), X)) assert.ok(path.every(([x]) => x >= 0));
	for (const path of samplePaths(fn("ln(x)"), X)) assert.ok(path.every(([x]) => x > 0));
});

test("SVG paths never contain NaN or Infinity, and the fitted range stays bounded near asymptotes", () => {
	for (const source of ["1/x", "tan(x)", "sqrt(x)", "ln(x)", "1/(x-1)^2"]) {
		const paths = samplePaths(fn(source), X);
		const y = fitY(paths);
		assert.ok(y[0] < y[1] && Math.abs(y[0]) < 1e3 && Math.abs(y[1]) < 1e3, `${source}: ${y}`);
		const d = toSvgPath(paths, { x: X, y, width: 200, height: 150 });
		assert.doesNotMatch(d, /NaN|Infinity/, source);
		assert.match(d, /^M/, source);
	}
});

test("a smooth curve stays one path", () => {
	assert.equal(samplePaths(fn("x^2 - 3x + 2"), X).length, 1);
	assert.equal(samplePaths(fn("e^x"), X).length, 1);
});

test("axis ticks are evenly spaced and include zero", () => {
	const ticks = axisTicks([-5, 5]);
	assert.ok(ticks.includes(0));
	const steps = ticks.slice(1).map((t, i) => +(t - ticks[i]!).toFixed(9));
	assert.ok(steps.every(s => s === steps[0]), `${ticks}`);
	assert.ok(ticks.length >= 3 && ticks.length <= 11, `${ticks}`);
});

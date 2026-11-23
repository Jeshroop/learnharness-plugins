import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/expr.ts";
import { axisTicks, fitY, samplePaths, tickLabels, toSvgPath } from "../src/plot.ts";

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

test("axis ticks stay bounded far from zero, where the step is below the numbers' precision", () => {
	for (const range of [[1e16, 1e16 + 3], [1e300, 1e300 * 1.000001], [0, 1e-300]] as [number, number][]) {
		const ticks = axisTicks(range);
		assert.ok(Array.isArray(ticks) && ticks.length <= 50, `${range}: ${ticks.length}`);
	}
});

test("the default view has a 1-unit grid, and tick labels give the scale inside the plot", () => {
	assert.deepEqual(axisTicks([-5, 5]), [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
	const view = { x: [-5, 5] as [number, number], y: [-2, 6] as [number, number], width: 220, height: 160 };
	const labels = tickLabels(view);
	const xs = labels.filter(l => l.axis === "x").map(l => l.text);
	assert.ok(xs.includes("1") && xs.includes("-1") && xs.includes("4") && !xs.includes("0"), `${xs}`);
	assert.ok(labels.some(l => l.axis === "y"), "y labels too");
	for (const label of labels) assert.ok(label.x >= 0 && label.x <= 220 && label.y >= 0 && label.y <= 160, JSON.stringify(label));
});

test("axis ticks are evenly spaced and include zero", () => {
	const ticks = axisTicks([-5, 5]);
	assert.ok(ticks.includes(0));
	const steps = ticks.slice(1).map((t, i) => +(t - ticks[i]!).toFixed(9));
	assert.ok(steps.every(s => s === steps[0]), `${ticks}`);
	assert.ok(ticks.length >= 3 && ticks.length <= 11, `${ticks}`);
});

test("an asymptote inside the view breaks the curve even when the curve's own range is wide", () => {
	const crossings = (paths: [number, number][][]) => paths.flatMap(path => path.slice(1)
		.filter((point, i) => Math.floor((path[i]![0] - Math.PI / 2) / Math.PI) !== Math.floor((point[0] - Math.PI / 2) / Math.PI)));
	assert.deepEqual(crossings(samplePaths(fn("tan(x) + x^4"), X, undefined, [-3, 3])), [], "x^4 widens the curve's own range");
	assert.deepEqual(crossings(samplePaths(fn("tan(x)"), [-50, 50], undefined, [-15, 15])), [], "coarse samples straddle each asymptote");
	// Steep but continuous curves and sharp corners stay whole.
	assert.equal(samplePaths(fn("200x"), X, undefined, [-5, 5]).length, 1);
	assert.equal(samplePaths(fn("abs(200(x - 0.0125))"), X, undefined, [-1, 5]).length, 1);
});

test("x-axis labels are thinned so long numbers never overlap", () => {
	for (const x of [[0, 100000], [-1e6, 1e6], [0, 0.001]] as [number, number][]) {
		const labels = tickLabels({ x, y: [-5, 5], width: 220, height: 160 }).filter(l => l.axis === "x").sort((a, b) => a.x - b.x);
		assert.ok(labels.length >= 2, `${x}: some labels remain`);
		for (let i = 1; i < labels.length; i++) {
			const room = labels[i]!.x - labels[i - 1]!.x;
			const need = ((labels[i]!.text.length + labels[i - 1]!.text.length) / 2) * 5.5 + 4;
			assert.ok(room >= need, `${x}: "${labels[i - 1]!.text}" and "${labels[i]!.text}" overlap (${room.toFixed(1)}px < ${need.toFixed(1)}px)`);
		}
	}
	assert.equal(tickLabels({ x: [-5, 5], y: [-5, 5], width: 220, height: 160 }).filter(l => l.axis === "x").length, 8, "the default view keeps every label");
});

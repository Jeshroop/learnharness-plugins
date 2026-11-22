import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/expr.ts";

const at = (source: string, x: number) => {
	const compiled = compile(source);
	if (!compiled.ok) throw new Error(`${source}: ${compiled.error}`);
	return compiled.fn(x);
};
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
const fails = (source: string, pattern: RegExp) => {
	const compiled = compile(source);
	assert.equal(compiled.ok, false, `${source} should not compile`);
	if (!compiled.ok) assert.match(compiled.error, pattern);
};

test("polynomials, with implicit multiplication", () => {
	close(at("x^2 - 3x + 2", 1), 0);
	close(at("x^2 - 3x + 2", 0), 2);
	close(at("2x", 3), 6);
	close(at("3(x+1)", 1), 6);
	close(at("x(x-1)", 3), 6);
	close(at("(x+1)(x-1)", 2), 3);
	close(at("2x^2", 3), 18);
});

test("precedence and associativity follow maths convention", () => {
	close(at("-x^2", 3), -9);
	close(at("2^3^2", 0), 512);
	close(at("2^-1", 0), 0.5);
	close(at("1/2x", 4), 2);
	close(at("6/3/2", 0), 1);
});

test("functions, constants, a 'y =' prefix and typographic symbols", () => {
	close(at("sin(pi/2)", 0), 1);
	close(at("ln(e)", 0), 1);
	close(at("log(100)", 0), 2);
	close(at("sqrt(16) + abs(-3)", 0), 7);
	close(at("2pi", 0), 2 * Math.PI);
	close(at("y = x + 1", 1), 2);
	close(at("2×3÷4−1", 0), 0.5);
	close(at("xsin(x)", Math.PI / 2), Math.PI / 2);
	close(at("e^x", 1), Math.E);
});

test("mistakes are refused with a readable reason", () => {
	fails("sin x", /bracket/i);
	fails("q + 1", /unknown/i);
	fails("(x+1", /bracket/i);
	fails("", /empty/i);
	fails("x +", /end/i);
	fails("|x|", /abs/i);
	fails("x".repeat(400), /long/i);
});

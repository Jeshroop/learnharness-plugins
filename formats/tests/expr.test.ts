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

test("an ambiguous exponent is refused instead of drawing a different curve", () => {
	for (const source of ["e^2x", "e^-2x", "2^3x", "e^0.5x", "x^2e^x"]) fails(source, /bracket/i);
	close(at("e^(2x)", 1), Math.E ** 2);
	close(at("e^(-2x)", -1), Math.E ** 2);
	close(at("(e^2)x", 1), Math.E ** 2);
	close(at("x^2(x+1)", 2), 12);
	close(at("x^2sin(x)", Math.PI / 2), (Math.PI / 2) ** 2);
	close(at("x^2 - 3x", 4), 4);
});

test("cube roots of negative numbers are real", () => {
	close(at("cbrt(x)", -8), -2);
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

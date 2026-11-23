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
	close(at("1/2*x", 4), 2); // 1/2x itself is refused as ambiguous (below)
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

test("error positions count from the start of what the tutor wrote, 'y =' included", () => {
	fails("y = x + )", /position 9\b/);
	fails("f(x) = 2x $ 1", /position 11\b/);
	fails("y=foo", /position 3\b/);
});

test("root signs and superscript powers are read as maths", () => {
	close(at("√x", 9), 3);
	close(at("√(x+7)", 9), 4);
	close(at("2√x", 4), 4);
	close(at("x√x", 4), 8);
	close(at("√sin(x)", Math.PI / 2), 1);
	close(at("∛x", -8), -2);
	close(at("x²", 3), 9);
	close(at("x³ - 2x²", 2), 0);
	close(at("x⁻¹", 4), 0.25);
	close(at("x²x", 2), 8); // a superscript is unambiguous: (x²)·x
	close(at("(x+1)²", 2), 9);
	close(at("e^(x²)", 1), Math.E);
	close(at("x^2", 3), at("x²", 3));
});

test("an ambiguous root is refused instead of drawing a different curve", () => {
	fails("√x^2", /brackets/);
	fails("√2x", /brackets/);
	close(at("√(x^2)", -3), 3);
	close(at("(√x)^2", 4), 4);
	close(at("√(2)x", 2), 2 * Math.SQRT2);
	fails("√", /ends too early/);
	close(at("x¹⁰", 2), 1024);
	close(at("x²²", 1.1), 1.1 ** 22);
});

test("an ambiguous division is refused instead of drawing a different curve", () => {
	// 1/2x is a line read left to right but a hyperbola in a textbook; refuse rather than guess.
	for (const source of ["1/2x", "1/2(x+1)", "1/2sin(x)", "3x/2x", "e^x/2x", "1/2 x"]) fails(source, /brackets/);
	close(at("1/(2x)", 2), 0.25);
	close(at("(1/2)x", 2), 1);
	close(at("x/2", 2), 1);
	close(at("1/2*x", 2), 1);
	close(at("1/sin(x)", Math.PI / 2), 1);
	close(at("x/2 + 1", 2), 2);
	close(at("(x+1)/(x-1)", 3), 2);
});

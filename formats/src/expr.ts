// A small, safe maths-expression compiler for plotting y = f(x): a hand-written
// precedence parser that compiles to closures. No eval, no dependencies.

export type Compiled = { ok: true; fn: (x: number) => number } | { ok: false; error: string };
type Fn = (x: number) => number;

const FUNCTIONS: Record<string, (v: number) => number> = {
	sin: Math.sin, cos: Math.cos, tan: Math.tan,
	sec: v => 1 / Math.cos(v), csc: v => 1 / Math.sin(v), cosec: v => 1 / Math.sin(v), cot: v => 1 / Math.tan(v),
	asin: Math.asin, acos: Math.acos, atan: Math.atan, arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
	sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
	exp: Math.exp, ln: Math.log, log: Math.log10, sqrt: Math.sqrt, abs: Math.abs,
	floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, "π": Math.PI, e: Math.E };
// Longest first, so "sinh" wins over "sin" and "exp" over "e".
const WORDS = [...Object.keys(FUNCTIONS), "pi", "π", "x", "e"].sort((a, b) => b.length - a.length);
export const MAX_EXPRESSION_LENGTH = 300;

type Token = { kind: "num"; value: number; at: number } | { kind: "word" | "sym"; value: string; at: number };
class ParseError extends Error {}

function tokenize(source: string): Token[] | string {
	const tokens: Token[] = [];
	let i = 0;
	while (i < source.length) {
		const char = source[i]!;
		if (/\s/.test(char)) { i++; continue; }
		const number = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/.exec(source.slice(i));
		if (number) { tokens.push({ kind: "num", value: Number(number[0]), at: i }); i += number[0].length; continue; }
		const letters = /^[a-zπ]+/.exec(source.slice(i));
		if (letters) {
			// A run like "xsin" or "2pix" is split into known words: x, sin / pi, x.
			const run = letters[0];
			for (let j = 0; j < run.length;) {
				const word = WORDS.find(w => run.startsWith(w, j));
				if (!word) return `Unknown name "${run.slice(j)}" at position ${i + j + 1}. Use x as the variable.`;
				tokens.push({ kind: "word", value: word, at: i + j });
				j += word.length;
			}
			i += run.length;
			continue;
		}
		if (char === "*" && source[i + 1] === "*") { tokens.push({ kind: "sym", value: "^", at: i }); i += 2; continue; }
		if ("+-*/^()".includes(char)) { tokens.push({ kind: "sym", value: char, at: i }); i++; continue; }
		if (char === "|") return "Use abs(…) instead of |…|.";
		return `Unexpected "${char}" at position ${i + 1}.`;
	}
	return tokens;
}

function parse(tokens: Token[]): Fn {
	let pos = 0;
	const peek = () => tokens[pos];
	const isSym = (token: Token | undefined, ...values: string[]) => token?.kind === "sym" && values.includes(token.value);
	const fail = (message: string): never => { throw new ParseError(message); };
	const startsPrimary = (token: Token | undefined) => !!token && (token.kind !== "sym" || token.value === "(");
	const expect = (symbol: string) => {
		const token = peek();
		if (!isSym(token, symbol)) fail(token ? `Expected a closing bracket at position ${token.at + 1}.` : "A closing bracket is missing.");
		pos++;
	};

	function expression(): Fn {
		let left = term();
		while (isSym(peek(), "+", "-")) {
			const op = peek()!.value; pos++;
			const right = term(), l = left;
			left = op === "+" ? x => l(x) + right(x) : x => l(x) - right(x);
		}
		return left;
	}
	function term(): Fn {
		let left = unary();
		for (;;) {
			const token = peek();
			if (isSym(token, "*", "/")) {
				pos++;
				const right = unary(), l = left;
				left = token!.value === "*" ? x => l(x) * right(x) : x => l(x) / right(x);
			} else if (startsPrimary(token)) {
				// Implicit multiplication: 2x, 3(x+1), x(x-1), (x+1)(x-1), 2pi.
				const right = power(), l = left;
				left = x => l(x) * right(x);
			} else return left;
		}
	}
	function unary(): Fn {
		if (isSym(peek(), "-", "+")) {
			const negative = peek()!.value === "-"; pos++;
			const operand = unary();
			return negative ? x => -operand(x) : operand;
		}
		return power();
	}
	function power(): Fn {
		const base = primary();
		if (!isSym(peek(), "^")) return base;
		pos++;
		const exponent = unary(); // right-associative: 2^3^2 = 2^9, and 2^-1 works
		return x => Math.pow(base(x), exponent(x));
	}
	function primary(): Fn {
		const token = peek();
		if (!token) return fail("The expression ends too early.");
		pos++;
		if (token.kind === "num") { const value = token.value; return () => value; }
		if (token.kind === "word") {
			if (token.value === "x") return x => x;
			const constant = CONSTANTS[token.value];
			if (constant !== undefined) return () => constant;
			const f = FUNCTIONS[token.value]!;
			if (!isSym(peek(), "(")) fail(`Put brackets after ${token.value}, e.g. ${token.value}(x).`);
			pos++;
			const argument = expression();
			expect(")");
			return x => f(argument(x));
		}
		if (token.value === "(") { const inner = expression(); expect(")"); return inner; }
		return fail(`Unexpected "${token.value}" at position ${token.at + 1}.`);
	}

	const fn = expression();
	const rest = peek();
	if (rest) fail(rest.value === ")" ? `There is an extra closing bracket at position ${rest.at + 1}.` : `Unexpected "${rest.value}" at position ${rest.at + 1}.`);
	return fn;
}

/** Compile y = f(x) written in plain maths. Never throws. */
export function compile(source: string): Compiled {
	if (typeof source !== "string" || source.trim() === "") return { ok: false, error: "The expression is empty." };
	if (source.length > MAX_EXPRESSION_LENGTH) return { ok: false, error: `The expression is too long (${MAX_EXPRESSION_LENGTH} characters at most).` };
	const normalized = source.replace(/[×·]/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-")
		.replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=/i, "").toLowerCase();
	const tokens = tokenize(normalized);
	if (typeof tokens === "string") return { ok: false, error: tokens };
	if (!tokens.length) return { ok: false, error: "The expression is empty." };
	try {
		return { ok: true, fn: parse(tokens) };
	} catch (error) {
		if (error instanceof ParseError) return { ok: false, error: error.message };
		throw error;
	}
}

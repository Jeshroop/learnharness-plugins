import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { toBase64 } from "../src/bytes.ts";

test("toBase64 matches Node's encoder, including inputs longer than one chunk", () => {
	for (const size of [0, 1, 2, 3, 32_767, 32_768, 100_001]) {
		const bytes = new Uint8Array(randomBytes(size));
		assert.equal(toBase64(bytes), Buffer.from(bytes).toString("base64"), `size ${size}`);
	}
});

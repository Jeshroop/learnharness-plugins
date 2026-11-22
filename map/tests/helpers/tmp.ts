// Temp folders for tests, removed when the test process exits — no litter in /tmp.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const made: string[] = [];
process.once("exit", () => {
	for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), prefix));
	made.push(dir);
	return dir;
}

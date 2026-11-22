// Build Sketch straight into dist/ (the installed runtime root).
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist");
try {
	if (fs.lstatSync(output).isSymbolicLink()) throw new Error("Refusing to build into a linked directory.");
	try { fs.lstatSync(path.join(output, "data")); throw new Error("Refusing to build over plugin data. Move it to a safe location first."); }
	catch (error) { if (error.code !== "ENOENT") throw error; }
} catch (error) { if (error.code !== "ENOENT") throw error; }
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const common = { bundle: true, minify: true, target: "es2022", logLevel: "warning", absWorkingDir: root, legalComments: "eof", conditions: ["production"] };
await build({
	...common,
	entryPoints: { main: "src/main.ts" }, outdir: output, format: "esm", platform: "browser",
	splitting: true, chunkNames: "assets/[name]-[hash]", jsx: "automatic",
	define: { "process.env.NODE_ENV": '"production"' },
	// Mermaid-to-diagram is left out to keep the plugin small.
	alias: { "@excalidraw/mermaid-to-excalidraw": "./src/mermaid-stub.ts" },
});
await build({ ...common, entryPoints: { styles: "src/styles.css" }, outdir: output, loader: { ".woff2": "file", ".woff": "file", ".ttf": "file", ".png": "file", ".svg": "file" }, assetNames: "assets/[name]-[hash]" });
await build({ ...common, entryPoints: ["src/backend.ts"], outfile: path.join(output, "backend.cjs"), format: "cjs", platform: "node" });

// Excalidraw loads fonts from EXCALIDRAW_ASSET_PATH + "fonts/…"; the Chinese-script
// font (Xiaolai, 13 MB of 13.5 MB) is left out.
const fonts = path.join(root, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
for (const family of fs.readdirSync(fonts)) {
	if (family !== "Xiaolai") fs.cpSync(path.join(fonts, family), path.join(output, "assets/fonts", family), { recursive: true });
}
for (const file of ["manifest.json", "LICENSE"]) fs.copyFileSync(path.join(root, file), path.join(output, file));
console.log(`Built ${output}`);

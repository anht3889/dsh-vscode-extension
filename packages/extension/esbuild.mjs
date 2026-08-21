import { build } from "esbuild";
import { existsSync } from "node:fs";

if (!existsSync(new URL("./src/extension.ts", import.meta.url))) {
  console.log("no src/extension.ts yet; skipping bundle");
  process.exit(0);
}

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
});

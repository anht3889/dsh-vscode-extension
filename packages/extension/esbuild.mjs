import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

// Extension host bundle (Node) — the VS Code extension entry.
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

// Webview bundle (browser) — the React chat UI.
await build({
  entryPoints: ["src/webview/media/main.tsx"],
  bundle: true,
  outfile: "dist/webview.js",
  format: "iife",
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  sourcemap: true,
});

// Static webview stylesheet (plain copy; referenced by panel.ts via asWebviewUri).
copyFileSync("src/webview/media/style.css", "dist/style.css");

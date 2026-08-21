// Compile the E2E driver + suite into dist-test/.
//
//   * e2e.run.ts  -> dist-test/e2e.run.js   (Node driver, `@vscode/test-electron` external)
//   * e2e.test.ts -> dist-test/e2e.test.js   (Extension Test host suite, `vscode` external)
//
// Invoked only by the `test:e2e` script — NOT by `pnpm -r build` (that runs
// esbuild.mjs, which bundles only the extension entry + webview).

import { build } from "esbuild";

await build({
  entryPoints: ["src/test/e2e.run.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["@vscode/test-electron"],
  outfile: "dist-test/e2e.run.js",
});

await build({
  entryPoints: ["src/test/e2e.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["vscode"],
  outfile: "dist-test/e2e.test.js",
});

// E2E driver — runs under plain Node (NOT the Extension Test host).
//
// Spawns a VS Code instance in extension-test mode via `@vscode/test-electron`,
// then loads the compiled suite `dist-test/e2e.test.cjs` (a CJS bundle that
// exposes `run`).
//
// Requires `@vscode/test-electron` to be installed (`pnpm install`) and a
// display; see the `test:e2e` npm script and the root README → "End-to-end".
//
// This file (and `e2e.test.ts`) are type-checked by `tsconfig.e2e.json` — not
// by the production `tsconfig.json` — and are compiled by `e2e-build.mjs` (also
// not part of the `build` step).

import { runTests } from "@vscode/test-electron";
import { fileURLToPath } from "node:url";
import path from "node:path";

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // `here` is <package>/dist-test after compilation via e2e-build.mjs.
  const extensionDevelopmentPath = path.resolve(here, "..");
  const extensionTestsPath = path.resolve(here, "e2e.test.cjs");

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
    });
  } catch (err) {
    console.error("Failed to run E2E tests:", err);
    process.exit(1);
  }
}

void main();

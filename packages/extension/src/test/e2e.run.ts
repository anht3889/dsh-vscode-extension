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

import {
  downloadAndUnzipVSCode,
  runTests,
} from "@vscode/test-electron";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveDownloadedExecutable } from "../../test/e2eExecutable.js";

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // `here` is <package>/dist-test after compilation via e2e-build.mjs.
  const extensionDevelopmentPath = path.resolve(here, "..");
  const extensionTestsPath = path.resolve(here, "e2e.test.cjs");
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-vscode-e2e-"));

  try {
    const downloadedExecutable = await downloadAndUnzipVSCode();
    const vscodeExecutablePath =
      resolveDownloadedExecutable(downloadedExecutable);

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      vscodeExecutablePath,
      launchArgs: [
        `--extensions-dir=${path.join(profileRoot, "extensions")}`,
        `--user-data-dir=${path.join(profileRoot, "user-data")}`,
      ],
    });
  } catch (err) {
    console.error("Failed to run E2E tests:", err);
    process.exitCode = 1;
  } finally {
    fs.rmSync(profileRoot, { recursive: true, force: true });
  }
}

void main();

// E2E smoke test — runs inside the VS Code Extension Test host, NOT vitest.
//
// It is launched by `src/test/e2e.run.ts` (the driver) via
// `@vscode/test-electron`'s `runTests`; see the `test:e2e` npm script.
//
// This suite is compiled to CommonJS (`dist-test/e2e.test.cjs`) by
// `e2e-build.mjs`: `runTests` requires `--extensionTestsPath` to expose a
// `run` export, and a CJS bundle is version-proof across VS Code Extension Dev
// Host loaders (the package is `"type":"module"`, so an `.mjs`/ESM test file
// would be rejected at load time). See the `export { run }` at the end of file.
//
// Requires, at run time:
//   * a real display (a headless sandbox / CI without X is not sufficient), and
//   * a `dsh` binary discoverable on PATH, or `dsh.binaryPath` set in settings
//     (see the root README → "Configuration").
//
// Compile-time notes:
//   * This file is exempt from the "never value-import `vscode` under vitest"
//     rule: it runs under the Extension Test host. It is deliberately excluded
//     from vitest collection (see vitest.config.ts) and from the esbuild
//     "build" step, so it never leaks into a vitest-imported module graph.
//   * It type-checks against the ambient `vscode` module (@types/vscode) like
//     `src/extension.ts` does.

import * as assert from "node:assert";
import * as vscode from "vscode";

// Candidate extension ids. The scope is the npm package name (`@dsh-vscode/…`);
// once a real `publisher` is set and published, the id becomes `<publisher>.<name>`.
const CANDIDATE_IDS = ["@dsh-vscode/extension", "dsh.@dsh-vscode/extension"];

function findExtension(): vscode.Extension<unknown> | undefined {
  for (const id of CANDIDATE_IDS) {
    const ext = vscode.extensions.getExtension(id);
    if (ext) return ext;
  }
  return undefined;
}

async function run(): Promise<void> {
  // 1. Activate the extension and confirm it came up without throwing.
  const ext = findExtension();
  assert.ok(ext, `DSH extension not found (tried: ${CANDIDATE_IDS.join(", ")})`);
  await ext.activate();
  assert.ok(ext.isActive, "DSH extension did not report as active after activate()");

  // 2. Run `dsh.start`. This spawns `dsh --profile vscode` in the active
  //    workspace folder; it must resolve without throwing even if no folder is open
  //    (the provider no-ops when there is no workspace folder).
  await vscode.commands.executeCommand("dsh.start");

  // 3. Best-effort `turn/end` observation is NOT wired here: the chat provider
  //    is not exposed on the public extension API, and a real turn requires a
  //    model backend + a submitted prompt. We settle for the honest floor that in
  //    a smoke environment we can assert deterministically:
  //      * activation succeeded, and
  //      * `dsh.start` completed without throwing.
  //    A richer setup could open dsh.chat view, post a `{ kind: "submit" }`
  //    message into the webview, and await a `turn/end` event on the status
  //    channel.

  // 4. Tear down whatever session `start` created.
  await vscode.commands.executeCommand("dsh.stop");
}

// CJS `run` export: `@vscode/test-electron`'s `runTests` loads this bundled
// file and calls `run()`. esbuild's CJS output turns this into
// `exports.run = run` (no ESM markers), which is what the Dev Host expects.
export { run };

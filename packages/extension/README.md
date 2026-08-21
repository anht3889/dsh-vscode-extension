# dsh-vscode-extension

DSH (DeepSeek Harness) control plane for Visual Studio Code — an AI coding agent
chat sidecar that drives a headless `dsh` process and renders turns, tool calls,
diffs, and approval prompts inside a VS Code webview.

pnpm monorepo with three workspace packages:

| Package | Role |
| --- | --- |
| `@dsh-vscode/contract` | Dependency-free wire protocol (ndjson messages) shared by extension ↔ bridge |
| `@dsh-vscode/bridge`   | Drives the real `dsh` agent runtime and speaks the contract protocol |
| `@dsh-vscode/extension` | The VS Code extension: webview UI, process manager, protocol client |

## Install / run

Prerequisites: Node 20+, pnpm 8/9, and a built `dsh` binary.

```bash
pnpm install
pnpm -r build          # emits dist/extension.js + dist/webview.js
```

To run the extension in a VS Code Extension Development Host:

1. Open this repository in VS Code.
2. Press `F5` (uses the `.vscode/launch.json` if present) or run
   `code --extensionDevelopmentPath=$PWD/packages/extension`.

## Configuration

- `dsh.binaryPath` — path to the `dsh` binary. Empty (default) means the
  extension resolves `dsh` from `PATH`.

## Commands

- `dsh.start` — start a DSH session in the active workspace folder.
- `dsh.stop` — stop the running DSH session.

## Development

```bash
pnpm -r build    # type-check + bundle (esbuild)
pnpm -r test     # unit tests (vitest) — 28 tests across contract/bridge/extension
```

### End-to-end

The E2E smoke test runs the extension inside a real VS Code Extension Test host
(via `@vscode/test-electron`). It requires a display and `dsh` on `PATH`.

```bash
pnpm --dir packages/extension test:e2e
```

This compiles `src/test/e2e.{run,test}.ts` into `dist-test/` and launches VS
Code; the suite activates the extension, runs `dsh.start`, and asserts clean
activation + command completion (a full `turn/end` round-trip needs a real model
backend and is outside the smoke's deterministic floor).

## Packaging

```bash
pnpm --dir packages/extension exec vsce package   # or: npx @vscode/vsce package
```

Produces `dsh-<version>.vsix` in the package directory.

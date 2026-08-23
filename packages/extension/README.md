# dsh-vscode-extension

DSH (DeepSeek Harness) control plane for Visual Studio Code — an AI coding agent
chat sidecar that drives a headless `dsh` process and renders turns, tool calls,
diffs, and approval prompts inside a VS Code webview.

The transcript shows your prompts verbatim and renders DSH's answers as markdown
— headings, lists, tables, links, and fenced code blocks with a language label
and a copy button — streaming in as the model writes. Model-authored raw HTML is
escaped rather than parsed, and image references render as links, because the
webview's CSP admits images only from the extension's own resources and a remote
image URL would let model output make a request. Injected context messages
(plugin, session-reference, and subagent-report sources) stay out of the view.

The chat header exposes workspace-scoped recent sessions and New Chat. The
squircle composer selects the current session's permission preset and model,
shows next-request context usage, and sends with Enter (Shift+Enter inserts a
newline). The model list offers what the mounted providers list and can resolve.
DSH stores a default selection without checking it against any provider, so a
model dropped from a provider's config would otherwise stay in the list as an
entry no request can open: at startup the bridge replaces such a selection with
a live model from the same provider where possible, saves the replacement, and
notes the switch on stderr. A provider that is only unreachable or unreadable
keeps its selection — providers may serve ids they do not list, and an outage
must not rewrite a saved choice. Plus, left of the context meter, opens a workspace file and folder
search plus a native Attach image action. File and folder chips are sent as
`@path` references; DSH reads their contents only when needed.
Image chips depend on the selected model declaring image input and on DSH
attachment limits. Full Access requires confirmation once per chat. Settings is
reserved for a later release.

## Slash menu

Typing `/query` at the caret opens the session-scoped slash menu after the
bridge is Ready. The slash must begin the draft or follow whitespace or
punctuation. Slashes inside words (`a/b`), the second slash in `//`, URLs, and
drive prefixes such as `C:/` do not trigger the menu. An active `@` file or
folder reference takes priority. Input-taking commands appear only when the
slash token begins the trimmed draft; bare commands and skills can also appear
inline.

Results are grouped as **Commands** then **Skills**. Commands use fuzzy matching
with prefix-biased ranking; skills use prefix matching. Down and Up cycle the
highlight, Enter picks it, Escape dismisses the menu without changing the
draft, and Shift+Enter inserts a newline. Enter with no highlighted result keeps
the composer's ordinary send behavior.

Picking a bare command removes its active token and runs it immediately without
sending any remaining draft text. Picking a command that accepts input replaces
the token with `/name ` and runs the complete line when Send is used. Picking a
skill inserts `/name ` as ordinary prompt text for normal submission. A leading
slash token that was not selected as a known command is sent as an ordinary
user message.

Only input-taking commands explicitly marked as accepting images can run with
image chips. A text-only command keeps its draft and chips and shows an error
instead of running. If commands or skills cannot be listed, that source is
marked unavailable while results from the other source remain usable; the menu
closes when neither source has selectable results. Command invocations render
as user slash rows in the transcript and remain visible after resuming the
session.

pnpm monorepo with three workspace packages:

| Package | Role |
| --- | --- |
| `@dsh-vscode/contract` | Dependency-free wire protocol (ndjson messages) shared by extension ↔ bridge |
| `@dsh-vscode/bridge`   | Drives the real `dsh` agent runtime and speaks the contract protocol |
| `dsh` | The VS Code extension: webview UI, process manager, protocol client |

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
- `DSH_HOME` — optional harness-home override. Recent chats use the base
  profile's `<DSH_HOME>/sessions` JSONL directory.

## Commands

- `dsh.start` — start a DSH session in the active workspace folder.
- `dsh.stop` — stop the running DSH session.

## Development

```bash
pnpm -r build    # type-check + bundle (esbuild)
pnpm -r test     # unit tests (vitest) across contract/bridge/extension
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

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
available from the header gear.

## Settings

The header gear opens a focus-managed settings dialog. Tab reaches the gear
button; Enter or Space opens the dialog. Opening it closes Recent and any
composer picker while preserving the transcript, prompt draft, and attachments.
Conversation streaming continues while the dialog is open. Escape, the backdrop,
the close button, and the gear close it; closing returns focus to the gear
button. Staged changes prompt before they are discarded. The five core sections
are:

- **General** — future-session agent-preset and permission defaults, language,
  appearance, and Busy Enter behavior. Current-session model and permission
  controls remain in the composer. Appearance configures DSH Web; this extension
  always follows the VS Code or Cursor theme.
- **Models** — configured providers, supported provider profiles, model
  metadata, and write-only provider credentials. Provider settings are saved
  before credentials, so credential failure can leave a provider configured
  without its key. Deleting a provider can remove an attributable writable
  credential first; that secret cannot be restored if the later settings write
  fails.
- **Plugins** — specialized cards for mounted Shell, Agent Loop, and Web Search
  settings plus a read-only inventory. The inventory exposes only module name,
  loader entry id, enabled state, and fiber phase; the DSH inventory service
  supplies no package descriptions and no generic plugin editor is provided.
- **Agent Presets** — inspect built-in compositions, set the future-session
  default, copy presets, and open or delete user presets. Deleting the current
  default requires selecting a healthy replacement first. The DSH Web preset
  creator is not included because it depends on Web's conversation/workspace
  flow rather than the shared preset service.
- **Extension** — DSH binary path, handshake timeout, VS Code Settings, trusted
  actions for the DSH settings document/home and user-preset folders, and
  explicit Restart DSH.

### Optional plugin settings

MCP and Web Search rows appear after Plugins only while the corresponding
plugin service is mounted in the profile launched by the extension. Service
availability is the gate: an absent service leaves no row or error. While the
external Web Search service is absent, the core `web-search-deepseek` card
remains in Plugins.

MCP uses the installed `@anht3889/dsh-mcp-mgmt-bundle` without requiring a
plugin change. A build without `describeSecrets` reports secret state as
unknown, and a build without `onCatalogChanged` refreshes by polling without
catalog notifications. OAuth server configuration, `OAUTH_CLIENT_SECRET`
storage, and token clearing work in the editor. MCP secret values can be
replaced but cannot be unset here.

- The vscode profile's `dsh` child listens on `127.0.0.1` with an OS-assigned
  port for OAuth callbacks only.
- Operators must add to **that profile's** `cordis.patch.yml` (the loader
  applies this last):

```yaml
- id: mcp-mgmt-manager
  config:
    serveManagementHttpApi: false
```

- If that row is omitted, callbacks still work and `/mcp-management` is
  reachable on loopback, matching DSH Web's local API.
- **Add & Authorize** needs a plugin build that implements `discoverOAuth`,
  `startOAuth`, and `oauthRedirectOrigin`, such as this workspace's MCP manager.
- Advanced remains for providers that do not dynamically register a client.
- A client registered only for DSH Web's port cannot be reused against
  vscode's ephemeral port without re-registration.

One Save writes the MCP record and then its staged secrets. Save stays
unavailable, with the offending fields marked, until the record is complete,
because the webview-to-host relay discards a malformed command; Cancel remains
available throughout. Explicit secret continuation appears only when a requested
value is no longer held locally, which happens when the request outlives the
editor that staged it.

Web Search requires a `dsh-web-search` build that publishes
`ctx.webSearchManager` and the separately published
`@anht3889/dsh-web-search-service` package on which that build depends. Until
that build is installed, the Web Search row is absent and the core
`web-search-deepseek` Plugins card remains. Tavily and Brave keys can be
replaced but cannot be unset here.

Catalog changes apply immediately inside the profile that writes them. Each
running profile caches its own catalog in memory, so a catalog changed by
another already-running profile does not live-sync and becomes visible only
after the receiving profile restarts. MCP connection state is likewise local
to the profile's DSH process.

Stored secret values never travel from a plugin into the extension host or
webview. New values travel only to the owning plugin, remain component-local
while staged or retained for a failed-write retry, and are excluded from
reducer state, retained webview state, logs, diagnostics, snapshots, and
outbound protocol records. A successful write or disconnect clears staged
values.

DSH-backed settings use the active `$DSH_HOME` settings and credentials stores.
They are global to every workspace and session using that DSH home, not scoped
to the current VS Code workspace or chat. General's agent-preset and permission
rows set defaults for future sessions; they do not replace the current
session's composer selections. Language includes a System default option that
unsets the stored locale preference. Language and Busy Enter update the extension
after a successful live write. While the agent is idle, Enter always queues.
While it is busy, Enter follows the configured queue/steer preference,
Cmd/Ctrl+Enter uses the opposite behavior, and Shift+Enter inserts a newline.

Credential values are write-only: the bridge sends the webview only configured,
source, and writable metadata. Secret inputs are cleared after submission and
are excluded from settings state, retained webview state, logs, diagnostics,
and snapshots. The extension never reads or writes settings YAML itself.

Each DSH namespace declares whether changes apply live or require restart.
Restart-required saves show a persistent banner but do not restart the child
automatically. Restart is unavailable while DSH is starting, thinking, awaiting
approval, or already restarting, but remains available after a disconnect. A
successful restart uses the same workspace/profile and resumes the current
session when one exists.

Every DSH write carries the last observed namespace revision. If another DSH
client or external file edit wins, the section refreshes authoritative data,
preserves the local non-secret draft, and offers revision-gated Retry or
Discard. Clean active forms synchronize automatically; dirty forms are marked
stale. A disconnect preserves non-secret drafts and reconciles them after
reconnect. Process loss can make an interrupted mutation's commit status
unknowable, so refreshed DSH state is authoritative.

The Extension section is owned by VS Code configuration rather than
`$DSH_HOME`. Each field preserves the configuration target currently supplying
its effective value (workspace folder, workspace, or global); a contribution
default is written globally. Multi-field updates use best-effort compensation
but are not an atomic VS Code configuration transaction. Trusted filesystem
actions accept only bridge-resolved DSH targets, never a webview-provided path.

The extension and bridge ship protocol version 6 together. Older submit
or settings records are rejected; there is no cross-version compatibility shim.
Multi-stage model, plugin-credential, preset-default/delete, and Extension
configuration operations are intentionally non-atomic. The UI reports partial
success and retries only the incomplete stage rather than claiming rollback.

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
  extension probes nvm and common Homebrew locations before using the extension
  host `PATH`.
- `dsh.handshakeTimeoutMs` — whole milliseconds to wait for the DSH bridge
  handshake, from 1,000 through 300,000 (default 30,000).
- `DSH_HOME` — optional harness-home override. Recent chats use the base
  profile's `<DSH_HOME>/sessions` JSONL directory, and DSH-backed settings use
  that home's global settings and credentials stores.

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

From the repository root:

```bash
pnpm --filter dsh run package
```

This runs `vsce package --no-dependencies` (see the `package` script in
`packages/extension/package.json`). Produces
`packages/extension/dsh-<version>.vsix`.

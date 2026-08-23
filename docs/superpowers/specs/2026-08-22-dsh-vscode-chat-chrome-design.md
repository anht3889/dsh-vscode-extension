# DSH VS Code Chat Chrome — Design Spec

**Date:** 2026-08-22
**Status:** Draft — pending user review
**Classification:** Architectural (protocol + session lifecycle + webview chrome)
**Baseline:** existing uncommitted work on `dsh-vscode-extension` `main` is preserved; this change extends it.

## 1. Goal

Give the VS Code sidebar chat the same operational chrome as DSH Web: startup feedback, recent-session picker, new chat, permission preset, model picker, next-request context meter, and a squircle composer. Settings behavior is defined by the later [settings parity design](2026-08-23-dsh-vscode-settings-parity-design.md).

## 2. Non-goals

- Settings behavior, which is owned by the later settings parity design.
- Global (cross-workspace) session list.
- Replacing the NDJSON bridge with Host HTTP RPC or the JSON-RPC SDK.
- Per-turn model RPC distinct from “next message in this session”.
- Inline completion, Marketplace polish beyond what this chrome requires.

## 3. Locked decisions

| Topic | Choice |
|---|---|
| Integration | Extend existing NDJSON vscode bridge (option 1) |
| Recent list | Current workspace folder only (`cwd` match) |
| New chat while busy | Confirm, then cancel the turn and start fresh |
| Permission / model change | Next message in the current chat; history kept |
| Context meter | Tokens expected in the **next** model request ÷ selected model `contextWindow` |
| Default permission | Workspace Write (`workspace-write`) |
| Full Access | Confirm once per chat, then apply |
| Model list | Configured and currently usable models only |
| Harness | Change `deepseek-harness` when a required service/export is missing |
| Protocol | Bump `PROTOCOL_VERSION` to `2` |

## 4. Architecture

One `dsh --profile vscode` child per workspace folder. Layers:

1. **Webview** — React chrome + stream; posts `{ type: "dsh/ui", cmd }`.
2. **Extension host** — spawn, apply diffs, native confirm dialogs, forward protocol.
3. **Bridge plugin** — live agent lifecycle, session list/resume/create, model catalog, permission presets, context projection.

Do not rebuild around Host RPC. Call in-process Cordis services from the bridge (`ctx.agents`, `ctx.llm`, `ctx.permissionPresets`, `ctx.sessionPersistence` / `ctx.sessionQuery`, `ctx.tokenMeter`).

### 4.1 Agent lifecycle (replace single retained agent)

The current runner creates one agent at boot and never resumes. Replace with a **session controller**:

- Boot: handshake `hello`, then `ready` with catalogs + current session (create a blank session in the workspace `cwd` if none is live).
- `newSession`: if status is `thinking` or `awaiting-approval`, the **webview** asks the host to confirm; on confirm send `cancel` then `newSession`. Bridge: cancel in-flight turn if any, dispose the previous live agent, `agents.create` with `meta.cwd = process.cwd()`, pin `workspace-write`, emit `session` + empty stream cue (extension clears diffs).
- `resume { sessionId }`: reject if header `cwd` ≠ process cwd; else cancel/dispose current, `agents.resume({ resumeSessionId })`, replay or stream history as `event` messages so the webview can render the prior transcript (minimum: after resume, emit `session` then a compact history dump of already-logged events, or instruct the webview to reset and wait for a `history` batch — **choice: outbound `history` message with `events[]` then live `event` tail**).
- `listSessions`: `sessionQuery.filterSessions({ kind: 'cwd', values: [cwd] })` when available; else persistence `list()` filtered by `header.cwd`. Sort by derived `updatedAt` descending (`max(createdAt, lastPromptAt)`). Title from `sessionTitle` / query `readTitle`.

### 4.2 Permission

User labels map to DSH presets:

| Label | Preset | Sandbox | Approval |
|---|---|---|---|
| Read Only | `read-only` | `read-only` | `ask` |
| Workspace Write | `workspace-write` | `workspace-write` | `ask` |
| Full Access | `danger-full-access` | `danger-full-access` | `never` |

`selectPermission { preset }` → `permissionPresets.set(session, name)` (takes effect on the next confined tool call). Full Access confirm is **webview-only**, once per `sessionId`; Settings default is not changed.

The vscode profile **must mount** the base sandbox + permission-preset table (including Read Only). Today the bridge patch rides `dsh-base` without that table; the harness vscode profile / bridge `cordis.patch.yml` must insert the same three presets as `packages/bundle/base/cordis.patch.yml`.

### 4.3 Model

Catalog: `ctx.llm.listModels` + `resolveModelInfo`; omit entries that are not currently usable (missing credentials/config). `selectModel { provider, model }` mirrors Host `session.selectModel`: in-memory override for the live session, applied when the loop assembles the next request. Include `contextWindow` on catalog rows (Host catalog omits it; the vscode wire includes it for the meter).

### 4.4 Context meter

After idle and after `request/context`, emit `context { used, window }` where `used` is projected next-request tokens (`tokenMeter.measure` / `contextPressure.projectedTokens`) and `window` is the selected model’s `contextWindow`. If `window` is unknown, omit `context` (webview hides the meter). Percent = `round(100 * used / window)`, capped at 100 for display.

## 5. Protocol (`PROTOCOL_VERSION = 2`)

### 5.1 Outbound (bridge → extension → webview)

Existing: `hello`, `session`, `event`, `ask`, `status`.

Add:

| kind | payload |
|---|---|
| `ready` | `{ sessionId, cwd, models, permissions, context? }` |
| `sessions` | `{ items: SessionListItem[] }` |
| `catalog` | `{ current: { provider, model }, models: ModelListItem[] }` |
| `permissions` | `{ current: string, presets: { id, label }[] }` |
| `context` | `{ used: number, window: number }` |
| `history` | `{ sessionId, events: SessionEventWire[] }` |

`SessionListItem`: `{ sessionId, title, createdAt, updatedAt, cwd }`.
`ModelListItem`: `{ provider, model, label, contextWindow? }`.

`hello` remains host-recorded for version check; **also forward** `ready` (not `hello`) to the webview.

### 5.2 Inbound (webview → host → bridge)

Existing: `submit`, `answer`, `cancel`, `resume`, `exit`.

Add:

| kind | payload |
|---|---|
| `listSessions` | `{}` |
| `newSession` | `{}` |
| `selectModel` | `{ provider, model }` |
| `selectPermission` | `{ preset: string }` |

`resume` is no longer a no-op: `{ sessionId }`.

`submit` may include optional `{ provider?, model?, permission? }` copied from the composer so the first send after a picker change cannot race a lost select.

### 5.3 Host-only UI commands (never reach the bridge)

- `{ kind: "apply" }` — existing.
- `{ kind: "confirmNewChat" }` — host `showWarningMessage`; on Yes, host sends `cancel` then `newSession`.

## 6. UI

### 6.1 Header (inside the webview)

Native view title cannot host a spinner. Header row: title `DSH: Chat`, spinner visible while `status` is starting (from `dsh.start` until `ready`) or `thinking`. Three Codicon buttons: Recent, Settings, New chat. The later settings parity design owns the enabled Settings behavior.

### 6.2 Recent popover

Opens under Recent. Search filters `title` (case-insensitive). List `max-height` ≈ five rows, overflow scroll. Click row → `resume`. Click outside or Escape closes. If listing is unavailable: “Session history unavailable”. If empty: “No recent chats”.

### 6.3 Composer

One squircle (`border-radius: 16px`) wrapping textarea + bottom toolbar.

- Left: permission `<select>`, model `<select>`.
- Right: SVG percent circle (tooltip `used / window`), icon Send.
- Enter sends; Shift+Enter newline. Send disabled when trimmed text is empty or not `ready`.

Full Access: modal/confirm once per `sessionId` in the webview; cancel reverts the select.

## 7. Error handling

| Failure | User-visible behavior |
|---|---|
| Spawn / handshake | `status:error`; spinner off; composer disabled |
| Resume missing / wrong cwd | `status:error` with id; keep current session |
| Non-routable model | keep previous; error banner |
| Permission blocked (e.g. PTY narrowing) | revert picker to `permissions.current`; banner |
| Unknown context window | hide meter |
| Query/persistence missing | Recent empty-state “Session history unavailable”; New Chat still works |

Do not fail silent. Misconfiguration of the vscode profile (missing `permissionPresets` / `sessions`) fails at bridge start with `status:error`.

## 8. Testing

- **Contract:** new kinds round-trip; `isInboundMessage` / `isOutboundMessage` updated.
- **Bridge:** temp JSONL session root + mock LLM: list cwd-filtered; new vs resume; selectModel on next turn; `permission/preset` events; `context` after a turn.
- **Extension store:** starting flag; Recent filter; New Chat confirm command; Full Access confirm-once; meter percent; composer disabled until `ready`.
- **E2E:** existing smoke `dsh.start` still passes. No DSH website snapshot unless harness user-visible docs/CLI change.

## 9. Files (expected)

**`dsh-vscode-extension`**

- `packages/contract/src/protocol.ts` — v2 unions + guards
- `packages/bridge/src/runner.ts` — session controller
- `packages/bridge/src/commands.ts` — dispatch new kinds
- `packages/bridge/cordis.patch.yml` — persistence, permission presets, token-meter, sandbox stack
- `packages/extension/src/webview/media/{App,store,style}.tsx|ts|css`
- New components: `Header.tsx`, `RecentPopover.tsx`, `ComposerToolbar` (or extend `Composer.tsx`)
- `packages/extension/src/webview/panel.ts` — confirm New Chat; forward `ready`
- Tests: contract, bridge, `store.test.ts`

**`deepseek-harness` (only if required)**

- Export or profile wiring so vscode can mount JSONL persistence, permission-preset table, and token-meter without Host.
- Agent Note in the same PR.

## 10. Implementation order

1. Contract v2 + tests.
2. Harness/profile mounts (if needed) + bridge session controller + tests.
3. Extension host confirm + message forwarding.
4. Webview chrome + store tests.
5. Docs (extension README) + agent note.

## 11. Open implementation details (non-blocking)

- Exact Codicon names (`history`, `settings-gear`, `add`).
- Whether resume history is a single `history` batch or replay of individual `event` lines (spec prefers one `history` then live `event`).
- Whether `ready` duplicates `catalog`/`permissions`/`context` as nested fields (spec: nested on `ready`, also push standalone updates later).

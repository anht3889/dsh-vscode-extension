# DSH VS Code Control Plane — Design Spec

**Date:** 2026-08-21
**Status:** Draft — pending user review
**Classification:** Architectural (new project)

## 1. Goal

Build a VS Code extension that acts as a **full control plane** for the DeepSeek Harness
(`dsh`), directly comparable to the Claude Code and Codex VS Code extensions. The extension
spawns and manages `dsh` as a background agent, streams its events into a custom UI, and
provides status-bar + diagnostics integration — with the human acting as the approval gate
(human-in-the-loop).

## 2. Non-Goals (first slice deliberately excludes)

- Inline code completion (Copilot-style ghost text).
- A replacement for `dsh web`'s browser experience.
- Managing DSH profiles/plugins from inside the extension (out of scope until after v1).
- Multi-root fan-out across many workspaces in one session (one session per folder is enough).

## 3. Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Integration mode | **Spawn `dsh` as a child process** over a new stdio streaming profile | Decoupled, robust; honors DSH's own Node/sandbox/env; mirrors how Claude Code / Codex wrap their CLI |
| DSH coupling | Author a **new Cordis bridge plugin** that emits session events as ndjson and accepts commands on stdin | Stock `dsh-headless` only prints a final answer and exits; the stock runner cannot stream or accept follow-up |
| Approval model | **VS Code is the approval gate (HITL)** | DSH pauses on `userQuestions`/approval; VS Code renders the ask and sends the answer back |
| First-slice scope | **Everything**: chat + diffs + approvals + in-editor diff apply + decorations | Coherent end-to-end vertical slice |
| Distribution | Marketplace-ready TypeScript extension (Marketplace + Open VSX) | Broad reach |
| Repo layout | **Monorepo**: bridge plugin + extension co-located; **upstream later** | Tight iteration on a shared protocol; publish-based deps keep the bridge lift-and-shift clean |

## 4. Architecture

### 4.1 The core insight

DSH already provides every control-plane primitive except a forcing function that streams them
out and accepts commands back in:

- **Event-sourced sessions** — `session.events` is an append-only log
  (`turn/start`, `user/message`, `assistant/message`, `assistant/chunk`, `tool/result`,
  `turn/end`, …), each entry with a monotonic `seq` and deep-frozen JSON `data`.
- **A blocking approval seam** — `ctx.userQuestions.ask()` pauses the agent until answered.
- **A one-shot recipe** — `dsh-headless` demonstrates create-Agent → `followup` → `whenIdle`
  → read events.

Missing: streaming out and command-in. That is the bridge plugin.

### 4.2 The DSH side: `@deepseek-ai/dsh-profile-vscode` (stdio bridge)

A Cordis plugin modeled on `dsh-headless`:

1. Boots the base agent tree (persona + tools + Code Mode worker), **no Host / HTTP / browser**.
2. Opens a **bidirectional ndjson channel** (stdout = DSH→extension, stdin = extension→DSH).
3. **Outbound:** subscribes to `session/event` and relays every event (verbatim, incl. `seq`)
   plus control messages (`hello`, `session`, `ask`, `status`).
4. **Inbound:** handles `submit`, `answer`, `cancel`, `resume`, `exit`.
5. Renders `userQuestions` asks **to the extension**, not a terminal: a pending question
   serializes as an outbound `ask` and blocks until an inbound `answer` arrives.

### 4.3 The extension side (three layers)

- **Process manager** — resolve `dsh` (PATH / `dsh.binaryPath`), spawn `--profile vscode`,
  manage lifecycle per workspace folder (start / stop / restart / crash-recover).
- **Protocol codec** — type-safe ndjson encode/decode, shared TS types with the bridge.
- **UI** — React webview chat stream + tool-call cards + inline diffs + approval banner;
  VS Code tree view for sessions; status bar item; `WorkspaceEdit`/decorations for editor apply.

### 4.4 Data flow (happy path)

```
user types task in sidebar
  → extension: {cmd:"submit", text}
  → DSH agent runs, emits events (assistant/message, tool/result, …)
  → extension streams them into the webview
  → agent hits ask_user_question / approval → DSH emits {kind:"ask"} and blocks
  → extension renders choices → user Approves → {cmd:"answer", askId, …}
  → agent resumes, writes files → extension shows diff → "Apply to editor"
  → turn ends (turn/end) → status bar idle
```

## 5. Protocol (the contract)

Newline-delimited JSON (ndjson), one message per line, both directions. Every message is a
discriminated union on a `kind` field, and `hello` carries a protocol `version`.

### 5.1 Outbound (DSH → extension)

| kind | purpose |
|---|---|
| `hello` | boot complete: protocol version, `dsh` version, `cwd`, available model |
| `session` | session identity/header (id, cwd, createdAt) |
| `event` | one `session.events` entry verbatim (type + frozen `data` + `seq`) — the universal stream |
| `ask` | a pending `userQuestions` request blocking the agent; carries `askId` + question(s) |
| `status` | lifecycle/health (busy/idle, current turn, token usage), and typed errors |

### 5.2 Inbound (extension → DSH)

| kind | purpose |
|---|---|
| `submit` | new user message / follow-up (`text`, optional attachments) |
| `answer` | resolve pending `askId` — `{ id, selected, custom }` matching `ask_user_question` |
| `cancel` | abort the in-flight turn (typed cancel cause) |
| `resume` | resume a persisted session by id |
| `exit` | graceful shutdown → flush session, exit 0/1 |

### 5.3 Protocol design choices

1. **`event` relays the raw session event verbatim.** No reduced schema. Future event types
   (compaction, retries, subagents) flow through untouched; the extension interprets a known
   subset and routes the rest to a detail/log view.
2. **Token streaming rides `assistant/chunk`** (usage/streaming chunks); the extension renders
   what arrives rather than re-buffering.
3. **Version negotiation in `hello`** — on mismatch the extension degrades to a raw log view.
4. **`ask` is separate from `event`** despite originating from a tool call, because HITL needs a
   stable `askId` request/answer pairing, and the human answers the extension, not a tool result.

## 6. UI / UX & editor integration

- **Composer** — multi-line input, model picker, folder context, start/resume.
- **Stream view** — assistant markdown + live tokens; collapsible tool-call cards (bash
  stdout/stderr, read/write, str-replace) with inline unified diffs for write/edit tools.
- **Approval banner** — pinned, high-contrast Approve/Reject (and per-option choices for a full
  `ask_user_question`), driven by `ask` messages.
- **Session tree view** — running/previous sessions per workspace, resume + cancel.
- **Apply-to-editor** — write/edit tool results render a diff; "Apply" uses `WorkspaceEdit` +
  TextDocumentContentProvider; revert affordance provided.
- **Decorations** — gutter markers on files touched this turn + pre-apply diff peek.
- **Status bar** — persistent `DSH` item (idle → thinking → awaiting-approval → error), spinner,
  current model, click-to-focus.

## 7. Error handling, testing, packaging

### 7.1 Error handling

- Failures surface in-band as `status` messages with a typed code → snackbar/status-bar state.
- Child crash/exit → detect exit code + stderr tail → offer "restart session".
- Protocol desync → codec catches bad ndjson, skips non-fatal framer errors (count surfaced in
  diagnostics) without killing the agent.

### 7.2 Testing (test-driven development throughout)

- **Protocol codec** — pure unit tests, serialized fixtures in both directions.
- **Bridge plugin** — driven against DSH's **mock LLM server** (`dsh-llm-mock-server`) for
  deterministic headless runs in CI; assert emitted ndjson.
- **Extension** — a **fake DSH process** (node script speaking the protocol) wires into the
  process manager, enabling spawn/stream/answer/cancel tests without the real CLI.
- **E2E smoke** — launch real `dsh --profile vscode` under VS Code's Extension Test framework
  with a scripted task.

### 7.3 Packaging

- TypeScript, bundled with esbuild.
- `dsh` resolved from PATH (configurable via `dsh.binaryPath`).
- Publish to Marketplace + Open VSX (icon, README, GitHub Actions building VSIX).

## 8. Repo layout

```
dsh-vscode-extension/
├── packages/
│   ├── bridge/        # the stdio bridge plugin (npm scope TBD — see below)
│   └── extension/    # the VS Code extension (npm scope TBD)
├── packages/contract/ # shared ndjson protocol types (single source of truth)
├── package.json       # pnpm workspace root
└── … CI, icons, README
```

Bridge deps are the **published** `@deepseek-ai/*` packages. Upstreaming the bridge into the
DSH monorepo (`packages/bundle/vscode`) is a post-v1 step; until then the extension points at the
local package or a published fork.

**Note on package names:** `@deepseek-ai/*` is reflected here only to identify the DSH packages
the bridge depends on; we do **not** own the `@deepseek-ai` npm scope, so the final scopes for the
bridge package and the extension package are an open (non-blocking) decision to be made before
first publish — anything we publish must use a scope we control (or be unpublished local
workspace packages until upstreaming).

## 9. Build order (phases)

- **Phase 0 — Spike (de-risk):** confirm the bridge plugin can boot over `dsh-base`, subscribe to
  `session/event`, and stream real traffic driven by the mock LLM — using only published packages.
  If the needed hooks (`appExit`, session subscription, agent cancel path) aren't reachable via
  published packages, this upgrades to "develop inside a DSH checkout."
- **Phase 1 — Protocol + bridge plugin** (codec, hello/status/event/ask, submit/answer/cancel/resume,
  mock-LLM tests).
- **Phase 2 — Process manager + codec in the extension** (spawn lifecycle, fake-DSH tests).
- **Phase 3 — Webview UI** (composer, stream, tool cards, approval banner).
- **Phase 4 — Editor integration** (apply-to-editor, decorations, status bar).
- **Phase 5 — Polish + packaging + E2E + publish.**

## 10. Open Items / Risks

- **R1 (blocking):** whether the bridge can be built against *published* `@deepseek-ai/*` packages
  or requires DSH monorepo internals — answered by Phase 0.
- **R2:** exact `session/event` subscription seam and agent-cancel API surface (verify in Phase 0/1).
- **R3:** Webview React toolchain choice (bundling + HMR inside VS Code webview) — decide in Phase 3.
- **R4:** `dsh` binary discovery across platforms (PATH vs. bundled vs. `DSH_HOME`) — Phase 2.

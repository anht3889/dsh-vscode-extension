# DeepSeek Harness VS Code Agent Timeline — Design Spec

**Date:** 2026-08-25
**Status:** Approved in chat on 2026-08-25
**Classification:** Architectural (webview timeline + bridge tool presentation views)
**Baseline:** `dsh-vscode-extension` `main` at protocol v6 after MCP OAuth onboarding.

This document supersedes the slash-menu locked decision “Commands in transcript: Render `command/run` as a user slash turn” in [2026-08-23-dsh-vscode-slash-menu-design.md](2026-08-23-dsh-vscode-slash-menu-design.md). Composer slash detection, catalog, pick, and execute semantics in that spec remain authoritative.

## 1. Goal

The Chat stream shows the same work a person sees in Cursor, Copilot Chat, and DeepSeek Harness Web: streaming reasoning that collapses when the answer starts, a tool-call row for every tool (not only file diffs), and a dedicated card for slash-command runs. Live turns and resumed history use one fold.

## 2. Non-goals

- Importing `@deepseek-ai/dsh-client-ui-trajectory`, `@deepseek-ai/dsh-client-ui-tool`, or other Cordis web slot/React packages into the webview.
- Nested subagent / `tool/code-dispatch*` trees in this phase (parent tool row only).
- Changing the `ask` approval banner (still first question, still not a timeline row).
- Jumping the VS Code editor to tool `locations`.
- Replacing NDJSON with Host HTTP RPC.
- A protocol version bump. `view` is optional on the existing event envelope; extension and bridge still ship together.

## 3. Locked decisions

| Topic | Choice |
| --- | --- |
| Approach | Local timeline fold + optional Host-style `view` on the wire |
| Thinking | Full streamed text in a Think disclosure; collapsed summary while running is the latest line; after the answer starts, the row collapses to the first line |
| Tools | Title + one-line summary + status by default; args and result behind expand |
| Commands | Dedicated command card from `command/run` / `command/done`; not a user bubble |
| Diffs | Diff tool rows sit in timeline order; Apply all diffs remains for the current turn |
| Replay | Same `foldEvent` over live `event` and `history.events` |
| Missing presenters | Generic title from tool name; event still renders |
| Presenter throws | Event ships without `view`; UI uses the generic card |

## 4. Architecture

Three layers, unchanged:

1. **Bridge** serializes session events and, for `tool/call` and `tool/result`, attaches a presentation `view` when `ctx.tools` can present that tool in the live agent scope.
2. **Contract** carries optional `view` on `SessionEventWire`. `data` stays the verbatim session payload.
3. **Webview** folds events into an ordered timeline and renders row components. The extension host still forwards events, accumulates applyable diffs, and applies them.

Do not fold presentation into the session log. `view` is computed per delivery, matching Host `HistoryEntry.view`.

```
session event  →  runner toWire(+ viewFor)  →  NDJSON event/history
                                              →  foldEvent → TimelineRow[]
                                              →  StreamView
```

### 4.1 Wire `view`

```ts
type ToolEventView =
  | { for: "call"; view: ToolCallView }
  | { for: "result"; view: ToolResultView };

type SessionEventWire = {
  type: string;
  seq: number;
  time: number;
  data: Record<string, any> & { raw?: Record<string, unknown> };
  view?: ToolEventView;
};
```

`ToolCallView` / `ToolResultView` are the tagged unions from `@deepseek-ai/dsh-tools` presentation (`generic` | `terminal` | `diff` for calls; plus `search` | `read` | `web` for results). The contract copies the JSON-serializable subset; it does not import harness packages into the webview bundle.

`toWire` stays a pure mapping of `type`/`seq`/`time`/`data`. A sibling `viewFor(ctx, event, argsFor, scope)` mirrors Host `api-proxy.ts`: `presentCall` on `tool/call`, `presentResult` on `tool/result` after pairing `callId` to arguments. JSON.parse or presenter throws log and omit `view`. Live events backscan the in-memory session log for the matching `tool/call`. History maps each event with the same helper over the history array.

### 4.2 Timeline model

Replace `TranscriptEntry` with a discriminated `TimelineRow`:

```ts
type TimelineRow =
  | { kind: "user"; seq: number; text: string }
  | {
      kind: "thinking";
      seq: number;
      text: string;
      running: boolean;
    }
  | {
      kind: "assistant";
      seq: number;
      text: string;
      streaming: boolean;
    }
  | {
      kind: "tool";
      callId: string;
      seq: number;
      name: string;
      argsRaw: string;
      status: "running" | "ok" | "error" | "stopped";
      summary: string;
      title: string;
      callView?: ToolCallView;
      resultView?: ToolResultView;
      resultText?: string;
      error?: { name?: string; code?: string };
      diffs?: ToolDiff[];
    }
  | {
      kind: "command";
      commandId: string;
      seq: number;
      name: string;
      args: string | null;
      status: "running" | "success" | "error";
      output?: string;
    };
```

`UiState.transcript` becomes `timeline: TimelineRow[]`. `UiState.diffs` remains the current-turn apply buffer (cleared on `turn/start`), derived from diff-shaped `tool/result` meta/arguments **and** `DiffResultView.diffs` so Apply all stays aligned with the host `pending` list.

User rows stay `source.kind === "user"` only. Injected plugin / session-reference / subagent-report messages stay out.

### 4.3 Fold rules

One function, used live and on `history`:

| Event | Effect |
| --- | --- |
| `user/message` (kind user) | Append user row from text blocks |
| `assistant/chunk` `reasoning-delta` | Append or extend thinking row (`running: true`) |
| `assistant/chunk` `text-delta` | Mark thinking `running: false`; append or extend assistant row (`streaming: true`) |
| `assistant/chunk` `tool-call-delta` | Upsert tool row by `chunk.id` (`status: running`); accumulate `name` and `argumentsDelta` |
| `assistant/message` | Finalize streaming assistant text from text blocks; finalize reasoning blocks; upsert tool-call content blocks by id |
| `tool/call` | Upsert tool row (`status: running`) from `callId`, `name`, `arguments`; apply `view` when `for === "call"` |
| `tool/result` | Settle matching tool row: `ok` if not error, `stopped` if `error.code === "interrupted"`, else `error`; apply result `view`; extract diffs into the row and `state.diffs` |
| `command/run` | Upsert command row (`status: running`) from `commandId`, `name`, `args ?? null` |
| `command/done` | Settle matching command: `success` or `error` from `kind`; `text` is expandable output |
| `turn/start` | Close streaming/running flags; clear `state.diffs` and approval |
| Other types | No timeline change |

Identity:

- Thinking and assistant text: last open row of that kind in the current assistant step, else append.
- Tools: `callId` (from `tool-call-delta.id`, `tool/call` data, or `tool/result` `message.source.callId`).
- Commands: `commandId`.

A tool-only assistant step does not invent an empty assistant text row.

### 4.4 Row presentation

**Thinking.** Disclosure titled Think. Collapsed: latest line while `running`, first line otherwise. Expanded: full `text`. Local UI state starts expanded while `running` and collapses when `running` becomes false (answer started or turn closed). The person may re-expand. Resume: historical thinking rows are collapsed.

**Assistant text.** Existing markdown renderer. `streaming` may show a caret; not required for v1 of this feature.

**Tool.** Collapsed: `title` (from `callView.title` / `resultView.title` / tool name), `summary` (presenter description, terminal command, or a short args preview), status. Expanded: `rawInput` or args JSON; result `content` / terminal `output` / search/read/web payloads when present; otherwise `resultText` from tool result content blocks. Diff card: existing two-column DiffView inside the expanded body. Status: running spinner; ok / error / stopped as text.

**Command.** Collapsed: `/name` plus args when present, plus status. Expanded: `output` when `command/done` carried `text`. Composer slash behavior is unchanged; the stream no longer duplicates the invocation as a user bubble.

**Apply all diffs.** Still after the stream, still posts `{ kind: "apply" }` to the host pending buffer. The host continues to collect diffs from `tool/result` the same way, plus `DiffResultView.diffs` when `view` is present so apply and display stay paired.

### 4.5 Summary derivation

Keep this in the webview, not the bridge:

- Prefer `callView.description` (terminal) or `callView.title`.
- Else first string among common arg keys (`command`, `path`, `query`, `pattern`, `url`) parsed from `argsRaw`.
- Else empty; the title still shows.

Do not copy `toolRowModel` from ui-tool as a package. Port the small title/summary helpers if needed.

## 5. UI components

| Component | Role |
| --- | --- |
| `StreamView` | Renders `timeline` in order, then Apply all when `diffs.length > 0` |
| `ThinkingRow` | Think disclosure |
| `ToolRow` | Collapsed summary + expand; hosts DiffView when diffs exist |
| `CommandRow` | Slash-command card |
| `ToolCard` | Retire or reduce to DiffView wrapper used by `ToolRow` |

Approvals stay `ApprovalBanner`. Header busy spinner stays turn-level (`status === "thinking"`).

## 6. Failure behavior

- No `view`: generic tool row from name + args/result text.
- Unparseable `argsRaw`: show raw string in expand; do not throw.
- `tool/result` with no matching call: append a settled row keyed by `callId` with name `"tool"` if name unknown.
- `command/done` with no matching run: append a settled command row with `name` empty if unknown.
- History: diffs for prior turns are display-only on those tool rows; `state.diffs` and host `pending` stay empty after replay until the next live `tool/result` in the current turn.
- Foreign-session events remain ignored.

## 7. Testing

### Contract

- `SessionEventWire` accepts optional `view` tagged `for: "call" | "result"`.
- Reject `view.for` values other than those two.
- Protocol version stays 6.

### Bridge

- `tool/call` with a presenter includes `{ for: "call", view }`.
- `tool/result` includes `{ for: "result", view }` when the call can be paired.
- Presenter throw / bad JSON: event without `view`.
- History resume attaches views the same way as live.

### Store

- Reasoning deltas create a thinking row; text-delta sets `running: false` and starts assistant text.
- Tool-call deltas and `tool/call` create running tool rows; `tool/result` settles them.
- Non-diff `tool/result` still appears.
- Diff meta and `DiffResultView` both populate row diffs and `state.diffs`.
- `command/run` is a command row, not a user row; `command/done` settles it.
- History replay matches the live fold for thinking, tools, and commands.
- Existing user-text, markdown coalescing, injected-context hiding, and command-claim tests stay green (claim still keys off `command/run` name, not row kind).

### StreamView

- Think disclosure shows latest-line summary while running and first-line after collapse.
- Tool row expand reveals args/result; collapsed does not.
- Command row shows `/name` and expandable output.
- Apply all still fires when current-turn diffs exist.

## 8. Documentation

Update the extension README Chat section: thinking disclosure, tool rows, command cards, Apply all. Do not document protocol internals.

## 9. Acceptance

1. A turn that emits `reasoning-delta` then `text-delta` shows Think (streaming summary), then a collapsed Think plus markdown answer.
2. A bash (or other non-diff) tool shows a running row then a settled row; expand shows command/output or generic args/result.
3. A file edit shows a tool row in order with expandable diff; Apply all still applies current-turn diffs.
4. `/compact` or another slash command appears as a command card, not as a user message bubble.
5. Resume of that session reconstructs thinking, tools, and commands from `history` with the same fold.
6. A tool without `presentCall`/`presentResult` still renders a generic row.

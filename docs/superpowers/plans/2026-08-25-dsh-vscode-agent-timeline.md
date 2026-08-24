# VS Code Agent Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chat shows collapsible thinking, a row for every tool call, and a dedicated slash-command card, with live turns and resumed history using the same fold.

**Architecture:** Keep NDJSON protocol v6. The bridge attaches optional Host-style `view` on `tool/call` and `tool/result`. The webview replaces `TranscriptEntry[]` with an ordered `TimelineRow[]` fold and renders Thinking / Tool / Command rows in stream order.

**Tech Stack:** TypeScript, Vitest, Testing Library, React webview, Cordis `ctx.tools` presenters, `@dsh-vscode/contract` NDJSON.

**Spec:** `docs/superpowers/specs/2026-08-25-dsh-vscode-agent-timeline-design.md`

## Global Constraints

- Protocol version stays **6**. `view` is optional on `SessionEventWire`.
- Do not import `@deepseek-ai/dsh-client-ui-trajectory` or `@deepseek-ai/dsh-client-ui-tool`.
- Do not add `tools` to vscode-runner's required `inject` list. `ctx.get("tools")` is optional; missing tools means no `view`.
- `toWire` stays a pure `type`/`seq`/`time`/`data` map. A sibling attaches `view`.
- User rows remain `source.kind === "user"` only.
- Approvals stay the existing banner. No `tool/code-dispatch*` trees.
- `UiState.diffs` and host `pending` stay the current-turn apply buffer; history replay leaves them empty.
- Product copy uses **DeepSeek Harness**, not DSH, except `dsh` binary / setting keys / `DSH_HOME`.
- Do not push, publish, or merge. Do not create commits unless the user explicitly requests them; each task ends at a commit-ready checkpoint.

---

## Rulings Made While Planning

1. **`wireEvent(event, tools, argsFor)`** composes `toWire` plus optional `view`. Live `session/event` and `history` both use it.
2. **`viewFor` is unit-tested against a fake `{ get(name) }`**, not a full Cordis tree.
3. **`TranscriptEntry` is deleted.** Every `transcript` field becomes `timeline: TimelineRow[]`.
4. **`foldEvent` still does not write `state.diffs`.** `reduce` appends turn diffs from `diffFromEventData` **and** `DiffResultView` after folding.
5. **Command rows use `aria-label="Command"`.** User bubbles stay `You`. App slash tests that looked for `/goal` on `You` switch to `Command`.
6. **`ToolDiff.oldText` stays `string`.** A presenter `null` oldText becomes `""`.
7. **StreamView in Task 3 renders only user + assistant** so the store rename compiles; Task 6 adds the other row components.

---

## File Structure

- Modify: `packages/contract/src/events.ts` — `ToolEventView`, presentation unions, `SessionEventWire.view`
- Modify: `packages/contract/src/protocol.ts` — `isSessionEventWire`; validate `event` / `history`
- Modify: `packages/contract/src/protocol.test.ts`
- Modify: `packages/bridge/src/runner.ts` — `viewFor`, `wireEvent`
- Modify: `packages/bridge/test/runner.test.ts`
- Create: `packages/extension/src/webview/media/toolSummary.ts` + `toolSummary.test.ts`
- Modify: `packages/extension/src/webview/media/store.ts` + `store.test.ts`
- Create: `ThinkingRow.tsx`, `ToolRow.tsx`, `CommandRow.tsx` (+ tests)
- Modify: `StreamView.tsx` + `StreamView.test.tsx`
- Modify: `ToolCard.tsx` (retire into `ToolRow` / `DiffView`)
- Modify: `style.css`, `App.tsx`, `App.test.tsx`
- Modify: `packages/extension/src/applyEdits.ts` + `test/applyEdits.test.ts`
- Modify: `packages/extension/README.md`

---

### Task 1: Optional `view` on the v6 event envelope

**Files:**
- Modify: `packages/contract/src/events.ts`
- Modify: `packages/contract/src/protocol.ts`
- Test: `packages/contract/src/protocol.test.ts`

**Interfaces:**
- Consumes: existing `SessionEventWire` `{ type, seq, time, data }`
- Produces:
  - `ToolCallKind`, `FileLocation`, `FileDiff` (`oldText: string | null`)
  - `ToolCallView` = `GenericCallView | TerminalCallView | DiffCallView`
  - `ToolResultView` = generic | terminal | `DiffResultView` | search | read | web (discriminate search with `shape: "matches" | "paths"`)
  - `ToolEventView` = `{ for: "call"; view: ToolCallView } | { for: "result"; view: ToolResultView }`
  - `SessionEventWire.view?: ToolEventView`
  - `isSessionEventWire(value: unknown): value is SessionEventWire`

- [ ] **Step 1: Write failing protocol tests**

In `protocol.test.ts`, add:

```ts
describe("session event view", () => {
  const base = { type: "tool/call", seq: 1, time: 0, data: { callId: "c1", name: "bash", arguments: "{}" } };

  it("accepts an event without view", () => {
    expect(isOutboundMessage({ kind: "event", sessionId: "s1", event: base })).toBe(true);
  });

  it("accepts a call view", () => {
    expect(isOutboundMessage({
      kind: "event",
      sessionId: "s1",
      event: {
        ...base,
        view: { for: "call", view: { card: "generic", title: "Run bash" } },
      },
    })).toBe(true);
  });

  it("rejects an unknown view.for", () => {
    expect(isOutboundMessage({
      kind: "event",
      sessionId: "s1",
      event: { ...base, view: { for: "other", view: { card: "generic", title: "x" } } },
    })).toBe(false);
  });

  it("rejects a malformed history event view", () => {
    expect(isOutboundMessage({
      kind: "history",
      sessionId: "s1",
      events: [{ ...base, view: { for: "call" } }],
    })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @dsh-vscode/contract test src/protocol.test.ts`

Expected: FAIL — `view` is not validated; unknown `for` still accepted because `event`/`history` fall through `validateOutboundPayload` default `true`.

- [ ] **Step 3: Implement types and validators**

In `events.ts`, add the presentation unions from the spec (JSON-serializable; use `unknown` / `unknown[]` for `rawInput` and `content`, not harness `ContentBlock`). Extend `SessionEventWire` with optional `view`.

In `protocol.ts`, export `isSessionEventWire`:

- `type` non-empty string, `seq`/`time` finite numbers, `data` non-array object
- `view` omitted or `{ for, view }` closed record
- `for === "call"` ⇒ `view.card` is `"generic" | "terminal" | "diff"`
- `for === "result"` ⇒ `view.card` is `"generic" | "terminal" | "diff" | "search" | "read" | "web"`

In `validateOutboundPayload`:

```ts
case "event":
  return typeof o.sessionId === "string" && o.sessionId.length > 0
    && isSessionEventWire(o.event);
case "history":
  return typeof o.sessionId === "string" && o.sessionId.length > 0
    && Array.isArray(o.events)
    && o.events.every(isSessionEventWire);
```

Keep `PROTOCOL_VERSION === 6`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @dsh-vscode/contract test`

Expected: PASS including existing outbound cases.

- [ ] **Step 5: Commit-ready** — types + validators only.

---

### Task 2: Bridge `viewFor` / `wireEvent`

**Files:**
- Modify: `packages/bridge/src/runner.ts`
- Test: `packages/bridge/test/runner.test.ts`

**Interfaces:**
- Consumes: Task 1 `ToolEventView`; `SessionEvent` from `dsh-session`; optional `ctx.get("tools")` with `get(name, scope?).presentCall` / `presentResult`
- Produces:
  - `export function toWire(event: SessionEvent): SessionEventWire` — unchanged (no `view`)
  - `export function viewFor(tools, event, argsFor): ToolEventView | undefined`
  - `export function wireEvent(event, tools, argsFor): SessionEventWire`
  - Live listener and `history` use `wireEvent`

`argsFor(callId)` returns `{ name: string; args: unknown } | undefined`. `args` is `JSON.parse` of `tool/call` `arguments` string, or `undefined` if parse fails.

- [ ] **Step 1: Write failing `viewFor` tests** in `runner.test.ts`

```ts
describe("viewFor", () => {
  const tools = {
    get(name: string) {
      if (name !== "bash") return undefined;
      return {
        presentCall: (args: unknown) => ({ card: "terminal" as const, title: "echo hi", description: "Say hi" }),
        presentResult: () => ({ card: "terminal" as const, output: "hi\n", exitCode: 0 }),
      };
    },
  };

  it("attaches a call view", () => {
    expect(viewFor(tools, {
      type: "tool/call", seq: 1, time: 0,
      data: { callId: "c1", name: "bash", arguments: "{\"command\":\"echo hi\"}" },
    }, () => undefined)).toEqual({
      for: "call",
      view: { card: "terminal", title: "echo hi", description: "Say hi" },
    });
  });

  it("attaches a result view when the call can be paired", () => {
    expect(viewFor(tools, {
      type: "tool/result", seq: 2, time: 1,
      data: { message: { content: [{ content: [], isError: false }], source: { callId: "c1" } } },
    }, () => ({ name: "bash", args: { command: "echo hi" } }))).toEqual({
      for: "result",
      view: { card: "terminal", output: "hi\n", exitCode: 0 },
    });
  });

  it("omits view when tools is missing, pairing fails, JSON is bad, or the presenter throws", () => {
    expect(viewFor(undefined, { type: "tool/call", seq: 1, time: 0, data: { callId: "c1", name: "bash", arguments: "{" } }, () => undefined)).toBeUndefined();
    expect(viewFor(tools, { type: "tool/result", seq: 2, time: 1, data: { message: { content: [{}], source: { callId: "missing" } } } }, () => undefined)).toBeUndefined();
    const boom = { get: () => ({ presentCall: () => { throw new Error("nope"); } }) };
    expect(viewFor(boom, { type: "tool/call", seq: 1, time: 0, data: { callId: "c1", name: "bash", arguments: "{}" } }, () => undefined)).toBeUndefined();
  });
});

it("wireEvent adds view only when viewFor returns one", () => {
  const event = { type: "turn/end", seq: 1, time: 0, data: { turn: 1, reason: { kind: "completed" } } };
  expect(wireEvent(event, undefined, () => undefined).view).toBeUndefined();
});
```

Match the real `dsh-session` `tool/result` `message.source.callId` field names if they differ.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @dsh-vscode/bridge test test/runner.test.ts`

Expected: FAIL — `viewFor` / `wireEvent` not exported.

- [ ] **Step 3: Implement**

Mirror Host `api-proxy.ts` `viewFor`: try/catch, `tool/call` → `presentCall(JSON.parse(raw))`, `tool/result` → pair via `argsFor` then `presentResult`. Log presenter failures with `console.error` and return `undefined`.

```ts
export function wireEvent(event: SessionEvent, tools, argsFor): SessionEventWire {
  const wire = toWire(event);
  const view = viewFor(tools, event, argsFor);
  return view === undefined ? wire : { ...wire, view };
}
```

`backscanArgs(events, callId)` walks `events` backward for `type === "tool/call"` with matching `data.callId`.

Replace live `toWire(event)` with `wireEvent(event, ctx.get("tools"), (id) => backscanArgs(session.events, id))`.

Replace history `session.events.map(toWire)` with `session.events.map((event) => wireEvent(event, ctx.get("tools"), (id) => backscanArgs(session.events, id)))`.

Add `import type {} from "@deepseek-ai/dsh-tools"` so `ctx.get("tools")` types. Do **not** add `"tools"` to `inject`.

Keep existing `toWire` round-trip test (still no `view`).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @dsh-vscode/bridge test test/runner.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit-ready**

---

### Task 3: Timeline fold for user, thinking, and assistant text

**Files:**
- Modify: `packages/extension/src/webview/media/store.ts`
- Modify: `packages/extension/src/webview/media/store.test.ts`
- Modify: `packages/extension/src/webview/media/App.tsx`
- Modify: `packages/extension/src/webview/media/components/StreamView.tsx`
- Modify: `packages/extension/src/webview/media/components/StreamView.test.tsx`

**Interfaces:**
- Consumes: none from Task 2 at runtime
- Produces:
  - `export type TimelineRow` with user / thinking / assistant / tool / command variants (this task only **folds** user, thinking, assistant; `command/run` still folds as a user row until Task 5)
  - `UiState.timeline: TimelineRow[]` (delete `transcript` / `TranscriptEntry`)
  - `foldEvent(rows, event): TimelineRow[]`

User: `{ kind: "user"; seq: number; text: string }`
Thinking: `{ kind: "thinking"; seq: number; text: string; running: boolean }`
Assistant: `{ kind: "assistant"; seq: number; text: string; streaming: boolean }`

- [ ] **Step 1: Rewrite store tests for the new row kinds**

Replace `TranscriptEntry` assertions with `kind: "assistant" | "user"` rows including `seq`.

Change `ignores reasoning deltas` to `streams reasoning then collapses it when answer text starts`:

```ts
it("streams reasoning then collapses it when answer text starts", () => {
  const thinking = reduce(initialState, reasoningDelta("line one\nline two"));
  expect(thinking.timeline).toEqual([
    { kind: "thinking", seq: 1, text: "line one\nline two", running: true },
  ]);
  const answered = reduce(thinking, textDelta("Hello"));
  expect(answered.timeline).toEqual([
    { kind: "thinking", seq: 1, text: "line one\nline two", running: false },
    { kind: "assistant", seq: 1, text: "Hello", streaming: true },
  ]);
});
```

Keep command/run tests as **user** rows for this task. Replace every `state.transcript` with `state.timeline`.

- [ ] **Step 2: Run store tests to verify they fail**

Run: `pnpm --filter dsh exec vitest run src/webview/media/store.test.ts`

Expected: FAIL on `timeline` / thinking.

- [ ] **Step 3: Implement fold + rename**

In `foldEvent`:

- `user/message` → user row (`source.kind === "user"`, `messageText`)
- `reasoning-delta` → last thinking with `running: true` or append
- `text-delta` → set last running thinking `running: false`; then existing assistant streaming logic
- `assistant/message` → finalize last streaming assistant; finalize last running thinking; skip empty text when there is no streamed assistant
- `command/run` → keep user-row behavior **in this task**
- `closeStreaming` → also set thinking `running: false`

`reduce`: `history` sets `timeline: msg.events.reduce(foldEvent, [])` and `diffs: []`. `turn/start` closes streaming/running. Replace `transcript` with `timeline`.

`App.tsx`: `timeline={state.timeline}`.

`StreamView`: prop `timeline: TimelineRow[]`. Render only `user` and `assistant`; return `null` for other kinds.

Update `StreamView.test.tsx` fixtures to `{ kind: "assistant", seq: 0, text, streaming }`.

- [ ] **Step 4: Run tests**

Run:

```
pnpm --filter dsh exec vitest run src/webview/media/store.test.ts src/webview/media/components/StreamView.test.tsx src/webview/media/App.test.tsx
pnpm --filter dsh typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit-ready**

---

### Task 4: Tool rows in the fold

**Files:**
- Create: `packages/extension/src/webview/media/toolSummary.ts`
- Test: `packages/extension/src/webview/media/toolSummary.test.ts`
- Modify: `packages/extension/src/webview/media/store.ts`
- Modify: `packages/extension/src/webview/media/store.test.ts`

**Interfaces:**
- Consumes: Task 1 view types; Task 3 tool `TimelineRow`
- Produces:
  - `export function toolSummary(input: { name: string; argsRaw: string; callView?: ToolCallView; resultView?: ToolResultView }): { title: string; summary: string }`
  - Fold for `tool-call-delta`, `tool/call`, `tool/result`
  - `reduce` still appends `state.diffs`

- [ ] **Step 1: Write failing summary + fold tests**

`toolSummary.test.ts`:

```ts
it("prefers terminal description then title then parsed arg keys", () => {
  expect(toolSummary({
    name: "bash",
    argsRaw: "{\"command\":\"ls\"}",
    callView: { card: "terminal", title: "ls", description: "List files" },
  })).toEqual({ title: "ls", summary: "List files" });
  expect(toolSummary({ name: "read", argsRaw: "{\"path\":\"/a.ts\"}" }))
    .toEqual({ title: "read", summary: "/a.ts" });
  expect(toolSummary({ name: "mystery", argsRaw: "{" }))
    .toEqual({ title: "mystery", summary: "" });
});
```

Arg key order: `command`, `path`, `query`, `pattern`, `url` — first string wins.

`store.test.ts` (adjust `tool/result` `data` to the real harness shape):

```ts
it("upserts a running tool from tool-call-delta and tool/call", () => {
  const delta = reduce(initialState, eventMsg("assistant/chunk", {
    turn: 1, step: 1,
    chunk: { type: "tool-call-delta", index: 0, id: "c1", name: "bash", argumentsDelta: "{\"command\":" },
  }));
  expect(delta.timeline).toMatchObject([{ kind: "tool", callId: "c1", name: "bash", status: "running" }]);
});

it("settles tools from tool/result including non-diff results", () => {
  const running = reduce(initialState, eventMsg("tool/call", { callId: "c1", name: "bash", arguments: "{}" }));
  const done = reduce(running, eventMsg("tool/result", {
    message: { content: [{ type: "text", text: "ok" }], isError: false, source: { callId: "c1" } },
  }));
  expect(done.timeline[0]).toMatchObject({ kind: "tool", status: "ok", resultText: "ok" });
  expect(done.diffs).toEqual([]);
});

it("marks interrupted tools stopped and records diffs from meta and DiffResultView", () => {
  // error.code === "interrupted" → status "stopped"
  // meta path/oldText/newText → row.diffs and state.diffs
  // view.for result card diff → same, coercing null oldText to ""
});

it("appends a settled tool when result has no matching call", () => {
  const s = reduce(initialState, eventMsg("tool/result", {
    message: { content: [], isError: true, source: { callId: "orphan" } },
    error: { name: "Error", code: "fail" },
  }));
  expect(s.timeline[0]).toMatchObject({ kind: "tool", callId: "orphan", name: "tool", status: "error" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter dsh exec vitest run src/webview/media/toolSummary.test.ts src/webview/media/store.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement `toolSummary` and fold**

`tool-call-delta`: upsert by `chunk.id`; append `argumentsDelta` to `argsRaw`; set `name` when provided; `status: "running"`.

`tool/call`: upsert by `data.callId`; if `event.view?.for === "call"` store `callView`.

`tool/result`: find by `message.source.callId`; if missing, append `{ name: "tool" }`. Status: `stopped` if `error.code === "interrupted"`, else `error` if `isError` or `error`, else `ok`. `resultText` from text blocks. Store `resultView` when `view?.for === "result"`. Collect diffs from `diffFromEventData` plus `resultView.card === "diff"`.

`reduce`: fold `tool/call` and `tool/result`; after a result, append extracted diffs to `state.diffs`.

`assistant/message` `type === "tool-call"` blocks upsert by id.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter dsh exec vitest run src/webview/media/store.test.ts src/webview/media/toolSummary.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit-ready**

---

### Task 5: Command cards in the fold

**Files:**
- Modify: `packages/extension/src/webview/media/store.ts`
- Modify: `packages/extension/src/webview/media/store.test.ts`

**Interfaces:**
- Consumes: Task 3 command variant
- Produces: `command/run` → `{ kind: "command", commandId, seq, name, args, status: "running" }`; `command/done` settles `success` | `error` with optional `output`

`args` is `data.args` if string, else `null`.

- [ ] **Step 1: Change command fold tests**

```ts
it("folds command/run once from authoritative name and args fields", () => {
  const running = reduce(reduce(initialState, textDelta("unfinished")), eventMsg("command/run", {
    commandId: "cmd-1", name: "goal", args: " write tests", source: { kind: "user" },
  }));
  expect(running.timeline).toEqual([
    { kind: "assistant", seq: 1, text: "unfinished", streaming: false },
    { kind: "command", commandId: "cmd-1", seq: 1, name: "goal", args: " write tests", status: "running" },
  ]);
  const done = reduce(running, eventMsg("command/done", {
    commandId: "cmd-1", kind: "success", text: "ok",
  }));
  expect(done.timeline.at(-1)).toMatchObject({ status: "success", output: "ok" });
  expect(done.status).toBe("idle");
});

it("folds command/run history and omits unrecorded command input", () => {
  const resumed = reduce(initialState, {
    kind: "history", sessionId: "s1",
    events: [
      eventMsg("command/run", { commandId: "cmd-1", name: "compact", source: { kind: "user" } }).event,
      eventMsg("command/done", { commandId: "cmd-1", kind: "success" }).event,
    ],
  });
  expect(resumed.timeline).toEqual([
    { kind: "command", commandId: "cmd-1", seq: 1, name: "compact", args: null, status: "success" },
  ]);
});

it("appends command/done without a matching run", () => {
  const s = reduce(initialState, eventMsg("command/done", { commandId: "x", kind: "error", text: "nope" }));
  expect(s.timeline[0]).toMatchObject({ kind: "command", commandId: "x", name: "", status: "error", output: "nope" });
});
```

Pending-command claim tests still key off `command/run` **name**.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter dsh exec vitest run src/webview/media/store.test.ts`

Expected: FAIL — still user rows.

- [ ] **Step 3: Implement command fold**

Upsert by `commandId`. `reduce` folds `command/done` as well as `command/run`, then keeps existing pending-command / idle status logic.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter dsh exec vitest run src/webview/media/store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit-ready**

---

### Task 6: Timeline row UI

**Files:**
- Create: `packages/extension/src/webview/media/components/ThinkingRow.tsx` + `.test.tsx`
- Create: `packages/extension/src/webview/media/components/ToolRow.tsx` + `.test.tsx`
- Create: `packages/extension/src/webview/media/components/CommandRow.tsx` + `.test.tsx`
- Modify: `StreamView.tsx` + `StreamView.test.tsx`
- Modify: `style.css`
- Modify or delete: `ToolCard.tsx` (DiffView moves into `ToolRow`)

**Interfaces:**
- Consumes: `TimelineRow`; `DiffView`
- Produces: Think / tool / command cards in stream order

```ts
export function firstLine(text: string): string;
export function latestLine(text: string): string;
```

- [ ] **Step 1: Write failing component tests**

ThinkingRow: `running: true` starts expanded, summary is latest line; rerender `running: false` collapses to first line; first mount `running: false` is collapsed.

ToolRow: collapsed shows title, summary, status; expand shows `argsRaw` and `resultText` or terminal `output`; diffs appear only when expanded.

CommandRow: shows `/goal write tests`; `aria-label="Command"`; expand shows `output`.

StreamView: renders thinking, assistant, tool, command in array order; Apply all when `diffs.length > 0`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter dsh exec vitest run src/webview/media/components`

Expected: FAIL — components missing.

- [ ] **Step 3: Implement**

`ThinkingRow`: local `expanded` initialized to `running`; auto-collapse only on the true→false `running` transition. Title **Think**.

`ToolRow` / `CommandRow`: disclosure button like current `ToolCard`.

CSS: `.dsh-think`, `.dsh-tool-row`, `.dsh-command-row` using `--dsh-border` / `--dsh-muted`.

StreamView switches on `row.kind`. Apply all still uses the `diffs` prop (current-turn buffer).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter dsh exec vitest run src/webview/media/components`

Expected: PASS.

- [ ] **Step 5: Commit-ready**

---

### Task 7: Host diffs, App wiring, README

**Files:**
- Modify: `packages/extension/src/applyEdits.ts`
- Test: `packages/extension/test/applyEdits.test.ts`
- Modify: `packages/extension/src/webview/media/App.test.tsx`
- Modify: `packages/extension/README.md`

**Interfaces:**
- Consumes: `SessionEventWire.view` `DiffResultView`; command `aria-label`
- Produces: `diffsFromEvent` includes presenter diffs; README describes the timeline

- [ ] **Step 1: Write failing tests**

```ts
it("extracts diffs from a DiffResultView", () => {
  expect(diffsFromEvent({
    type: "tool/result", seq: 1, time: 0,
    data: { message: {} },
    view: { for: "result", view: { card: "diff", diffs: [{ path: "/a.ts", oldText: null, newText: "x" }] } },
  })).toEqual([{ path: "/a.ts", oldText: "", newText: "x" }]);
});
```

In App slash integration, replace the `You` assertion:

```ts
expect(screen.getByLabelText("Command")).toHaveTextContent("/goal write tests");
expect(screen.queryByLabelText("You")).toBeNull();
```

Add: host `reasoning-delta` then `text-delta` → Think + markdown.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter dsh exec vitest run test/applyEdits.test.ts src/webview/media/App.test.tsx`

Expected: FAIL on view diffs and Command label.

- [ ] **Step 3: Implement**

`diffsFromEvent`: union meta/arguments diffs with `event.view?.for === "result" && event.view.view.card === "diff"` (`oldText ?? ""`).

README **Start chatting**: thinking disclosure, tool rows, command cards, Apply all for the current turn. No protocol internals.

- [ ] **Step 4: Run tests and typecheck**

Run:

```
pnpm --filter dsh exec vitest run src/webview/media test/applyEdits.test.ts src/webview/panel.test.ts
pnpm --filter dsh typecheck
pnpm --filter @dsh-vscode/bridge test
pnpm --filter @dsh-vscode/contract test
```

Expected: PASS.

- [ ] **Step 5: Commit-ready**

---

## Spec coverage

| Spec | Task |
| --- | --- |
| Optional `view`, v6, reject bad `for` | 1 |
| `toWire` pure; `viewFor` / history+live | 2 |
| Timeline model; thinking + assistant fold; replay | 3 |
| Tool lifecycle, generic fallback, diffs on row + `state.diffs` | 4 |
| Command card not user bubble; `command/done` | 5 |
| Think auto-collapse; tool/command expand; Apply all | 6 |
| Host DiffResultView; README; App slash assertion | 7 |
| Non-goals (no Web packages, no subagent tree, no protocol bump) | Global Constraints |

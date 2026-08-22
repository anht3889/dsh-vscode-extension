# DSH VS Code Chat Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship functional VS Code chat chrome (startup spinner, recent/new chat, permission, model, context meter, squircle composer) over protocol v2.

**Architecture:** Keep one `dsh --profile vscode` child per folder. Bump the shared NDJSON contract to v2. Replace the single retained agent with a session controller that lists/creates/resumes sessions and applies next-turn model and permission. The webview owns chrome and Full Access confirmation; the extension host owns the New Chat confirm dialog.

**Tech Stack:** TypeScript, vitest, React 18 webview, Cordis + published `@deepseek-ai/*` packages, VS Code WebviewView.

**Spec:** `docs/superpowers/specs/2026-08-22-dsh-vscode-chat-chrome-design.md`

## Global Constraints

- `PROTOCOL_VERSION = 2`.
- Workspace-scoped recent list: `header.cwd === process.cwd()`.
- Default permission preset: `workspace-write`.
- Full Access confirm is webview-only, once per `sessionId`.
- Model list: configured and currently usable only; include `contextWindow` when `resolveModelInfo` provides it.
- Context meter: next-request projected tokens ÷ model `contextWindow`; hide if window unknown.
- Settings button: present, disabled, tooltip `Coming soon`.
- Preserve existing uncommitted extension work; do not revert it.
- Prefer published `@deepseek-ai/*` packages in the bridge. Change `deepseek-harness` only if a required service cannot be mounted or called from published APIs.
- TDD: failing test → implement → pass → commit. Do not commit unrelated dirty files.

---

## File Structure

```
packages/contract/src/protocol.ts          # v2 unions + guards
packages/contract/src/protocol.test.ts
packages/bridge/src/runner.ts              # SessionController
packages/bridge/src/commands.ts
packages/bridge/src/index.ts               # inject extra services
packages/bridge/cordis.patch.yml           # persistence, sandbox, presets, token-meter
packages/bridge/package.json               # new deps
packages/bridge/test/boot.ts               # extra plugins for tests
packages/bridge/test/commands.test.ts
packages/bridge/test/retained-runner.test.ts  # extend / add session-controller.test.ts
packages/extension/src/webview/media/vscode.ts
packages/extension/src/webview/panel.ts
packages/extension/src/statusBar.ts
packages/extension/src/webview/media/store.ts
packages/extension/src/webview/media/store.test.ts
packages/extension/src/webview/media/App.tsx
packages/extension/src/webview/media/components/Header.tsx
packages/extension/src/webview/media/components/RecentPopover.tsx
packages/extension/src/webview/media/components/Composer.tsx
packages/extension/src/webview/media/style.css
packages/extension/README.md
```

---

### Task 1: Protocol v2 contract

**Files:**
- Modify: `packages/contract/src/protocol.ts`
- Modify: `packages/contract/src/protocol.test.ts`

**Interfaces:**
- Consumes: existing `HelloMessage`, `EventMessage`, `AskMessage`, `StatusMessage`, `SessionEventWire`
- Produces: `PROTOCOL_VERSION = 2`; new outbound/inbound types below; updated `isOutboundMessage` / `isInboundMessage`

- [ ] **Step 1: Write failing tests**

Append to `packages/contract/src/protocol.test.ts`:

```ts
import {
  PROTOCOL_VERSION,
  isOutboundMessage,
  isInboundMessage,
} from "./protocol.js";

it("PROTOCOL_VERSION is 2", () => {
  expect(PROTOCOL_VERSION).toBe(2);
});

it("accepts ready, sessions, catalog, permissions, context, history", () => {
  expect(isOutboundMessage({
    kind: "ready",
    sessionId: "s1",
    cwd: "/tmp",
    models: { current: { provider: "p", model: "m" }, models: [] },
    permissions: { current: "workspace-write", presets: [] },
  })).toBe(true);
  expect(isOutboundMessage({ kind: "sessions", items: [] })).toBe(true);
  expect(isOutboundMessage({
    kind: "catalog",
    current: { provider: "p", model: "m" },
    models: [],
  })).toBe(true);
  expect(isOutboundMessage({
    kind: "permissions",
    current: "workspace-write",
    presets: [{ id: "workspace-write", label: "Workspace Write" }],
  })).toBe(true);
  expect(isOutboundMessage({ kind: "context", used: 10, window: 100 })).toBe(true);
  expect(isOutboundMessage({ kind: "history", sessionId: "s1", events: [] })).toBe(true);
});

it("accepts listSessions, newSession, selectModel, selectPermission, resume", () => {
  expect(isInboundMessage({ kind: "listSessions" })).toBe(true);
  expect(isInboundMessage({ kind: "newSession" })).toBe(true);
  expect(isInboundMessage({ kind: "selectModel", provider: "p", model: "m" })).toBe(true);
  expect(isInboundMessage({ kind: "selectPermission", preset: "read-only" })).toBe(true);
  expect(isInboundMessage({ kind: "resume", sessionId: "s1" })).toBe(true);
  expect(isInboundMessage({ kind: "submit", text: "hi", permission: "workspace-write" })).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir packages/contract test`

Expected: FAIL (`PROTOCOL_VERSION` is 1; new kinds rejected).

- [ ] **Step 3: Implement types and guards**

Replace the unions in `packages/contract/src/protocol.ts` with:

```ts
export const PROTOCOL_VERSION = 2;

export interface ModelRef { provider: string; model: string }
export interface ModelListItem extends ModelRef {
  label: string;
  contextWindow?: number;
}
export interface SessionListItem {
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  cwd: string;
}
export interface PermissionPresetItem { id: string; label: string }
export interface CatalogPayload {
  current: ModelRef;
  models: ModelListItem[];
}
export interface PermissionsPayload {
  current: string;
  presets: PermissionPresetItem[];
}
export interface ContextPayload { used: number; window: number }

export interface HelloMessage {
  kind: "hello";
  version: number;
  dshVersion: string;
  cwd: string;
  model?: ModelRef;
}
export interface SessionMessage {
  kind: "session";
  sessionId: string;
  cwd?: string;
  createdAt: number;
}
export interface ReadyMessage {
  kind: "ready";
  sessionId: string;
  cwd: string;
  models: CatalogPayload;
  permissions: PermissionsPayload;
  context?: ContextPayload;
}
export interface SessionsMessage { kind: "sessions"; items: SessionListItem[] }
export interface CatalogMessage extends CatalogPayload { kind: "catalog" }
export interface PermissionsMessage extends PermissionsPayload { kind: "permissions" }
export interface ContextMessage extends ContextPayload { kind: "context" }
export interface HistoryMessage {
  kind: "history";
  sessionId: string;
  events: SessionEventWire[];
}
export interface EventMessage { kind: "event"; sessionId: string; event: SessionEventWire }
export interface AskMessage { kind: "ask"; askId: string; questions: AskQuestionWire[] }
export interface StatusMessage {
  kind: "status";
  state: "idle" | "thinking" | "awaiting-approval" | "error";
  detail?: string;
  code?: string;
}
export type OutboundMessage =
  | HelloMessage | SessionMessage | ReadyMessage | SessionsMessage
  | CatalogMessage | PermissionsMessage | ContextMessage | HistoryMessage
  | EventMessage | AskMessage | StatusMessage;

export interface SubmitCommand {
  kind: "submit";
  text: string;
  provider?: string;
  model?: string;
  permission?: string;
}
export interface AnswerCommand { kind: "answer"; askId: string; answered: AskAnswerWire }
export interface CancelCommand { kind: "cancel"; cause?: "user" }
export interface ResumeCommand { kind: "resume"; sessionId: string }
export interface ExitCommand { kind: "exit" }
export interface ListSessionsCommand { kind: "listSessions" }
export interface NewSessionCommand { kind: "newSession" }
export interface SelectModelCommand { kind: "selectModel"; provider: string; model: string }
export interface SelectPermissionCommand { kind: "selectPermission"; preset: string }
export type InboundMessage =
  | SubmitCommand | AnswerCommand | CancelCommand | ResumeCommand | ExitCommand
  | ListSessionsCommand | NewSessionCommand | SelectModelCommand | SelectPermissionCommand;

const OUTBOUND_KINDS = [
  "hello", "session", "ready", "sessions", "catalog", "permissions",
  "context", "history", "event", "ask", "status",
] as const;
const INBOUND_KINDS = [
  "submit", "answer", "cancel", "resume", "exit",
  "listSessions", "newSession", "selectModel", "selectPermission",
] as const;
```

Keep existing `kindOf` / `isOutboundMessage` / `isInboundMessage`. Import `SessionEventWire` from `./events.js`.

- [ ] **Step 4: Run tests**

Run: `pnpm --dir packages/contract test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contract/src/protocol.ts packages/contract/src/protocol.test.ts
git commit -m "feat(contract): protocol v2 session and composer messages"
```

---

### Task 2: SessionController command dispatch

**Files:**
- Modify: `packages/bridge/src/runner.ts` (export `SessionController`; keep `createRunner` returning it)
- Modify: `packages/bridge/src/commands.ts`
- Modify: `packages/bridge/test/commands.test.ts`

**Interfaces:**
- Consumes: Task 1 inbound kinds
- Produces: `SessionController` used by `apply()` and later runner work

```ts
export interface SubmitOptions {
  provider?: string;
  model?: string;
  permission?: string;
}
export interface SessionController {
  submit(text: string, opts?: SubmitOptions): void;
  cancel(): void;
  listSessions(): void;
  newSession(): void;
  resume(sessionId: string): void;
  selectModel(provider: string, model: string): void;
  selectPermission(preset: string): void;
}
```

Until Task 3, `createRunner` can still only implement `submit`/`cancel` and stub the rest as `() => { throw new Error("not implemented"); }` **only if tests in this task mock the controller** — do **not** change `createRunner` yet. This task only changes `commands.ts` + tests with a mock controller.

- [ ] **Step 1: Write failing dispatcher tests**

Replace the mock in `packages/bridge/test/commands.test.ts`:

```ts
function hooks() {
  return {
    runner: {
      submit: vi.fn(),
      cancel: vi.fn(),
      listSessions: vi.fn(),
      newSession: vi.fn(),
      resume: vi.fn(),
      selectModel: vi.fn(),
      selectPermission: vi.fn(),
    },
    provider: {
      ask: vi.fn(),
      resolve: vi.fn(),
    },
  };
}
```

Add cases:

```ts
it("maps listSessions / newSession / resume / selectModel / selectPermission", () => {
  const h = hooks();
  dispatchCommand(inertCtx, { kind: "listSessions" }, h);
  dispatchCommand(inertCtx, { kind: "newSession" }, h);
  dispatchCommand(inertCtx, { kind: "resume", sessionId: "s1" }, h);
  dispatchCommand(inertCtx, { kind: "selectModel", provider: "p", model: "m" }, h);
  dispatchCommand(inertCtx, { kind: "selectPermission", preset: "read-only" }, h);
  expect(h.runner.listSessions).toHaveBeenCalledOnce();
  expect(h.runner.newSession).toHaveBeenCalledOnce();
  expect(h.runner.resume).toHaveBeenCalledWith("s1");
  expect(h.runner.selectModel).toHaveBeenCalledWith("p", "m");
  expect(h.runner.selectPermission).toHaveBeenCalledWith("read-only");
});

it("forwards optional submit picker fields", () => {
  const h = hooks();
  dispatchCommand(inertCtx, {
    kind: "submit",
    text: "hi",
    provider: "p",
    model: "m",
    permission: "read-only",
  }, h);
  expect(h.runner.submit).toHaveBeenCalledWith("hi", {
    provider: "p",
    model: "m",
    permission: "read-only",
  });
});
```

Update the existing submit test to `submit("hi", {})` or `submit("hi", undefined)` matching the implementation (prefer `submit(text, opts)` always passing the rest object or `undefined` when no extras).

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --dir packages/bridge test -- commands.test.ts`

- [ ] **Step 3: Implement dispatch**

In `packages/bridge/src/commands.ts`:

- Change `CommandHooks.runner` type to `SessionController` (import from `./runner.js`).
- Temporarily add the extra methods as required on the interface in `runner.ts` **without** wiring `createRunner` yet: export the interface; keep `RetainedRunner` as a deprecated alias **or** expand `createRunner`'s return with stub methods that no-op (stubs will break later tests that expect no extra outbound). **Do not stub on the live runner in this task.**

Define `SessionController` in `runner.ts` now. Keep `export type RetainedRunner = Pick<SessionController, "submit" | "cancel">` so `createRunner` still typechecks until Task 3, and type `CommandHooks.runner` as `SessionController`. Tests pass a full mock.

```ts
export function dispatchCommand(ctx: Context, msg: InboundMessage, hooks: CommandHooks): void {
  switch (msg.kind) {
    case "submit":
      hooks.runner.submit(msg.text, {
        ...(msg.provider !== undefined ? { provider: msg.provider } : {}),
        ...(msg.model !== undefined ? { model: msg.model } : {}),
        ...(msg.permission !== undefined ? { permission: msg.permission } : {}),
      });
      return;
    case "cancel":
      hooks.runner.cancel();
      return;
    case "answer":
      hooks.provider.resolve(msg.askId, wireToAnswer(msg.answered));
      return;
    case "listSessions":
      hooks.runner.listSessions();
      return;
    case "newSession":
      hooks.runner.newSession();
      return;
    case "resume":
      hooks.runner.resume(msg.sessionId);
      return;
    case "selectModel":
      hooks.runner.selectModel(msg.provider, msg.model);
      return;
    case "selectPermission":
      hooks.runner.selectPermission(msg.preset);
      return;
    case "exit":
      return;
    default: {
      const _exhaustive: never = msg;
      void _exhaustive;
    }
  }
}
```

For submit with no extras, pass `{}` so the first test can use `toHaveBeenCalledWith("hi", {})`. Update the original submit assertion accordingly.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/commands.ts packages/bridge/src/runner.ts packages/bridge/test/commands.test.ts
git commit -m "feat(bridge): dispatch protocol v2 session commands"
```

---

### Task 3: Catalog, permission snapshot, context helpers + `ready`

**Files:**
- Modify: `packages/bridge/src/runner.ts`
- Modify: `packages/bridge/src/index.ts` (`inject` may stay optional via `ctx.get`)
- Modify: `packages/bridge/test/retained-runner.test.ts`
- Modify: `packages/bridge/test/boot.ts` if `ctx.llm` is required for catalog

**Interfaces:**
- Consumes: `ctx.llm`, `ctx.agentDefaultModel`, optional `ctx.permissionPresets`, optional `ctx.tokenMeter`
- Produces: `createRunner` emits `hello` then creates a session then emits `ready` (and `session`)

Helpers in `runner.ts`:

```ts
const PRESET_LABELS: Record<string, string> = {
  "read-only": "Read Only",
  "workspace-write": "Workspace Write",
  "danger-full-access": "Full Access",
};

async function buildCatalog(ctx: Context, current: ModelRef): Promise<CatalogPayload> {
  const llm = ctx.get("llm");
  const models: ModelListItem[] = [];
  if (llm !== undefined) {
    for (const provider of llm.listProviders()) {
      for (const info of llm.listModels(provider)) {
        try {
          const resolved = await llm.resolveModelInfo(provider, info.id);
          models.push({
            provider,
            model: info.id,
            label: info.name ?? info.id,
            ...(resolved.context?.contextWindow !== undefined
              ? { contextWindow: resolved.context.contextWindow }
              : {}),
          });
        } catch {
          // Unusable model (credentials/config): omit.
        }
      }
    }
  }
  if (!models.some((m) => m.provider === current.provider && m.model === current.model)) {
    models.unshift({
      provider: current.provider,
      model: current.model,
      label: current.model,
    });
  }
  return { current, models };
}

function buildPermissions(ctx: Context, session: Session): PermissionsPayload {
  const presetsSvc = ctx.get("permissionPresets");
  const presets = presetsSvc !== undefined
    ? presetsSvc.names.map((id: string) => ({
        id,
        label: PRESET_LABELS[id] ?? id,
      }))
    : [
        { id: "read-only", label: "Read Only" },
        { id: "workspace-write", label: "Workspace Write" },
        { id: "danger-full-access", label: "Full Access" },
      ];
  const current =
    presetsSvc !== undefined
      ? presetsSvc.current(session.events)
      : "workspace-write";
  return { current, presets };
}

function buildContext(ctx: Context, session: Session, window: number | undefined): ContextPayload | undefined {
  if (window === undefined || window <= 0) return undefined;
  const meter = ctx.get("tokenMeter");
  const used = meter !== undefined ? meter.measure(session).totalTokens : 0;
  return { used, window };
}
```

Inspect published `LlmModelInfo` (`id` vs `model`) and `permissionPresets.names` while implementing; match actual published types. If `names` is private, use the three shipped ids.

- [ ] **Step 1: Extend the hello test**

In `retained-runner.test.ts`, after `createRunner`:

```ts
const ready = messages.find((m) => m.kind === "ready");
expect(ready).toBeDefined();
if (ready?.kind === "ready") {
  expect(ready.sessionId).toEqual(expect.any(String));
  expect(ready.permissions.current).toBe("workspace-write");
  expect(ready.models.current.model).toBe("mock-model");
}
```

- [ ] **Step 2: Run test — expect FAIL** (no `ready`)

- [ ] **Step 3: Implement in `createRunner`**

After `hello`, keep `session/event` listener. Create the agent as today. Then:

```ts
const catalog = await buildCatalog(ctx, {
  provider: selection.provider,
  model: selection.model,
});
const permissions = buildPermissions(ctx, agent.session);
const window = catalog.models.find(
  (m) => m.provider === catalog.current.provider && m.model === catalog.current.model,
)?.contextWindow;
const context = buildContext(ctx, agent.session, window);
io.send({
  kind: "session",
  sessionId: agent.session.id,
  cwd: process.cwd(),
  createdAt: Date.now(),
});
io.send({
  kind: "ready",
  sessionId: agent.session.id,
  cwd: process.cwd(),
  models: catalog,
  permissions,
  ...(context !== undefined ? { context } : {}),
});
```

Hold `ModelSelectionRef` (`{ current: selection, assembled: undefined }`) in a `let selectionRef` so Task 5 can mutate it. Pass that same object to `installModelSelection`.

Return a `SessionController` with real `submit`/`cancel` and temporary no-ops for the rest **that do not throw** (so dispatch is safe). Task 4/5 replace the no-ops.

- [ ] **Step 4: Run `pnpm --dir packages/bridge test` — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bridge): emit ready catalog and permission snapshot"
```

---

### Task 4: listSessions, newSession, resume + history

**Files:**
- Modify: `packages/bridge/src/runner.ts`
- Test: `packages/bridge/test/session-controller.test.ts` (create)
- Modify: `packages/bridge/test/boot.ts` — optional JSONL persistence if resume must survive dispose

**Interfaces:**
- Consumes: `ctx.agents.create` / `resume`, `ctx.sessionPersistence?.list()`, `Session.events`, `toWire`
- Produces: working `listSessions`, `newSession`, `resume`

**Dispose rule:** `AgentHandle.dispose()` drops the **live** store entry. Always `sessions.flush(agent.session)` before dispose so JSONL remains. Do not call dispose without flush.

Title helper: last `session/title` event `data.title` if string; else first `user/message` text snippet (max 80 chars); else `sessionId`.

`updatedAt`: `max(header.createdAt, last user/message time)` when events are available; for persistence-only rows use `createdAt`.

- [ ] **Step 1: Write failing tests** in `session-controller.test.ts`

Use `bootTree` + mock LLM (`repeatLast: true`).

```ts
it("listSessions returns the live session for this cwd", async () => {
  const messages: OutboundMessage[] = [];
  const runner = await createRunner(await bootTree(opts), capture(messages));
  runner.listSessions();
  await waitFor(() => messages.some((m) => m.kind === "sessions"));
  const list = messages.find((m) => m.kind === "sessions");
  expect(list?.kind === "sessions" && list.items.length).toBeGreaterThanOrEqual(1);
  if (list?.kind === "sessions") {
    expect(list.items[0]?.cwd).toBe(process.cwd());
  }
});

it("newSession emits a different sessionId and history for the new id is empty", async () => {
  const messages: OutboundMessage[] = [];
  const runner = await createRunner(await bootTree(opts), capture(messages));
  const firstReady = messages.find((m) => m.kind === "ready");
  runner.newSession();
  await waitFor(() => messages.filter((m) => m.kind === "session").length >= 2);
  const sessions = messages.filter((m) => m.kind === "session");
  expect(sessions.at(-1)?.sessionId).not.toBe(
    firstReady && firstReady.kind === "ready" ? firstReady.sessionId : "",
  );
});

it("resume restores a flushed session and emits history", async () => {
  const messages: OutboundMessage[] = [];
  const runner = await createRunner(await bootTree(opts), capture(messages));
  const ready = messages.find((m) => m.kind === "ready");
  if (ready?.kind !== "ready") throw new Error("no ready");
  runner.submit("remember this");
  await waitFor(() => messages.some((m) => m.kind === "status" && m.state === "idle"));
  const oldId = ready.sessionId;
  runner.newSession();
  await waitFor(() => messages.filter((m) => m.kind === "session").length >= 2);
  runner.resume(oldId);
  await waitFor(() => messages.some((m) => m.kind === "history" && m.sessionId === oldId));
  const history = messages.find((m) => m.kind === "history" && m.sessionId === oldId);
  expect(history?.kind === "history" && history.events.length).toBeGreaterThan(0);
});

it("resume of a foreign cwd reports status error and keeps the current session", async () => {
  const messages: OutboundMessage[] = [];
  const runner = await createRunner(await bootTree(opts), capture(messages));
  const before = messages.find((m) => m.kind === "ready");
  runner.resume("missing-id");
  await waitFor(() => messages.some((m) => m.kind === "status" && m.state === "error"));
  const ready = messages.filter((m) => m.kind === "ready").at(-1);
  expect(ready && ready.kind === "ready" ? ready.sessionId : "").toBe(
    before && before.kind === "ready" ? before.sessionId : "",
  );
});
```

If JSONL is not mounted, resume-after-newSession may fail. Then add `@deepseek-ai/dsh-session-persistence-jsonl` to `bootTree` with `root: tmpdir`. If that package cannot be imported, stop and open a `deepseek-harness` change (out of this file's Task 4) rather than faking resume.

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement controller methods**

Keep one `let handle: AgentHandle` and `let selectionRef: ModelSelectionRef`.

`replaceLive(create: () => Promise<AgentHandle>)`:
1. `handle.agent.cancel({ kind: "user" })` (ignore if idle)
2. `await sessions.flush(handle.agent.session)`
3. `await handle.dispose()`
4. `handle = await create()`
5. re-`installModelSelection` on the new agent ctx via `setup`
6. emit `session`, `history` (`handle.agent.session.events.map(toWire)`), `ready` (or `catalog`+`permissions`+`context`)

`newSession`: `replaceLive(() => agents.create({ sessionId: SessionId(\`session-${randomUUID()}\`), meta: { cwd: process.cwd() }, agentOptions: { provider, model }, setup }))` then `permissionPresets?.set(session, "workspace-write")` if current is not that.

`resume(id)`: load persistence header if available; if `header.cwd` exists and `!== process.cwd()`, `io.send({ kind: "status", state: "error", detail: \`cannot resume ${id} (cwd mismatch)\` })` and return. Else `replaceLive(() => agents.resume({ resumeSessionId: SessionId(id), agentOptions, setup }))`. Catch load failures as `status:error` without calling `replaceLive` if resume throws before dispose — **order:** verify load/cwd **before** dispose. Implementation: `inspect`/`list` first; only then `replaceLive`.

`listSessions`: if `sessionPersistence`:

```ts
const headers = await persistence.list();
const items = headers
  .filter((h) => h.cwd === process.cwd())
  .map((h) => ({
    sessionId: String(h.id),
    title: /* live title if handle.agent.session.id === h.id else String(h.id) */,
    createdAt: h.createdAt,
    updatedAt: h.createdAt,
    cwd: h.cwd ?? process.cwd(),
  }))
  .sort((a, b) => b.updatedAt - a.updatedAt);
io.send({ kind: "sessions", items });
```

If no persistence, emit a one-item list from the live session (and still send `sessions`). Never send nothing.

All methods wrap in `void (async () => { ... })().catch(err => io.send({ kind: "status", state: "error", detail: String(err) }))`.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bridge): list, create, and resume vscode sessions"
```

---

### Task 5: selectModel, selectPermission, context after turns, submit opts

**Files:**
- Modify: `packages/bridge/src/runner.ts`
- Test: `packages/bridge/test/session-controller.test.ts`

**Interfaces:**
- Consumes: `ctx.llm.resolveCallConfig` / `resolveModelInfo`; `permissionPresets.set`; `selectionRef.current`; `buildContext`
- Produces: `catalog` / `permissions` / `context` outbound updates

- [ ] **Step 1: Failing tests**

```ts
it("selectModel updates catalog.current", async () => {
  const messages: OutboundMessage[] = [];
  const runner = await createRunner(await bootTree(opts), capture(messages));
  const ready = messages.find((m) => m.kind === "ready");
  if (ready?.kind !== "ready") throw new Error("no ready");
  const next = ready.models.models.find(
    (m) => m.model !== ready.models.current.model,
  );
  if (next === undefined) {
    runner.selectModel(ready.models.current.provider, ready.models.current.model);
  } else {
    runner.selectModel(next.provider, next.model);
  }
  await waitFor(() => messages.some((m) => m.kind === "catalog"));
  const catalog = messages.filter((m) => m.kind === "catalog").at(-1);
  expect(catalog?.kind === "catalog").toBe(true);
});

it("selectModel of an unknown model keeps current and errors", async () => {
  const messages: OutboundMessage[] = [];
  const runner = await createRunner(await bootTree(opts), capture(messages));
  const before = messages.find((m) => m.kind === "ready");
  runner.selectModel("no-such-provider", "no-such-model");
  await waitFor(() => messages.some((m) => m.kind === "status" && m.state === "error"));
  const catalog = messages.filter((m) => m.kind === "catalog").at(-1);
  expect(catalog).toBeUndefined();
  expect(before && before.kind === "ready" ? before.models.current.model : "").toBe("mock-model");
});

it("selectPermission appends permission/preset and emits permissions", async () => {
  const messages: OutboundMessage[] = [];
  const runner = await createRunner(await bootTree({ ...opts /* boot with permission plugin if possible */ }), capture(messages));
  runner.selectPermission("read-only");
  await waitFor(() =>
    messages.some(
      (m) =>
        (m.kind === "permissions" && m.current === "read-only") ||
        (m.kind === "event" && m.event.type === "permission/preset"),
    ),
  );
});

it("emits context after a turn when contextWindow is known", async () => {
  const messages: OutboundMessage[] = [];
  const runner = await createRunner(await bootTree(opts), capture(messages));
  runner.submit("hi");
  await waitFor(() => messages.some((m) => m.kind === "status" && m.state === "idle"));
  // If window unknown, this test asserts no crash and skips meter:
  const ctxMsg = messages.filter((m) => m.kind === "context").at(-1);
  if (ctxMsg?.kind === "context") {
    expect(ctxMsg.window).toBeGreaterThan(0);
    expect(ctxMsg.used).toBeGreaterThanOrEqual(0);
  }
});
```

If `permissionPresets` cannot be mounted in `bootTree`, the permission test should still call `selectPermission` and expect `status:error` with a clear detail (`permission presets are not mounted`) — that is acceptable until Task 6. Prefer mounting the real plugin.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

`selectModel`:
```ts
const llm = ctx.get("llm");
if (llm === undefined) {
  io.send({ kind: "status", state: "error", detail: "llm is not mounted" });
  return;
}
try {
  const resolved = await llm.resolveCallConfig({ provider, model });
  selectionRef.current = { provider: resolved.provider, model: resolved.model };
  const catalog = await buildCatalog(ctx, selectionRef.current);
  io.send({ kind: "catalog", ...catalog });
  emitContext();
} catch (error) {
  io.send({
    kind: "status",
    state: "error",
    detail: error instanceof Error ? error.message : String(error),
  });
}
```

`selectPermission`:
```ts
const svc = ctx.get("permissionPresets");
if (svc === undefined) {
  io.send({ kind: "status", state: "error", detail: "permission presets are not mounted" });
  return;
}
try {
  svc.set(handle.agent.session, preset);
  io.send({ kind: "permissions", ...buildPermissions(ctx, handle.agent.session) });
} catch (error) {
  io.send({
    kind: "status",
    state: "error",
    detail: error instanceof Error ? error.message : String(error),
  });
  io.send({ kind: "permissions", ...buildPermissions(ctx, handle.agent.session) });
}
```

`submit(text, opts)`: if `opts.permission` set, `selectPermission` first (sync set). If `opts.provider` and `opts.model` set, await `selectModel` then `followup` (chain on `tail`). Then existing followup/flush/idle. After idle, `emitContext()` then `status:idle`.

`emitContext`:
```ts
const window = /* from current catalog model */;
const payload = buildContext(ctx, handle.agent.session, window);
if (payload) io.send({ kind: "context", ...payload });
```

Also emit context on `session/event` when `event.type === "request/context"` (debounce by sending from that listener).

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bridge): next-turn model, permission, and context meter"
```

---

### Task 6: vscode profile mounts (bridge patch)

**Files:**
- Modify: `packages/bridge/cordis.patch.yml`
- Modify: `packages/bridge/package.json`
- Modify: `packages/bridge/src/index.ts` (`inject` stays unchanged; use `ctx.get` for optional services — do not add required injects that `bootTree` unit tests lack)
- Modify: `packages/extension/README.md` (profile now needs persistence root)

**Interfaces:**
- Produces: real `dsh --profile vscode` process has persistence, 3 permission presets, sandbox policy, token-meter

- [ ] **Step 1: Probe published packages**

Run:

```bash
node --input-type=module -e "Promise.all([
  import('@deepseek-ai/dsh-session-persistence-jsonl'),
  import('@deepseek-ai/dsh-permission-presets'),
  import('@deepseek-ai/dsh-sandbox-policy'),
  import('@deepseek-ai/dsh-token-meter'),
  import('@deepseek-ai/dsh-user-approval'),
]).then(() => console.log('ok'), (e) => { console.error(e); process.exit(1); })"
```

from `packages/bridge` after adding the deps. If import fails, add the packages to `package.json` and `pnpm install`. If they do not exist on npm at the current rc, **stop and implement a harness PR** that publishes/exports them; do not invent a local mock preset table for production.

- [ ] **Step 2: Extend `cordis.patch.yml` insert list** (after vscode-runner services exist in the tree; order like base bundle):

```yml
    - id: session-persistence
      name: '@deepseek-ai/dsh-session-persistence-jsonl'
      config:
        root: !!js process.env.DSH_SESSION_ROOT ?? require('node:path').join(require('node:os').homedir(), '.dsh', 'sessions')
      # If !!js require is forbidden in this profile, use a documented env-only root:
      # root: !!js process.env.DSH_SESSION_ROOT

    - id: sandbox-policy
      name: '@deepseek-ai/dsh-sandbox-policy'
      config:
        mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'
        workspaceRoot: !!js process.cwd()

    - id: approval
      name: '@deepseek-ai/dsh-user-approval'
      config:
        policy: 'ask'

    - id: permission
      name: '@deepseek-ai/dsh-permission-presets'
      config:
        presets:
          read-only:
            sandbox: read-only
            approval: ask
          workspace-write:
            sandbox: workspace-write
            approval: ask
          danger-full-access:
            sandbox: danger-full-access
            approval: never
        defaultPreset: workspace-write

    - id: token-meter
      name: '@deepseek-ai/dsh-token-meter'
```

Copy exact `!!js` style from `deepseek-harness/packages/bundle/base/cordis.patch.yml`. If `require` is invalid in DSH yaml, set `root` from `process.env.DSH_SESSION_ROOT` and document that the extension host sets `DSH_SESSION_ROOT` when spawning (implement that env in Task 7).

- [ ] **Step 3: Add dependencies to `packages/bridge/package.json` at the same rc as existing `@deepseek-ai/dsh-*` pins.**

- [ ] **Step 4: `pnpm --dir packages/bridge test` still PASS** (unit boot tree does not load the yml).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bridge): mount persistence, permission presets, and token meter"
```

---

### Task 7: Extension host — starting, confirm New Chat, forward v2

**Files:**
- Modify: `packages/extension/src/webview/media/vscode.ts`
- Modify: `packages/extension/src/webview/panel.ts`
- Modify: `packages/extension/src/statusBar.ts`
- Modify: `packages/extension/src/statusBar.test.ts`
- Modify: `packages/extension/src/processManager.ts` only if setting `DSH_SESSION_ROOT` on spawn `env`

**Interfaces:**
- Consumes: `InboundMessage` v2; host-only `{ kind: "apply" | "confirmNewChat" }`
- Produces: webview receives `ready`/`sessions`/`history`/…; native confirm for New Chat

- [ ] **Step 1: Failing statusBar tests**

`nextStatus` currently uses `switch (msg.kind)` and will fail typecheck once new kinds exist. Add:

```ts
it("ignores ready/catalog/sessions for status transitions", () => {
  const prev = nextStatus("idle", { kind: "hello", version: 2, dshVersion: "x", cwd: "/" });
  const next = nextStatus(prev.state, {
    kind: "ready",
    sessionId: "s",
    cwd: "/",
    models: { current: { provider: "p", model: "m" }, models: [] },
    permissions: { current: "workspace-write", presets: [] },
  });
  expect(next.state).toBe("idle");
});
```

- [ ] **Step 2: Run `pnpm --dir packages/extension test -- statusBar.test.ts` — typecheck/fail**

- [ ] **Step 3: Implementation**

`vscode.ts`:

```ts
export type UiCommandCmd =
  | InboundMessage
  | { kind: "apply" }
  | { kind: "confirmNewChat" };
```

`panel.ts` `onUiCommand`:

```ts
if (cmd.kind === "apply") {
  void this.applyPending();
  return;
}
if (cmd.kind === "confirmNewChat") {
  void this.confirmNewChat();
  return;
}
```

```ts
private async confirmNewChat(): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    "Cancel the current turn and start a new chat?",
    { modal: true },
    "Start new chat",
  );
  if (choice !== "Start new chat") return;
  if (!this.running) return;
  this.running.client.send({ kind: "cancel", cause: "user" });
  this.running.client.send({ kind: "newSession" });
}
```

`startActiveFolder`: before `pm.start`, post `{ kind: "status", state: "thinking", detail: "Starting…" }` so the spinner can show. After successful start, `ready` from the bridge clears starting in the store (Task 8).

`handleOutbound`: stop swallowing everything except hello. Keep `hello` host-only (version check + `updateStatus`). Forward `ready`, `session`, `sessions`, `catalog`, `permissions`, `context`, `history`, `event`, `ask`, `status`.

Spawn env (if Task 6 needs it):

```ts
env: {
  ...process.env,
  DSH_SESSION_ROOT:
    process.env.DSH_SESSION_ROOT ?? join(homedir(), ".dsh", "sessions"),
}
```

in `ProcessManager.start`. Update `processManager.test.ts` only if it asserts `env`.

`statusBar.ts` `nextStatus` default branch: new kinds return `{ state: prev, text: descriptionFor(prev) }`. Keep the switch exhaustive with `default` for v2 kinds that are not status/ask/event.

- [ ] **Step 4: Tests PASS; `pnpm --dir packages/extension typecheck`**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(extension): confirm new chat and forward protocol v2"
```

---

### Task 8: Webview store

**Files:**
- Modify: `packages/extension/src/webview/media/store.ts`
- Modify: `packages/extension/src/webview/media/store.test.ts`

**Interfaces:**
- Consumes: all outbound v2 kinds
- Produces: `UiState` for App

```ts
export interface UiState {
  stream: string[];
  approval: ApprovalState | undefined;
  diffs: ToolDiff[];
  error: string | undefined;
  starting: boolean;
  ready: boolean;
  status: "idle" | "thinking" | "awaiting-approval" | "error";
  sessionId: string | undefined;
  sessions: SessionListItem[];
  sessionsUnavailable: boolean;
  models: CatalogPayload | undefined;
  permissions: PermissionsPayload | undefined;
  context: ContextPayload | undefined;
  fullAccessConfirmedFor: string | undefined;
}
```

Initial: `starting: true`, `ready: false`, `status: "idle"`, empty sessions.

Reduce:

- `ready` → set catalogs, `sessionId`, `starting: false`, `ready: true`, `error: undefined`
- `sessions` → `sessions: msg.items`, `sessionsUnavailable: false`
- `catalog` / `permissions` / `context` → replace those fields; on `permissions` if `current !== danger-full-access` keep `fullAccessConfirmedFor`
- `history` → rebuild `stream` from assistant text in `msg.events` (reuse `assistantText`); `diffs: []`; `approval: undefined`
- `session` → `sessionId`; clear `stream`, `diffs`, `approval` when `sessionId` changes
- `status` thinking → `status: thinking` (starting stays true until `ready`)
- `status` error → `error`, `starting: false`, `status: error`
- `status` idle → `error: undefined`, `status: idle`
- existing `ask` / `event` behavior; do **not** clear stream on `turn/start` if that wipes history mid-resume. Spec previously cleared per-turn diffs: keep clearing **diffs** on `turn/start`, but **append** stream across turns in one session (today it clears stream on turn/start — **change:** only clear stream on `session` change and `history`). This is required to show a multi-turn chat. Update the existing store test `resets stream and diffs on turn/start` to: diffs reset, stream **preserved**.

Pure helpers (export for UI tests):

```ts
export function filterSessions(items: SessionListItem[], query: string): SessionListItem[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return items;
  return items.filter((i) => i.title.toLowerCase().includes(q));
}

export function contextPercent(ctx: ContextPayload | undefined): number | undefined {
  if (ctx === undefined || ctx.window <= 0) return undefined;
  return Math.min(100, Math.round((100 * ctx.used) / ctx.window));
}
```

- [ ] **Step 1: Rewrite/extend `store.test.ts`** with cases: starting true initially; ready clears starting; history replaces stream; session id change clears stream; filterSessions; contextPercent 0, 50, 100 cap; turn/start preserves stream; status error clears starting.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `reduce`**

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(extension): fold protocol v2 into webview state"
```

---

### Task 9: Header + Recent popover

**Files:**
- Create: `packages/extension/src/webview/media/components/Header.tsx`
- Create: `packages/extension/src/webview/media/components/RecentPopover.tsx`
- Modify: `packages/extension/src/webview/media/style.css`
- Modify: `packages/extension/src/webview/media/App.tsx` (partial)

**Interfaces:**
- Consumes: `starting`, `status`, `sessions`, `sessionsUnavailable`, `onListSessions`, `onResume`, `onNewChat`, `busy: boolean`
- Produces: header chrome

Codicons via classes (VS Code webview has codicon font if we use unicode/SVG). **Do not depend on the workbench font.** Inline SVGs:

- Recent: clock/counterclockwise arrow
- Settings: gear
- New: plus
- Spinner: CSS `border` circle `animation: dsh-spin 0.8s linear infinite`

`Header.tsx`:

```tsx
export function Header(props: {
  starting: boolean;
  thinking: boolean;
  onRecent(): void;
  recentOpen: boolean;
  onSettings(): void;
  onNewChat(): void;
  children?: React.ReactNode;
}): JSX.Element
```

Title text exactly `DSH: Chat`. Spinner if `starting || thinking`. Settings `disabled` `title="Coming soon"`.

`RecentPopover.tsx`: search input, list `className="dsh-recent-list"` with CSS `max-height: calc(5 * 28px)`, `overflow-y: auto`. Click-outside: `useEffect` on `pointerdown` for `!root.contains(event.target)`. Escape closes. Empty states: `sessionsUnavailable` → `Session history unavailable`; else `No recent chats`.

App: opening Recent calls `post({ kind: "listSessions" })`.

- [ ] **Step 1: No component unit tests** (match existing Task 8 panel treatment). Add **store** coverage already done. Manually typecheck.

- [ ] **Step 2: Implement components + CSS** (`.dsh-header`, `.dsh-spin`, `.dsh-icon-btn`, `.dsh-recent`, `.dsh-recent-list`)

- [ ] **Step 3: `pnpm --dir packages/extension typecheck`**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(extension): add chat header and recent session popover"
```

---

### Task 10: Squircle composer + toolbar

**Files:**
- Modify: `packages/extension/src/webview/media/components/Composer.tsx`
- Modify: `packages/extension/src/webview/media/style.css`

**Interfaces:**
- Consumes: `ready`, catalogs, `context`, `sessionId`, `fullAccessConfirmedFor`, callbacks

```tsx
export function Composer(props: {
  ready: boolean;
  models: CatalogPayload | undefined;
  permissions: PermissionsPayload | undefined;
  context: ContextPayload | undefined;
  sessionId: string | undefined;
  fullAccessConfirmedFor: string | undefined;
  onSubmit(text: string, opts: SubmitOptions): void;
  onSelectModel(provider: string, model: string): void;
  onSelectPermission(preset: string): void;
  onConfirmFullAccess(): void;
}): JSX.Element
```

Permission `<select>` values are preset ids; labels from payload. Model `<select>` value `${provider}::${model}`.

On permission change to `danger-full-access`: if `fullAccessConfirmedFor !== sessionId`, `window.confirm("Full Access disables sandbox confinement and approval prompts for this chat. Continue?")`; if false, revert select; if true, `onConfirmFullAccess()` then `onSelectPermission`.

Context: if `contextPercent` is `undefined`, render nothing. Else 16px SVG circle, `stroke-dasharray` from percent, `title={`${used} / ${window}`}`.

Send: square icon button (arrow), `disabled` when `!ready || text.trim() === ""`.

CSS: `.dsh-composer { border: 1px solid var(--dsh-border); border-radius: 16px; flex-direction: column; padding: 8px; margin: 8px 10px 10px; }` `.dsh-composer-toolbar { display: flex; justify-content: space-between; align-items: center; }` Remove old side-by-side Send text button.

- [ ] **Step 1: Implement Composer + CSS**

- [ ] **Step 2: typecheck**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(extension): squircle composer with permission, model, and send"
```

---

### Task 11: App wiring, Full Access once, README

**Files:**
- Modify: `packages/extension/src/webview/media/App.tsx`
- Modify: `packages/extension/src/webview/media/store.ts` (`confirmFullAccess` via a small UI action — keep protocol reduce pure)

Do **not** mix UI-only actions into `OutboundMessage`. In `App.tsx`:

```ts
const [fullAccessConfirmedFor, setFullAccessConfirmedFor] = useState<string | undefined>();
```

Reset `fullAccessConfirmedFor` when `state.sessionId` changes (`useEffect`).

```tsx
<Header
  starting={state.starting}
  thinking={state.status === "thinking" || state.starting}
  recentOpen={recentOpen}
  onRecent={() => { setRecentOpen((o) => !o); if (!recentOpen) post({ kind: "listSessions" }); }}
  onSettings={() => {}}
  onNewChat={() => {
    if (state.status === "thinking" || state.status === "awaiting-approval") {
      post({ kind: "confirmNewChat" });
    } else {
      post({ kind: "newSession" });
    }
  }}
>
  {recentOpen ? (
    <RecentPopover
      items={state.sessions}
      unavailable={state.sessionsUnavailable}
      onClose={() => setRecentOpen(false)}
      onPick={(id) => { post({ kind: "resume", sessionId: id }); setRecentOpen(false); }}
    />
  ) : null}
</Header>
<StreamView ... />
...
<Composer
  ready={state.ready}
  ...
  onSubmit={(text, opts) => post({ kind: "submit", text, ...opts })}
  onSelectModel={(provider, model) => post({ kind: "selectModel", provider, model })}
  onSelectPermission={(preset) => post({ kind: "selectPermission", preset })}
  onConfirmFullAccess={() => setFullAccessConfirmedFor(state.sessionId)}
/>
```

`post` currently types `UiCommand["cmd"]` — after Task 7 this includes `confirmNewChat` and v2 inbound.

README: document Recent, New chat, permission, model, context meter, `dsh.binaryPath`, `DSH_SESSION_ROOT`.

- [ ] **Step 1: Wire App**

- [ ] **Step 2: `pnpm --dir packages/extension typecheck` and `pnpm --dir packages/extension test`**

- [ ] **Step 3: `pnpm --dir packages/extension build`**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(extension): wire chat chrome to protocol v2"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| Protocol v2 kinds | 1 |
| Dispatch | 2 |
| `ready` catalogs | 3 |
| list/new/resume/history | 4 |
| model/permission/context/submit opts | 5 |
| vscode profile mounts | 6 |
| Host confirm + forward | 7 |
| Store + meter percent + starting | 8 |
| Header spinner + Recent + Settings stub | 9 |
| Squircle composer | 10 |
| App + Full Access once + README | 11 |
| Foreign cwd resume error | 4 |
| Hide meter if no window | 5, 8, 10 |
| Default workspace-write | 3, 4 |
| Do not use Host HTTP | all |

## Notes for the implementer

- `createRunner` tests must dispose Cordis trees if they leak (`ctx.parallel` / `ctx.stop` — follow existing tests; they currently do not dispose; do not expand that leak).
- If `AgentHandle.dispose` is observed to delete JSONL, stop and switch to keeping the previous agent unpublished another way; do not silently lose history.
- Do not implement a Settings panel.

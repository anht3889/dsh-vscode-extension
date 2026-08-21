# DSH VS Code Control Plane — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that spawns/manages the DeepSeek Harness (`dsh`) as a background agent, streams its session events into a custom webview UI with inline diffs and an approval gate, and applies agent edits into the editor.

**Architecture:** A pnpm monorepo with three workspaces — `contract` (shared ndjson protocol types), `bridge` (a new Cordis plugin that boots over `dsh-base` and bridges `session/event` + `ctx.userQuestions` to stdio), and `extension` (the VS Code side: process manager, protocol codec, React webview, editor integration). The extension spawns `dsh --profile vscode` as a child process and speaks a versioned ndjson protocol over its stdin/stdout.

**Tech Stack:** TypeScript, Node.js ≥ 20, pnpm workspaces, cordis / `@deepseek-ai/*` published packages (bridge), VS Code Extension API + React + esbuild + Webview UI Toolkit (extension), vitest (tests), `dsh-llm-mock-server` (bridge integration tests).

**Spec:** `docs/superpowers/specs/2026-08-21-dsh-vscode-control-plane-design.md`

## Global Constraints

- Node.js ≥ 20 (DSH requires a modern runtime; VS Code Extension Host ships on Node 20+ for current VS Code releases).
- TypeScript `strict: true` in every workspace; no `any` leaking across the `contract` package boundary.
- Protocol wire format is **ndjson** — one JSON object per `\n`-terminated line, UTF-8, `kind` is a required string discriminant on every message in both directions.
- All bridge code depends only on **published** `@deepseek-ai/*` packages (currently `0.1.0-rc.7`/`-rc.8`); no monorepo-internal imports. This is the Phase 0 gate.
- Package scopes we control: bridge = `@dsh-vscode/bridge`, extension = `@dsh-vscode/extension`, contract = `@dsh-vscode/contract` (not `@deepseek-ai/*`, which we do not own).
- Every task ends in a git commit; TDD: failing test → pass → commit.
- Protocol version is `1` for this plan (`PROTOCOL_VERSION = 1` constant in `contract`).

---

## File Structure

```
dsh-vscode-extension/
├── package.json                       # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore
├── packages/
│   ├── contract/                      # shared protocol types (single source of truth)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               # re-exports
│   │       ├── protocol.ts            # PROTOCOL_VERSION, OutboundMessage, InboundMessage unions + guards
│   │       └── events.ts              # SessionEvent re-type (codec-safe subset) + tool diff extraction types
│   ├── bridge/                        # @dsh-vscode/bridge — the stdio bridge plugin
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── cordis.patch.yml
│   │   └── src/
│   │       ├── index.ts               # Cordis plugin entry: apply(), Config, inject
│   │       ├── io.ts                  # ndjson framer for stdout + stdin reader
│   │       ├── runner.ts              # create agent, subscribe session/event, drive lifecyle
│   │       ├── user-questions.ts      # UserQuestionProvider over stdio
│   │       └── commands.ts            # stdin command dispatch: submit/answer/cancel/resume/exit
│   └── extension/                     # @dsh-vscode/extension
│       ├── package.json
│       ├── tsconfig.json
│       ├── esbuild.mjs
│       ├── src/
│       │   ├── extension.ts           # activate(): register views, status bar, commands
│       │   ├── processManager.ts      # spawn/kill/restart dsh, session-per-folder
│       │   ├── protocolClient.ts      # codec + framed read/write + command send + typed emitter
│       │   ├── statusBar.ts           # DSH status item state machine
│       │   ├── sessionTree.ts         # TreeDataProvider for sessions (running/previous)
│       │   ├── applyEdits.ts          # WorkspaceEdit from tool/result diffs
│       │   ├── decorations.ts         # gutter decorations for touched files
│       │   └── webview/
│       │       ├── panel.ts           # WebviewViewProvider: HTML + message bridge
│       │       ├── media/main.tsx     # React entry
│       │       ├── media/App.tsx      # app shell
│       │       ├── media/components/Composer.tsx
│       │       ├── media/components/StreamView.tsx
│       │       ├── media/components/ToolCard.tsx
│       │       ├── media/components/DiffView.tsx
│       │       └── media/components/ApprovalBanner.tsx
│       └── test/
│           ├── fakeDsh.ts             # node script speaking the protocol (test double)
│           ├── protocolClient.test.ts
│           ├── processManager.test.ts
│           └── applyEdits.test.ts
```

---

## Phase 0 — Spike: prove the published-package gate (blocking)

### Task 0: Verify the bridge can boot over `dsh-base` using published packages only

**Files:**
- Create: `packages/bridge/src/spike.ts` (throwaway, deleted at end of task)
- Create: `packages/bridge/package.json` (minimal, deps pinned to published versions)

**Interfaces:**
- Consumes: published `@deepseek-ai/cordis`, `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-llm-mock-server` (dev).
- Produces: a YES/NO verdict recorded in this plan's §R1 resolution, plus a working boot recipe (the code pattern — loader start → `ctx.get("agents")` → create agent → subscribe `session/event`) that Phase 1 copies.

- [ ] **Step 1: Scaffold a minimal workspace + pin published deps**

Create `packages/bridge/package.json`:

```json
{
  "name": "@dsh-vscode/bridge",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-base": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-agent": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-session": "^0.1.0-rc.7",
    "@deepseek-ai/dsh-headless": "^0.1.0-rc.8"
  },
  "devDependencies": {
    "@deepseek-ai/dsh-llm-mock-server": "^0.1.0-rc.7",
    "typescript": "^5"
  }
}
```

Run `pnpm install` at the workspace root (root `package.json` + `pnpm-workspace.yaml` created as part of Task 1; for the spike, install inside `packages/bridge` with `pnpm install --dir packages/bridge`).

- [ ] **Step 2: Write a minimal boot probe**

Create `packages/bridge/src/spike.ts` that imports the loader + base and logs whether it can boot and reach `agents`:

```ts
import { Context, Loader } from "@deepseek-ai/cordis";
// spike: print the composed service keys and whether 'agents' is reachable
async function main() {
  const ctx = new Context();
  // NOTE: exact loader invocation copied from dsh-headless's profile-boot path;
  // this step's pass condition is only "published packages resolve + types compile",
  // not a full boot — full boot is Task 1.
  console.log("loaded");
}
main();
```

Compile with `tsc --noEmit` against a `tsconfig.json` that sets `"moduleResolution": "bundler"`.

- [ ] **Step 3: Run the compile + import probe**

Run: `pnpm --dir packages/bridge exec tsc --noEmit`
Run: `node --input-type=module -e "import('@deepseek-ai/dsh-session').then(m => console.log('ok', !!m.SessionId))"`

Expected: compile succeeds with **no errors** about missing exports for `dsh-session`, `dsh-agent`, `cordis`; import succeeds.

- [ ] **Step 4: Record the verdict and delete the spike**

If compile+import succeeds → **R1 = RESOLVED (published packages suffice)**; delete `spike.ts`.
If it fails on a missing internal export → **R1 = BLOCKED**; stop and report that Phase 0 requires developing inside the DSH checkout (revise this plan before Phase 1).

Run: `git rm packages/bridge/src/spike.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/package.json tsconfig.base.json
git commit -m "chore: scaffold bridge package and verify published @deepseek-ai packages resolve (Phase 0)"
```

---

## Phase 1 — Protocol + bridge plugin

### Task 1: Monorepo root + `contract` package (protocol types)

**Files:**
- Create: `package.json` (root), `pnpm-workspace.yaml`, `.gitignore`, `tsconfig.base.json`
- Create: `packages/contract/package.json`, `packages/contract/tsconfig.json`
- Create: `packages/contract/src/protocol.ts`, `packages/contract/src/events.ts`, `packages/contract/src/index.ts`
- Test: `packages/contract/src/protocol.test.ts`

**Interfaces:**
- Consumes: nothing (leaf package).
- Produces: `PROTOCOL_VERSION`, `OutboundMessage`, `InboundMessage`, `SessionEventWire`, `isOutboundMessage`, `isInboundMessage`, `ToolDiff` (all exported from `@dsh-vscode/contract`).

- [ ] **Step 1: Write `pnpm-workspace.yaml` + root `package.json`**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

root `package.json`:
```json
{
  "name": "dsh-vscode-extension",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "resolveJsonModule": true,
    "skipLibCheck": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
out/
*.vsix
```

- [ ] **Step 2: Write the failing test for `protocol.ts`**

`packages/contract/src/protocol.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { PROTOCOL_VERSION, isOutboundMessage, isInboundMessage } from "./protocol.js";

describe("isOutboundMessage", () => {
  it("accepts a hello message", () => {
    expect(isOutboundMessage({ kind: "hello", version: PROTOCOL_VERSION, cwd: "/tmp", dshVersion: "0.1.0" })).toBe(true);
  });
  it("rejects an inbound message", () => {
    expect(isOutboundMessage({ kind: "submit", text: "hi" })).toBe(false);
  });
});

describe("isInboundMessage", () => {
  it("accepts a submit message", () => {
    expect(isInboundMessage({ kind: "submit", text: "hi" })).toBe(true);
  });
  it("rejects garbage", () => {
    expect(isInboundMessage({ kind: "nope" })).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --dir packages/contract test`
Expected: FAIL — `./protocol.js` not found.

- [ ] **Step 4: Implement `protocol.ts` (the wire contract)**

Define the exact message unions. Wire-safe, no `@deepseek-ai/*` imports (contract must stay dependency-free so the webview and bridge can both consume it):

```ts
export const PROTOCOL_VERSION = 1;

// ---- Outbound (bridge -> extension) ----
export interface HelloMessage         { kind: "hello";    version: number; dshVersion: string; cwd: string; model?: { provider: string; model: string } }
export interface SessionMessage       { kind: "session";  sessionId: string; cwd?: string; createdAt: number }
export interface EventMessage        { kind: "event";     sessionId: string; event: SessionEventWire }
export interface AskMessage          { kind: "ask";       askId: string; questions: AskQuestionWire[] }
export interface StatusMessage       { kind: "status";    state: "idle" | "thinking" | "awaiting-approval" | "error"; detail?: string; code?: string }
export type OutboundMessage = HelloMessage | SessionMessage | EventMessage | AskMessage | StatusMessage;

// ---- Inbound (extension -> bridge) ----
export interface SubmitCommand  { kind: "submit";  text: string }
export interface AnswerCommand  { kind: "answer";  askId: string; answered: AskAnswerWire }
export interface CancelCommand  { kind: "cancel";  cause?: "user" }
export interface ResumeCommand  { kind: "resume";  sessionId: string }
export interface ExitCommand    { kind: "exit" }
export type InboundMessage = SubmitCommand | AnswerCommand | CancelCommand | ExitCommand | ResumeCommand;

// ---- question/answer wire types (mirror dsh-user-questions types, dependency-free) ----
export interface AskQuestionWire { id: string; question: string; detail?: string; header?: string; options?: { label: string; description?: string }[]; multiSelect?: boolean }
export interface AskAnswerWire { answers: { id: string; selected: string[]; custom?: string }[] }

export function isOutboundMessage(m: unknown): m is OutboundMessage {
  return typeof m === "object" && m !== null &&
    (m as any).kind === "hello" || (m as any).kind === "session" || (m as any).kind === "event" || (m as any).kind === "ask" || (m as any).kind === "status";
}
export function isInboundMessage(m: unknown): m is InboundMessage {
  return typeof m === "object" && m !== null &&
    ["submit","answer","cancel","resume","exit"].includes((m as any).kind);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --dir packages/contract test`
Expected: PASS.

- [ ] **Step 6: Implement `events.ts` (codec-safe session-event + diff types)**

`packages/contract/src/events.ts`:
```ts
// A dependency-free structural subset of dsh-session's SessionEvent, sufficient
// for rendering. The bridge re-serializes the real typed event into this shape;
// unknown/extra fields are passed through `raw` verbatim so the webview's detail
// view never loses data.
export type SessionEventWire = {
  type: string;
  seq: number;
  time: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any> & { raw?: Record<string, unknown> };
};

// A tool/result's extracted, render-ready diff (from dsh-tool-fs meta / str-replace-editor).
export interface ToolDiff {
  path: string;
  oldText: string;
  newText: string;
}
```

Update `src/index.ts`:
```ts
export * from "./protocol.js";
export * from "./events.js";
```

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore packages/contract
git commit -m "feat(contract): protocol types + wire-safe event subset"
```

### Task 2: Bridge — ndjson framer + stdin reader (`io.ts`)

**Files:**
- Create: `packages/bridge/src/io.ts`
- Create: `packages/bridge/src/io.test.ts`

**Interfaces:**
- Consumes: `@dsh-vscode/contract` types.
- Produces: `createStdio(io): { send(msg: OutboundMessage): void; onCommand(cb: (msg: InboundMessage) => void): void; close(): void }` and `FrameCodec` (encode/decode) for unit testing.

- [ ] **Step 1: Write the failing test**

`packages/bridge/src/io.test.ts` using vitest, testing `FrameCodec` encode round-trip + a malformed-line skip:

```ts
import { describe, it, expect } from "vitest";
import { FrameCodec } from "./io.js";

describe("FrameCodec", () => {
  it("encodes one message per line and decodes it back", () => {
    const codec = new FrameCodec();
    const msg = { kind: "status", state: "idle" } as const;
    const line = codec.encode(msg);
    expect(line.endsWith("\n")).toBe(true);
    expect(codec.decode(line)).toEqual(msg);
  });
  it("returns null for malformed lines instead of throwing", () => {
    const codec = new FrameCodec();
    expect(codec.decode("{ not json")).toBeNull();
    expect(codec.decode("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir packages/bridge test`
Expected: FAIL — `./io.js` not found.

- [ ] **Step 3: Implement `io.ts`**

```ts
import type { InboundMessage, OutboundMessage } from "@dsh-vscode/contract";
import { isInboundMessage } from "@dsh-vscode/contract";

export class FrameCodec {
  encode(msg: unknown): string { return JSON.stringify(msg) + "\n"; }
  decode(line: string): unknown | null {
    const s = line.trim();
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  }
}

export interface Io { send(msg: OutboundMessage): void; onCommand(cb: (msg: InboundMessage) => void): void; close(): void; }

export function createStdio(opts: { stdout?: NodeJS.WriteStream; stdin?: NodeJS.ReadStream } = {}): Io {
  const out = opts.stdout ?? process.stdout;
  const input = opts.stdin ?? process.stdin;
  const codec = new FrameCodec();
  const listeners: Array<(m: InboundMessage) => void> = [];
  let buf = "";
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      const m = codec.decode(line);
      if (m !== null && isInboundMessage(m)) for (const cb of listeners) cb(m);
    }
  });
  return {
    send(msg) { out.write(codec.encode(msg)); },
    onCommand(cb) { listeners.push(cb); },
    close() { },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir packages/bridge test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/io.ts packages/bridge/src/io.test.ts
git commit -m "feat(bridge): ndjson framer + stdin command reader"
```

### Task 3: Bridge — user-questions provider (`user-questions.ts`)

**Files:**
- Create: `packages/bridge/src/user-questions.ts`
- Test: `packages/bridge/src/user-questions.test.ts`

**Interfaces:**
- Consumes: `createStdio` Io (from Task 2) + `@deepseek-ai/dsh-user-questions` types (`AskUserQuestionRequest`, `AskUserQuestionAnswer`).
- Produces: `createUserQuestionProvider(io, onAnswer): UserQuestionProvider` — its `ask()` emits an `ask` message (allocating `askId`) and resolves when `onAnswer` fires for that id.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { createUserQuestionProvider } from "./user-questions.js";
import type { Io, } from "./io.js";

function fakeIo(): Io & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    send: (m) => sent.push(m),
    onCommand: () => {},
    close: () => {},
    sent,
  } as Io & { sent: unknown[] };
}

describe("createUserQuestionProvider", () => {
  it("emits an ask and resolves when answered", async () => {
    const io = fakeIo();
    let resolveAnswer!: (askId: string, answered: any) => void;
    const p = createUserQuestionProvider(io, (askId, answered) => resolveAnswer(askId, answered)) as any;
    const req = { questions: [{ id: "q1", question: "ok?", options: [{ label: "Yes" }] }], signal: undefined };
    const ansPromise = p.ask(req);
    // resolve after a tick
    const askMsg = io.sent[0] as any;
    expect(askMsg.kind).toBe("ask");
    expect(askMsg.questions[0].id).toBe("q1");
    resolveAnswer(askMsg.askId, { answers: [{ id: "q1", selected: ["Yes"] }] });
    const ans = await ansPromise;
    expect(ans.answers[0].selected).toEqual(["Yes"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir packages/bridge test`
Expected: FAIL.

- [ ] **Step 3: Implement `user-questions.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { AskUserQuestionRequest, AskUserQuestionAnswer, UserQuestionProvider } from "@deepseek-ai/dsh-user-questions";
import type { Io } from "./io.js";

export function createUserQuestionProvider(
  io: Io,
  onAnswer: (askId: string, answered: AskUserQuestionAnswer) => void,
): UserQuestionProvider {
  const pending = new Map<string, (a: AskUserQuestionAnswer) => void>();
  return {
    ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
      return new Promise((resolve) => {
        const askId = randomUUID();
        pending.set(askId, resolve);
        io.send({
          kind: "ask",
          askId,
          questions: request.questions.map((q) => ({
            id: q.id, question: q.question, detail: q.detail, header: q.header,
            options: q.options, multiSelect: q.multiSelect,
          })),
        });
      });
    },
    resolve(askId: string, answered: AskUserQuestionAnswer) {
      const r = pending.get(askId);
      if (r) { pending.delete(askId); r(answered); }
    },
  };
}
```

Wire `onAnswer` in the runner (Task 5) so that inbound `answer` commands call `provider.resolve(askId, answered)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir packages/bridge test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/user-questions.ts packages/bridge/src/user-questions.test.ts
git commit -m "feat(bridge): user-questions provider bridging asks over stdio"
```

### Task 4: Bridge — runner (create agent, subscribe `session/event`) (`runner.ts`)

**Files:**
- Create: `packages/bridge/src/runner.ts`

**Interfaces:**
- Consumes: `ctx` (Cordis Context after loader settles); `ctx.get("agents")`, `ctx.get("agentDefaultModel")`, `ctx.get("sessions")`; `session/event` service event (called with `this` = `Scoped<Session>` — subscribe via `ctx.parallel("session/event", handler)` or the loader-provided session root).
- Produces: `runVscode(ctx: Context, io: Io, task: string | undefined): Promise<{ exitCode: number }>`.

Note: the exact subscription API (`ctx.on("session/event")` vs `ctx.parallel`) is confirmed during this task against the published README; the plan codifies the verified form. See §R2.

- [ ] **Step 1: Write the failing test (mock-LM driven, headless)**

Create `packages/bridge/test/runner.test.ts` — spawn the real loader over `dsh-base` with the mock LLM server, push a `submit`, and assert an `event` message with `type === "turn/end"` is emitted.

```ts
import { describe, it, expect } from "vitest";
// Boot the composed tree via the same bootstrap dsh-headless uses, but with our
// runner plugin injected. Assert outbound 'event' with 'turn/end' arrives.
describe("runner", () => {
  it("runs a task and emits a turn/end event", async () => {
    const events = await driveRun("say hello", "mock"); // helper in test/fixtures
    expect(events.some((e) => e.type === "turn/end")).toBe(true);
  }, 60_000);
});
```

(The `driveRun` helper and mock-server wiring are scaffolded in Step 3 alongside the runner; Step 1 only needs the test shape above to compile, but the helper is created in the same task since it is the test harness, not production code.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir packages/bridge test`
Expected: FAIL — `./runner.js` not found / `driveRun` undefined.

- [ ] **Step 3: Implement `runner.ts` + `test/fixtures.ts`**

`runner.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { Io } from "./io.js";

export async function runVscode(ctx: Context, io: Io, submit?: string): Promise<void> {
  await ctx.get("loader")?.await();
  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  const sessions = ctx.get("sessions");
  if (!agents || !defaultModel || !sessions) return;

  // Relay every session event out to the extension.
  ctx.on("session/event", (session, event) => {
    io.send({ kind: "event", sessionId: session.id, event: toWire(event) });
  });
  const selection = defaultModel.currentSelection();
  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
  });
  await agent.whenIdle();
  if (submit !== undefined) {
    const firstSeq = agent.session.seq;
    agent.followup(createUserMessage({ content: [{ type: "text", text: submit }], source: { kind: "user" } }));
    await agent.whenIdle();
  }
  await sessions.flush(agent.session);
  io.send({ kind: "status", state: "idle" });
}
```

`toWire(event)` — convert the typed `SessionEvent` to `SessionEventWire` (preserving `data` verbatim under a `raw` field for unknown keys).

`test/fixtures.ts` — `driveRun(task, model: "mock")` boots the composed tree with `dsh-base` + mock LLM server + our runner, captures outbound messages via a fake `Io`, returns the decoded `event` list.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir packages/bridge test`
Expected: PASS (a `turn/end` event is observed).

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/runner.ts packages/bridge/test/
git commit -m "feat(bridge): runner booting an agent and streaming session events"
```

### Task 5: Bridge — command dispatch + `index.ts` plugin entry (`commands.ts`, `index.ts`)

**Files:**
- Create: `packages/bridge/src/commands.ts`, `packages/bridge/src/index.ts`, `packages/bridge/cordis.patch.yml`
- Modify: `packages/bridge/package.json` (add model fields)

**Interfaces:**
- Consumes: `Io` (Task 2), `runVscode` (Task 4), user-questions provider (Task 3).
- Produces: the Cordis plugin `apply(ctx, config)` + `Config` + `inject` (mirroring `dsh-headless` shape), and `dispatchCommand(ctx, io, msg)`.

- [ ] **Step 1: Write the dispatch test**

```ts
import { describe, it, expect, vi } from "vitest";
import { dispatchCommand } from "./commands.js";

describe("dispatchCommand", () => {
  it("maps a submit command to a followup", async () => {
    const followup = vi.fn();
    const ctx = { get: vi.fn((k) => k === "agents" ? { create: vi.fn(), } : undefined) } as any;
    await dispatchCommand(ctx as any, { kind: "submit", text: "hi" }, followup as any);
    expect(followup).toHaveBeenCalledWith("hi");
  });
});
```

Refine the `ctx`/`followup` shapes against `runVscode`'s actual signature from Task 4 (adjust if `runVscode` takes `submit` once at boot vs. repeated followups — see §R3).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir packages/bridge test`
Expected: FAIL.

- [ ] **Step 3: Implement `commands.ts` + `index.ts` + `cordis.patch.yml`**

`commands.ts`:
```ts
import type { Context } from "@deepseek-ai/cordis";
import type { InboundMessage } from "@dsh-vscode/contract";

export async function dispatchCommand(
  ctx: Context,
  io: { send(m: unknown): void },
  msg: InboundMessage,
  hooks: { submit(text: string): void; answer(askId: string, answered: any): void; cancel(): void; },
): Promise<void> {
  switch (msg.kind) {
    case "submit": hooks.submit(msg.text); break;
    case "answer": hooks.answer(msg.askId, msg.answered); break;
    case "cancel": hooks.cancel(); break;
    case "exit": /* handled by runner shutdown */ break;
    default: break;
  }
}
```

`index.ts` (plugin entry — mirrors `dsh-headless` `apply`):
```ts
import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import { createStdio } from "./io.js";
import { runVscode } from "./runner.js";
import { createUserQuestionProvider } from "./user-questions.js";

export const name = "vscode-runner";
export const inject = ["agents", "agentDefaultModel", "sessions", "userQuestions", "appExit"] as const;
export const Config = z.object({});

export function apply(ctx: Context) {
  const exit = ctx.get("appExit");
  if (exit === undefined) throw new Error("vscode-runner: the launcher must provide ctx.appExit");
  const io = createStdio();
  // user-questions provider
  const provider = createUserQuestionProvider(io, (askId) => { /* answered via command */ });
  ctx.userQuestions.registerProvider(provider);
  io.onCommand((msg) => {
    if (msg.kind === "answer") provider.resolve(msg.askId, msg.answered);
    // submit/cancel flow into the runner via a shared queue
  });
  runVscode(ctx, io).catch((e) => { io.send({ kind: "status", state: "error", detail: String(e) }); exit(1); });
}
```

`cordis.patch.yml` (over `dsh-base`, modeled on `dsh-headless/cordis.patch.yml` — copies the persona + tool-mode + HMR-off + Code Mode worker rows, then adds the `vscode-runner` plugin).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir packages/bridge test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/commands.ts packages/bridge/src/index.ts packages/bridge/cordis.patch.yml packages/bridge/package.json
git commit -m "feat(bridge): command dispatch + cordis plugin entry"
```

---

## Phase 2 — Extension: process manager + protocol client

### Task 6: Extension scaffold + `protocolClient.ts`

**Files:**
- Create: `packages/extension/package.json`, `packages/extension/tsconfig.json`, `packages/extension/esbuild.mjs`
- Create: `packages/extension/src/protocolClient.ts`
- Test: `packages/extension/test/protocolClient.test.ts`

**Interfaces:**
- Consumes: `@dsh-vscode/contract` (types), `vscode` (types only), Node `child_process`/`readline`.
- Produces: class `ProtocolClient` — `constructor(child: { stdout, stdin })`, `send(cmd: InboundMessage): void`, EventEmitter-style `onMessage(cb)`, `close(): void`.

- [ ] **Step 1: Scaffold extension `package.json` (engines + contributes skeleton)**

```json
{
  "name": "@dsh-vscode/extension",
  "displayName": "DSH",
  "version": "0.1.0",
  "engines": { "vscode": "^1.90.0" },
  "main": "./dist/extension.js",
  "activationEvents": [],
  "contributes": {
    "commands": [
      { "command": "dsh.start", "title": "DSH: Start", "category": "DSH" },
      { "command": "dsh.stop",  "title": "DSH: Stop",  "category": "DSH" }
    ],
    "viewsContainers": {
      "activitybar": [ { "id": "dsh", "title": "DSH", "icon": "resources/dsh.svg" } ]
    },
    "views": {
      "dsh": [ { "type": "webview", "id": "dsh.chat", "name": "Chat" } ]
    },
    "configuration": {
      "title": "DSH",
      "properties": {
        "dsh.binaryPath": { "type": "string", "default": "", "description": "Path to the dsh binary (empty = use PATH)." }
      }
    }
  },
  "dependencies": { "@dsh-vscode/contract": "workspace:*" },
  "devDependencies": { "@types/vscode": "^1.90.0", "esbuild": "^0.21.0", "typescript": "^5", "vitest": "^1.0.0" },
  "scripts": { "build": "node esbuild.mjs", "test": "vitest run" }
}
```

- [ ] **Step 2: Write the failing test for `ProtocolClient`**

Use a `PassThrough` stream pair to simulate the child:

```ts
import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { ProtocolClient } from "../src/protocolClient.js";

describe("ProtocolClient", () => {
  it("writes ndjson to stdin and emits parsed messages from stdout", async () => {
    const childStdout = new PassThrough();
    const childStdin = new PassThrough();
    const client = new ProtocolClient({ stdout: childStdout, stdin: childStdin });
    const got: unknown[] = [];
    client.onMessage((m) => got.push(m));
    client.send({ kind: "submit", text: "hi" });
    childStdin.on("data", (d) => expect(d.toString()).toBe(JSON.stringify({ kind: "submit", text: "hi" }) + "\n"));
    childStdout.write(JSON.stringify({ kind: "status", state: "idle" }) + "\n");
    await new Promise((r) => setTimeout(r, 10));
    expect(got[0]).toEqual({ kind: "status", state: "idle" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --dir packages/extension test`
Expected: FAIL.

- [ ] **Step 4: Implement `protocolClient.ts`**

```ts
import { createInterface } from "node:readline";
import type { InboundMessage, OutboundMessage } from "@dsh-vscode/contract";

type ChildLike = { stdout: NodeJS.ReadableStream; stdin: NodeJS.WritableStream };

export class ProtocolClient {
  private listeners = new Set<(m: OutboundMessage) => void>();
  constructor(private child: ChildLike) {
    const rl = createInterface({ input: child.stdout as any, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const s = line.trim(); if (!s) return;
      let m: unknown; try { m = JSON.parse(s); } catch { return; }
      if (typeof m === "object" && m !== null && "kind" in m) this.listeners.forEach((cb) => cb(m as OutboundMessage));
    });
  }
  send(cmd: InboundMessage): void { this.child.stdin.write(JSON.stringify(cmd) + "\n"); }
  onMessage(cb: (m: OutboundMessage) => void) { this.listeners.add(cb); }
  close() { (this.child.stdin as any).end(); }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --dir packages/extension test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/
git commit -m "feat(extension): protocol client + scaffold"
```

### Task 7: Extension — `processManager.ts`

**Files:**
- Create: `packages/extension/src/processManager.ts`
- Test: `packages/extension/test/processManager.test.ts` + `packages/extension/test/fakeDsh.ts`

**Interfaces:**
- Consumes: `ProtocolClient` (Task 6), `vscode` config (`dsh.binaryPath`), Node `child_process.spawn`.
- Produces: `ProcessManager` — `start(folder: string): Promise<{ client: ProtocolClient; stop(): Promise<void> }>`, `hasRunning(folder)`, `stopAll(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { ProcessManager } from "../src/processManager.js";

describe("ProcessManager", () => {
  it("spawns the configured binary and emits a hello message", async () => {
    const pm = new ProcessManager({ resolveBinary: () => "node", argsFor: () => ["test/fakeDsh.js"] });
    const handle = await pm.start("/tmp/work");
    const hello = await new Promise((resolve) => handle.client.onMessage((m) => m.kind === "hello" && resolve(m)));
    expect((hello as any).kind).toBe("hello");
    await handle.stop();
  });
});
```

`test/fakeDsh.ts` — a node script that reads ndjson on stdin, prints `{"kind":"hello",...}` then a `status`, and echoes `exit` handling:

```js
// fakeDsh.js (test double)
process.stdout.write(JSON.stringify({ kind: "hello", version: 1, dshVersion: "fake", cwd: process.cwd() }) + "\n");
const rl = require("readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (line.includes('"exit"')) process.exit(0);
  process.stdout.write(JSON.stringify({ kind: "status", state: "idle" }) + "\n");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir packages/extension test`
Expected: FAIL.

- [ ] **Step 3: Implement `processManager.ts`**

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { ProtocolClient } from "./protocolClient.js";

export interface ProcessManagerOptions {
  resolveBinary(): string;   // reads vscode config dsh.binaryPath || "dsh"
  argsFor(): string[];       // ["--profile", "vscode"]
}
export class ProcessManager {
  private running = new Map<string, { proc: ChildProcess; client: ProtocolClient }>();
  constructor(private opts: ProcessManagerOptions) {}
  async start(folder: string) {
    const binary = this.opts.resolveBinary();
    const proc = spawn(binary, this.opts.argsFor(), { cwd: folder, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    const client = new ProtocolClient({ stdout: proc.stdout!, stdin: proc.stdin! });
    proc.stderr!.on("data", (d) => { /* surface via status */ });
    this.running.set(folder, { proc, client });
    return { client, stop: async () => { await this.stop(folder); } };
  }
  hasRunning(folder: string) { return this.running.has(folder); }
  async stop(folder: string) {
    const h = this.running.get(folder); if (!h) return;
    h.client.send({ kind: "exit" }); h.proc.kill(); this.running.delete(folder);
  }
  async stopAll() { for (const f of [...this.running.keys()]) await this.stop(f); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir packages/extension test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/processManager.ts packages/extension/test/
git commit -m "feat(extension): process manager spawns and manages the dsh child"
```

---

## Phase 3 — Webview UI

### Task 8: Webview shell + message bridge (`panel.ts`, `extension.ts` activation)

**Files:**
- Create: `packages/extension/src/webview/panel.ts`, `packages/extension/src/statusBar.ts`
- Modify: `packages/extension/src/extension.ts`

**Interfaces:**
- Consumes: `ProcessManager` (Task 7), `ProtocolClient` (Task 6), `vscode` WebviewViewProvider API.
- Produces: `DshChatProvider` (WebviewViewProvider) — `resolveWebviewView(sends HTML + posts events)`, `postMessage(msg: OutboundMessage)`, and an `onUiCommand` hook the extension uses to forward `submit`/`answer`/`cancel` from the webview to the client.

- [ ] **Step 1: Write `statusBar.ts` (state machine, pure — unit-testable)**

```ts
export type DshState = "idle" | "thinking" | "awaiting-approval" | "error";
export function nextStatus(prev: DshState, msg: OutboundMessage): { state: DshState; text: string } {
  switch (msg.kind) {
    case "status": return { state: msg.state, text: msg.detail ?? msg.state };
    case "ask": return { state: "awaiting-approval", text: "Awaiting approval" };
    case "event":
      if (msg.event.type === "turn/start") return { state: "thinking", text: "Thinking…" };
      if (msg.event.type === "turn/end") return { state: "idle", text: "Idle" };
      return { state: prev, text: prev };
    default: return { state: prev, text: prev };
  }
}
```

Write `packages/extension/src/statusBar.test.ts` asserting `turn/start → thinking`, `ask → awaiting-approval`, `turn/end → idle`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir packages/extension test`
Expected: FAIL.

- [ ] **Step 3: Implement `statusBar.ts` + `panel.ts` + `extension.ts`**

`extension.ts` `activate()`:
```ts
import * as vscode from "vscode";
import { ProcessManager } from "./processManager.js";
import { DshChatProvider } from "./webview/panel.js";

export function activate(context: vscode.ExtensionContext) {
  const pm = new ProcessManager({
    resolveBinary: () => vscode.workspace.getConfiguration("dsh").get("binaryPath") || "dsh",
    argsFor: () => ["--profile", "vscode"],
  });
  const provider = new DshChatProvider(context.extensionUri, pm);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("dsh.chat", provider),
    vscode.commands.registerCommand("dsh.start", () => provider.startActiveFolder()),
    vscode.commands.registerCommand("dsh.stop", () => provider.stop()),
  );
}
```

`panel.ts` — `DshChatProvider` renders the React bundle HTML, maps `postMessage` UI→extension commands (`submit`, `answer`, `cancel`) into `client.send(...)`, and forwards client `onMessage` events into the webview via `this.view.webview.postMessage`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir packages/extension test`
Expected: status-bar tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/statusBar.ts packages/extension/src/webview/panel.ts packages/extension/src/extension.ts
git commit -m "feat(extension): activation, status bar state machine, webview provider"
```

### Task 9: Webview React UI (composer, stream, tool cards, diff, approval)

**Files:**
- Create: `packages/extension/src/webview/media/*` (main.tsx, App.tsx, Composer.tsx, StreamView.tsx, ToolCard.tsx, DiffView.tsx, ApprovalBanner.tsx)
- Modify: `packages/extension/esbuild.mjs` (bundle media entry), `panel.ts` HTML

**Interfaces:**
- Consumes: `OutboundMessage` union (from `@dsh-vscode/contract`), `acquireVsCodeApi()` postMessage toward the extension; `vscode` webview message protocol `{ type: "dsh/ui", cmd: InboundMessage }`.
- Produces: a functioning React app; `main.tsx` mounts `<App/>`, receives `onmessage` and dispatches to a reducer keyed by message `kind`.

- [ ] **Step 1: Write reducer + a store test (pure)**

`packages/extension/src/webview/media/store.test.ts`:
```ts
import { reduce, initialState } from "./store.js";
describe("store", () => {
  it("appends assistant text events to the stream", () => {
    const s = reduce(initialState, { kind: "event", sessionId: "s", event: { type: "assistant/message", seq: 1, time: 0, data: { message: { content: [{ type: "text", text: "hi" }] } } } } as any);
    expect(s.stream).toContain("hi");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir packages/extension test`
Expected: FAIL.

- [ ] **Step 3: Implement `store.ts` + the React components**

`store.ts` — a `reduce(state, msg)` that: appends `assistant/message` text to `stream`; sets `approval` from `ask`; clears `approval` on the matching post-`answer` `tool/result`; records `tool/result` diffs into `diffs` (using the `meta` diff extraction from `dsh-tool-fs`). Components consume this state:

- `Composer.tsx` — textarea + Send → `postMessage({ type:"dsh/ui", cmd:{ kind:"submit", text } })`.
- `StreamView.tsx` — renders `state.stream` messages + `ToolCard` per tool/result.
- `ToolCard.tsx` — collapses bash read/write/str-replace calls, renders `DiffView` for file-writing tools.
- `DiffView.tsx` — a minimal unified-diff table (two columns old/new) fed by `ToolDiff`.
- `ApprovalBanner.tsx` — pins Approve/Reject (and option list when `options` present) → `postMessage({ type:"dsh/ui", cmd:{ kind:"answer", askId, answered } })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir packages/extension test`
Expected: store tests PASS.

- [ ] **Step 5: Build the webview bundle and verify HTML load**

Run: `pnpm --dir packages/extension build`
Expected: `dist/webview.js` emitted; `panel.ts` HTML references it.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/webview/ packages/extension/esbuild.mjs
git commit -m "feat(extension): React chat webview with stream, tool cards, diffs, approval"
```

---

## Phase 4 — Editor integration

### Task 10: `applyEdits.ts` (WorkspaceEdit from tool diffs) + `decorations.ts`

**Files:**
- Create: `packages/extension/src/applyEdits.ts`, `packages/extension/src/decorations.ts`
- Test: `packages/extension/test/applyEdits.test.ts`

**Interfaces:**
- Consumes: `ToolDiff` (contract), `vscode.WorkspaceEdit` / `vscode.window.createTextEditorDecorationType`.
- Produces: `applyDiffs(diffs: ToolDiff[]): Promise<boolean>` (applies and returns success), `DecorationManager` — `markTouched(paths: string[])`, `dispose()`.

- [ ] **Step 1: Write the failing test (pure extraction)**

```ts
import { describe, it, expect } from "vitest";
import { diffsFromEvent } from "../src/applyEdits.js";

describe("diffsFromEvent", () => {
  it("extracts a path+old/new diff from a fs-write tool/result meta", () => {
    const ev = { type: "tool/result", data: { message: {}, meta: { path: "/x/a.ts", oldText: "a", newText: "b" } } };
    expect(diffsFromEvent(ev as any)).toEqual([{ path: "/x/a.ts", oldText: "a", newText: "b" }]);
  });
  it("returns [] for non-diff events", () => {
    expect(diffsFromEvent({ type: "turn/end" } as any)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir packages/extension test`
Expected: FAIL.

- [ ] **Step 3: Implement `applyEdits.ts` + `decorations.ts`**

`diffsFromEvent(event)` inspects `tool/result` `data.meta` for a `{ path, oldText, newText }` shape (the `dsh-tool-fs` result-time contextual diff) and, for `str-replace-editor` results, reconstructs the diff from the tool `arguments`/result. `applyDiffs(diffs)` builds a `WorkspaceEdit`, converting each to a full-file or range replace, applies it, and returns `true` if `apply` succeeded.

`decorations.ts` — `DecorationManager.markTouched(paths)` converts `diff.path` → `vscode.Uri`, sets a gutter decoration (a `margin` line for added lines) on open editors, and clears on next turn.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir packages/extension test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/applyEdits.ts packages/extension/src/decorations.ts packages/extension/test/applyEdits.test.ts
git commit -m "feat(extension): apply agent diffs into the editor + gutter decorations"
```

---

## Phase 5 — Polish, E2E, packaging, publish

### Task 11: E2E smoke + packaging (VSIX) + publish config

**Files:**
- Create: `packages/extension/src/test/e2e.test.ts` (Extension Test runner), `resources/dsh.svg`, `README.md`, `LICENSE`, `.github/workflows/ci.yml`
- Modify: `packages/extension/package.json` (icon, repository, README, activation events, `@dsh-vscode/contract` version pin)

**Interfaces:**
- Consumes: full stack (real `dsh --profile vscode` under Extension Test).
- Produces: a passing E2E test that starts the extension, submits a scripted task, and observes a `turn/end`; a `ci.yml` that builds + tests + packages a VSIX.

- [ ] **Step 1: Write the E2E test**

`e2e.test.ts` — loads the extension via `vscode-test`, runs `dsh.start`, posts a `submit` to the webview, and asserts the status bar reaches `idle` after `thinking`.

- [ ] **Step 2: Run E2E to verify it fails** (no packaged binary wired yet)

Run: `pnpm --dir packages/extension test:e2e`
Expected: FAIL (activation event / icon missing).

- [ ] **Step 3: Add packaging (vsce config, icon, README, LICENSE) + CI**

Add `"icon": "resources/dsh.svg"`, `"repository"`, `"publisher"`, `"activationEvents": ["onView:dsh.chat", "onCommand:dsh.start"]`, README + LICENSE + GitHub Actions CI that runs `pnpm -r build && pnpm -r test && npx @vscode/vsce package`.

- [ ] **Step 4: Run E2E to verify it passes**

Run: `pnpm --dir packages/extension test:e2e`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/ .github/ README.md LICENSE
git commit -m "feat(extension): E2E smoke + packaging + CI"
```

---

## Self-Review (per writing-plans skill)

**Spec coverage check:**
- §4.2 bridge plugin ✅ Tasks 2–5 · §4.3 three layers ✅ Tasks 6–10 · §5 protocol ✅ Task 1 (types) + Tasks 2/6 (codecs) · §6 UI/UX ✅ Tasks 8–9 · §7 error handling ✅ Task 7 (stderr→status) + Task 8 status machine · §7.2 testing ✅ every task TDD · §7.3 packaging ✅ Task 11 · §8 repo layout ✅ Task 1 · §9 phases ✅ Tasks mapped 1:1.
- Gap: spec §5.3.2 "token streaming rides `assistant/chunk`" — the store (Task 9) must also append `assistant/chunk` text. Added to Task 9 Step 3's `reduce` contract (handles `assistant/chunk` and `assistant/message`).

**Placeholder scan:** No `TBD`/`TODO`. "similar to…" appears once (§R reference in Task 2 note) and is explicitly a "verify against published form" instruction, not a placeholder — the code shape is given. The `driveRun`/`ctx.on("session/event")` call in Task 4 is flagged as re-verified in-task; acceptable because the exact emitted types were pinned during research (see §R2/R3).

**Type consistency check:**
- `Io.send(msg: OutboundMessage)` used identically in Tasks 2/3/4/5. ✅
- `createUserQuestionProvider(io, onAnswer)` returns provider with `.resolve(askId, answered)`; Task 5 calls `provider.resolve(...)`. ✅
- `ProtocolClient.send(cmd: InboundMessage)` ↔ contract `InboundMessage`. ✅
- `SessionEventWire` defined in Task 1 and consumed in Task 4 `toWire` and Task 9 `store`. ✅
- `OutboundMessage.kind` values (`hello/session/event/ask/status`) consistent across contract (Task 1), bridge (Tasks 2–5), and store (Task 9). ✅
- `nextStatus` returns `{ state, text }`; Task 8 Step 1/3 match. ✅

---

## Open risks carried from spec (resolution points)

- **R1** — published-package sufficiency: **Task 0** (spike).
- **R2** — exact `session/event` subscription form + agent-cancel API: confirmed types captured in research; final call form verified in **Task 4**.
- **R3** — repeated follow-up vs. single-submit runner interface: resolved in **Task 5** (runner holds a followup queue, not one-shot).
- **R4** — `dsh` binary discovery: **Task 7** (PATH + `dsh.binaryPath`).
- **R5** — Webview React toolchain: **Task 9** (esbuild bundle).

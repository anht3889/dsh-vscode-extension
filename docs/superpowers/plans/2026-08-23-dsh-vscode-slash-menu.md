# DSH VS Code Slash Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DSH Web-compatible `/` discovery and selection to the VS Code/Cursor composer, including session-scoped commands, user-invocable skills, immediate bare-command execution, input-command claims, and durable command transcript entries.

**Architecture:** Protocol v4 carries one normalized slash catalog and explicit command execution requests. The bridge owns DSH service access and command execution; pure webview modules own slash grammar and ranking; the reducer owns picker/claim state; React renders a combobox without moving focus out of the textarea.

**Tech Stack:** TypeScript, React, VS Code webviews, NDJSON protocol, Cordis services, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-23-dsh-vscode-slash-menu-design.md`

## Global Constraints

- Match DSH Web semantics: bare commands execute immediately, commands with input claim the composer, skills insert slash text, and unknown slash lines submit as ordinary prompts.
- Bump `PROTOCOL_VERSION` from `3` to `4`; do not add a v3 compatibility path.
- `ctx.commands` and `ctx.skills` are optional services; an unavailable source must not fail bridge startup.
- Keep DSH-specific command/skill projection and execution in the bridge, not the React webview.
- Keep provider catalog reads session-scoped to the current live Agent and current session cwd.
- Never convert a command invocation into `user/message`; DSH Commands owns `command/run` and `command/done`.
- A transient catalog failure must not mutate draft text, command claims, or the current session.
- Keep one picker overlay open at a time through a discriminated `attachment | slash` union.
- Do not create commits unless the user explicitly asks; each task ends with a commit-ready checkpoint instead.

---

## File Structure

### New files

- `packages/bridge/src/slash-catalog.ts` — latest-open coordinator that reads commands and skills and sends normalized protocol items.
- `packages/bridge/src/slash-command.ts` — command-line validation, image admission, execution, cancellation, and command-start retention behavior.
- `packages/bridge/src/slash-catalog.test.ts` — catalog mapping, source availability, and stale-read tests.
- `packages/bridge/src/slash-command.test.ts` — execution, rejection, image, and cancellation tests.
- `packages/extension/src/webview/media/slashToken.ts` — slash token detection and replacement helpers.
- `packages/extension/src/webview/media/slashToken.test.ts` — DSH Web-compatible grammar tests.
- `packages/extension/src/webview/media/slashFilter.ts` — command fuzzy scoring and grouped filtering.
- `packages/extension/src/webview/media/slashFilter.test.ts` — deterministic ordering and inline exclusion tests.
- `packages/extension/src/webview/media/components/SlashPicker.tsx` — accessible grouped listbox rendered above the composer.
- `packages/extension/src/webview/media/components/SlashPicker.test.tsx` — rendering, pointer selection, and diagnostics.
- `packages/extension/src/webview/media/App.test.tsx` — full webview trigger/request/pick/submit flow with a mocked VS Code message port.

### Modified files

- `packages/contract/src/protocol.ts` and `protocol.test.ts` — protocol v4 types, unions, and guards.
- `packages/bridge/package.json` and root `pnpm-lock.yaml` — direct command/skill package dependencies.
- `packages/bridge/src/runner.ts` — live coordinator/executor wiring, controller methods, cancellation, transcript events.
- `packages/bridge/src/commands.ts` and `test/commands.test.ts` — dispatch v4 list/execute commands.
- `packages/bridge/test/session-controller.test.ts` — session replacement and command cancellation.
- `packages/extension/src/webview/media/store.ts` and `store.test.ts` — discriminated picker, command claim, command transcript folding.
- `packages/extension/src/webview/media/App.tsx` — trigger arbitration, catalog request, pick outcomes, execute-vs-submit.
- `packages/extension/src/webview/media/components/Composer.tsx` and test — keyboard arbitration, claim hint, slash picker rendering.
- `packages/extension/src/webview/media/style.css` — grouped slash menu, highlight, and hint styles.
- `packages/extension/README.md` — user-visible behavior and failure semantics.

---

### Task 1: Protocol v4 slash messages

**Files:**
- Modify: `packages/contract/src/protocol.ts`
- Modify: `packages/contract/src/protocol.test.ts`

**Interfaces:**
- Produces:

```ts
export type SlashMenuSource = "command" | "skill";
export type SlashMenuBehavior = "execute" | "command-input" | "insert";

export interface SlashMenuItem {
  source: SlashMenuSource;
  name: string;
  description: string;
  behavior: SlashMenuBehavior;
  hint?: string;
  acceptsImages?: boolean;
}

export interface SlashAvailability {
  commands: boolean;
  skills: boolean;
}

export interface ListSlashItemsCommand {
  kind: "listSlashItems";
  requestId: string;
}

export interface ExecuteSlashCommand {
  kind: "executeSlashCommand";
  line: string;
  images?: EncodedImageAttachment[];
}

export interface SlashItemsMessage {
  kind: "slashItems";
  requestId: string;
  items: SlashMenuItem[];
  availability: SlashAvailability;
}
```

- [ ] **Step 1: Add failing protocol tests**

Add accepted-message cases:

```ts
expect(isInboundMessage({ kind: "listSlashItems", requestId: "r1" })).toBe(true);
expect(isInboundMessage({
  kind: "executeSlashCommand",
  line: "/goal ship it",
  images: [{ mediaType: "image/png", data: "AA==" }],
})).toBe(true);
expect(isOutboundMessage({
  kind: "slashItems",
  requestId: "r1",
  items: [
    {
      source: "command",
      name: "goal",
      description: "Set the goal",
      behavior: "command-input",
      hint: "<objective>",
      acceptsImages: false,
    },
    {
      source: "skill",
      name: "brainstorming",
      description: "Design before implementation",
      behavior: "insert",
    },
  ],
  availability: { commands: true, skills: true },
})).toBe(true);
```

Add rejection cases for empty request ids, non-slash execution lines, unknown source/behavior, empty names, skill behaviors other than `insert`, command behavior `insert`, missing `command-input.hint`, `acceptsImages` outside `command-input`, malformed availability, and malformed image attachments.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
pnpm --filter @dsh-vscode/contract exec vitest run src/protocol.test.ts
```

Expected: failures because protocol version is still 3 and slash kinds are not accepted.

- [ ] **Step 3: Add v4 types and dependent-field guards**

Set:

```ts
export const PROTOCOL_VERSION = 4;
```

Add `isSlashMenuItem` with these exact invariants:

```ts
if (typeof o.name !== "string" || o.name.length === 0) return false;
if (typeof o.description !== "string") return false;
if (o.source === "skill") {
  return o.behavior === "insert"
    && o.hint === undefined
    && o.acceptsImages === undefined;
}
if (o.source !== "command" || o.behavior === "insert") return false;
if (o.behavior === "command-input") {
  return typeof o.hint === "string"
    && o.hint.length > 0
    && (o.acceptsImages === undefined || typeof o.acceptsImages === "boolean");
}
return o.behavior === "execute"
  && o.hint === undefined
  && o.acceptsImages === undefined;
```

Extend inbound/outbound unions, kind rolls, and validators. Validate `requestId.length > 0` and `line.trimStart().startsWith("/")`.

- [ ] **Step 4: Run contract checks**

Run:

```bash
pnpm --filter @dsh-vscode/contract run typecheck
pnpm --filter @dsh-vscode/contract run test
```

Expected: all contract tests pass and protocol version assertions expect 4.

- [ ] **Step 5: Commit-ready checkpoint**

Review:

```bash
git diff --check
git diff -- packages/contract
```

Suggested commit if explicitly authorized: `feat(contract): add slash menu protocol`

---

### Task 2: Pure slash token grammar and ranking

**Files:**
- Create: `packages/extension/src/webview/media/slashToken.ts`
- Create: `packages/extension/src/webview/media/slashToken.test.ts`
- Create: `packages/extension/src/webview/media/slashFilter.ts`
- Create: `packages/extension/src/webview/media/slashFilter.test.ts`

**Interfaces:**
- Consumes: `SlashMenuItem` from Task 1.
- Produces:

```ts
export interface SlashToken {
  query: string;
  position: "leading" | "inline";
  start: number;
  end: number;
}

export function activeSlashToken(text: string, caret: number): SlashToken | undefined;
export function replaceSlashToken(
  text: string,
  token: Pick<SlashToken, "start" | "end">,
  replacement: string,
): { text: string; caret: number };

export interface SlashGroup {
  source: "command" | "skill";
  items: SlashMenuItem[];
}

export function filterSlashItems(
  items: readonly SlashMenuItem[],
  token: Pick<SlashToken, "query" | "position">,
): SlashGroup[];
```

- [ ] **Step 1: Write grammar tests**

Pin:

```ts
expect(activeSlashToken("/", 1)).toEqual({
  query: "", position: "leading", start: 0, end: 1,
});
expect(activeSlashToken("please /com", 11)).toEqual({
  query: "com", position: "inline", start: 7, end: 11,
});
expect(activeSlashToken("a/b", 3)).toBeUndefined();
expect(activeSlashToken("https://host/x", 8)).toBeUndefined();
expect(activeSlashToken("C:/work", 3)).toBeUndefined();
expect(activeSlashToken("// comment", 2)).toBeUndefined();
expect(activeSlashToken("@/path", 2)).toBeUndefined();
```

Also test punctuation boundaries, caret in the middle of a draft, whitespace termination, and `replaceSlashToken`.

- [ ] **Step 2: Run grammar tests and verify failure**

Run:

```bash
pnpm --filter dsh exec vitest run src/webview/media/slashToken.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the grammar**

Port the behavior, not the package, from DSH Web's `detectTrigger`: scan backward from `caret`, reject URL/word cases, and compute leading position using `text.slice(0, slash).trim() === ""`.

- [ ] **Step 4: Write ranking tests**

Use fixed items to pin:

```ts
expect(names(filterSlashItems(items, { query: "cp", position: "leading" })))
  .toEqual(["compact", "checkpoint"]);
expect(names(filterSlashItems(items, { query: "brain", position: "leading" })))
  .toContain("brainstorming");
expect(names(filterSlashItems(items, { query: "", position: "inline" })))
  .not.toContain("goal"); // command-input
```

Pin Commands before Skills, command prefix matches before later subsequence matches, stable ties, and case-insensitive matching.

- [ ] **Step 5: Implement deterministic filtering**

Use a command score with this ordering:

1. exact name;
2. prefix;
3. fuzzy subsequence, weighted by first matched index and total gaps;
4. original catalog index.

Skills use `name.toLocaleLowerCase().startsWith(queryLower)`. Return only non-empty groups in command/skill order.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm --filter dsh exec vitest run \
  src/webview/media/slashToken.test.ts \
  src/webview/media/slashFilter.test.ts
pnpm --filter dsh run typecheck
```

- [ ] **Step 7: Commit-ready checkpoint**

Suggested commit if explicitly authorized: `feat(extension): add slash trigger and ranking`

---

### Task 3: Bridge slash catalog

**Files:**
- Modify: `packages/bridge/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/bridge/src/slash-catalog.ts`
- Create: `packages/bridge/src/slash-catalog.test.ts`
- Modify: `packages/bridge/src/runner.ts`
- Modify: `packages/bridge/src/commands.ts`
- Modify: `packages/bridge/test/commands.test.ts`

**Interfaces:**
- Consumes: protocol items from Task 1; current live `Agent`.
- Produces:

```ts
export interface SlashCatalog {
  list(requestId: string): void;
  dispose(): void;
}

export function createSlashCatalog(
  ctx: Context,
  currentAgent: () => Agent,
  send: (message: OutboundMessage) => void,
): SlashCatalog;
```

`SessionController` gains:

```ts
listSlashItems(requestId: string): void;
```

- [ ] **Step 1: Add direct dependencies**

Run:

```bash
pnpm --filter @dsh-vscode/bridge add \
  @deepseek-ai/dsh-commands \
  @deepseek-ai/dsh-skill
```

Use the versions selected by pnpm from the current DSH release line; do not hand-edit a guessed version.

- [ ] **Step 2: Write catalog tests**

Provide fakes for:

```ts
commands.list(agent) => [
  { name: "compact", description: "Compact context" },
  {
    name: "goal",
    description: "Set the goal",
    input: { hint: "<objective>", images: true },
  },
]

skills.list({ cwd, scope, signal }) => [
  { name: "brainstorming", description: "Design first", modelInvocable: true },
  { name: "internal", description: "Hidden", modelInvocable: false },
]
```

Assert normalized behavior, `acceptsImages`, command/skill collision preservation, current Agent identity, session cwd, user-invocable filtering, independent availability, and only the latest of two requests sending.

- [ ] **Step 3: Run catalog tests and verify failure**

Run:

```bash
pnpm --filter @dsh-vscode/bridge exec vitest run src/slash-catalog.test.ts
```

- [ ] **Step 4: Implement latest-open catalog reads**

Follow `file-references.ts` cancellation structure. Read commands synchronously inside a `try`. Start skill listing with an `AbortController`. Build:

```ts
const availability = {
  commands: commandService !== undefined && commandReadSucceeded,
  skills: skillService !== undefined && skillReadSucceeded,
};
send({ kind: "slashItems", requestId, items, availability });
```

Use `isUserInvocable` from `@deepseek-ai/dsh-skill`; do not infer invocability from description text.

- [ ] **Step 5: Wire dispatch and lifecycle**

Create the coordinator beside `fileReferenceSearch` in `createRunner`, dispose it on disconnect/session replacement, expose `listSlashItems`, and add:

```ts
case "listSlashItems":
  hooks.runner.listSlashItems(msg.requestId);
  return;
```

Update the dispatcher JSDoc from protocol v3 to v4.

- [ ] **Step 6: Run bridge checks**

Run:

```bash
pnpm --filter @dsh-vscode/bridge run typecheck
pnpm --filter @dsh-vscode/bridge run test
```

- [ ] **Step 7: Commit-ready checkpoint**

Suggested commit if explicitly authorized: `feat(bridge): expose slash command and skill catalog`

---

### Task 4: Webview slash state and transcript projection

**Files:**
- Modify: `packages/extension/src/webview/media/store.ts`
- Modify: `packages/extension/src/webview/media/store.test.ts`

**Interfaces:**
- Consumes: `SlashToken`, `SlashMenuItem`, `SlashAvailability`, `filterSlashItems`.
- Produces:

```ts
export interface AttachmentPickerState {
  kind: "attachment";
  // existing attachment fields
}

export interface SlashPickerState {
  kind: "slash";
  token: SlashToken;
  requestId: string;
  catalog: SlashMenuItem[];
  groups: SlashGroup[];
  availability?: SlashAvailability;
  highlightedKey?: string;
}

export type PickerState = AttachmentPickerState | SlashPickerState;

export interface CommandClaim {
  name: string;
  token: string;
  hint?: string;
  acceptsImages: boolean;
}
```

`UiState` gains `commandClaim?: CommandClaim`.

- [ ] **Step 1: Add reducer tests**

Test:

- attachment actions ignore a slash picker and vice versa;
- slash open stores draft/token/request id and no catalog;
- accepted `slashItems` computes groups and highlights the first row;
- stale request id is ignored;
- query edits update token/groups without changing request id;
- caret leaving the token dismisses;
- skill pick inserts `/name `;
- input command pick inserts `/name ` and records the claim;
- bare command pick consumes only the token and returns an execution effect/message action;
- editing the claimed prefix clears the claim;
- session/history/disconnect/new chat clear picker and claim.

Represent bare execution as an App callback triggered by the pick handler, not a reducer side effect; the reducer action should return state with the token consumed.

- [ ] **Step 2: Run store tests and verify failure**

Run:

```bash
pnpm --filter dsh exec vitest run src/webview/media/store.test.ts
```

- [ ] **Step 3: Add discriminated state and actions**

Use explicit action names:

```ts
slashPickerOpened
slashTokenChanged
slashPickerDismissed
slashItemsReceived
slashHighlightMoved
slashItemPicked
commandStarted
commandRejected
localError
```

Keep attachment action names intact but add `kind: "attachment"` when opening.

- [ ] **Step 4: Fold command events**

Extend `foldEvent`:

```ts
case "command/run": {
  const line = typeof event.data.line === "string" ? event.data.line : "";
  if (line === "") return entries;
  return [
    ...closeStreaming(entries),
    { role: "user", text: line, streaming: false },
  ];
}
```

Verify the actual DSH `command/run` payload field from the installed command package before coding; if it is named `command` or `input`, use that exact field and update the test fixture. `command/done` adds no transcript entry.

- [ ] **Step 5: Make serialization claim-aware**

Add:

```ts
export function serializeCommand(
  state: Pick<UiState, "draft" | "chips" | "commandClaim">,
): { line: string; images?: EncodedImageAttachment[] } | undefined;
```

It reuses normal file/folder chip serialization, requires the trimmed line to start with the claim token, and returns undefined if the claim is invalid. Image eligibility is checked in App before posting.

- [ ] **Step 6: Run store tests and typecheck**

Run:

```bash
pnpm --filter dsh exec vitest run src/webview/media/store.test.ts
pnpm --filter dsh run typecheck
```

- [ ] **Step 7: Commit-ready checkpoint**

Suggested commit if explicitly authorized: `feat(extension): model slash picker and command claims`

---

### Task 5: Accessible slash picker and Composer keyboard arbitration

**Files:**
- Create: `packages/extension/src/webview/media/components/SlashPicker.tsx`
- Create: `packages/extension/src/webview/media/components/SlashPicker.test.tsx`
- Modify: `packages/extension/src/webview/media/components/Composer.tsx`
- Modify: `packages/extension/src/webview/media/components/Composer.test.tsx`
- Modify: `packages/extension/src/webview/media/style.css`

**Interfaces:**
- Consumes: `SlashPickerState`.
- Produces Composer callbacks:

```ts
onMoveSlashHighlight(delta: -1 | 1): void;
onPickSlashItem(item: SlashMenuItem): void;
```

- [ ] **Step 1: Write picker component tests**

Assert:

- Commands and Skills headings render only for non-empty groups.
- Active row has `aria-selected="true"` and the expected stable id.
- `mousedown` calls `preventDefault` and `onPick`.
- One unavailable source renders a diagnostic only while the other has rows.
- Both empty/unavailable states render no selectable rows.

- [ ] **Step 2: Implement `SlashPicker`**

Use:

```tsx
<div className="dsh-slash-picker" role="listbox" id="dsh-slash-listbox">
  {groups.map((group) => (
    <section key={group.source}>
      <div className="dsh-slash-group-title">
        {group.source === "command" ? "Commands" : "Skills"}
      </div>
      {group.items.map((item) => (
        <button
          id={slashItemId(item)}
          role="option"
          aria-selected={itemKey(item) === highlightedKey}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(item);
          }}
        >
          <span>{`/${item.name}`}</span>
          <span>{item.description}</span>
        </button>
      ))}
    </section>
  ))}
</div>
```

Do not put a search input in this picker; typing continues in the composer textarea.

- [ ] **Step 3: Write Composer keyboard tests**

Pin:

- slash open + ArrowDown/ArrowUp moves highlight and prevents default;
- slash open + highlighted Enter picks and does not send;
- slash open + no highlight Enter sends normally;
- Shift+Enter never picks or sends;
- Escape dismisses slash picker;
- IME composing passes keys through;
- attachment picker preserves its current behavior;
- textarea exposes `role=combobox`, `aria-expanded`, `aria-controls`, and `aria-activedescendant` only for slash picker.

- [ ] **Step 4: Implement keyboard arbitration**

Order `onKeyDown` checks:

1. `e.nativeEvent.isComposing` → return.
2. Shift+Enter → return (native newline).
3. Slash picker ArrowUp/ArrowDown/Escape/highlighted Enter.
4. Existing Enter-to-send behavior.

Render `AttachmentPicker` only for `picker.kind === "attachment"` and `SlashPicker` only for `picker.kind === "slash"`. Show `commandClaim.hint` near the textarea without changing the draft.

- [ ] **Step 5: Add theme-aware CSS**

Reuse VS Code variables:

```css
.dsh-slash-picker {
  position: absolute;
  inset-inline: 8px;
  bottom: calc(100% + 6px);
  max-height: min(320px, 45vh);
  overflow-y: auto;
  background: var(--vscode-editorWidget-background);
  color: var(--vscode-editorWidget-foreground);
  border: 1px solid var(--vscode-editorWidget-border);
}

.dsh-slash-option[aria-selected="true"] {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}
```

Keep the overlay within narrow Cursor/VS Code sidebars.

- [ ] **Step 6: Run component tests**

Run:

```bash
pnpm --filter dsh exec vitest run \
  src/webview/media/components/SlashPicker.test.tsx \
  src/webview/media/components/Composer.test.tsx
```

- [ ] **Step 7: Commit-ready checkpoint**

Suggested commit if explicitly authorized: `feat(extension): render the slash menu`

---

### Task 6: App trigger and pick flow

**Files:**
- Modify: `packages/extension/src/webview/media/App.tsx`
- Create: `packages/extension/src/webview/media/App.test.tsx`
- Modify: `packages/extension/src/webview/media/store.test.ts`
- Modify: `packages/extension/src/webview/media/components/Composer.test.tsx`

**Interfaces:**
- Consumes Tasks 1–5.
- Produces webview commands:

```ts
post({ kind: "listSlashItems", requestId });
post({ kind: "executeSlashCommand", line, images });
```

- [ ] **Step 1: Add integrated App tests**

Cover:

1. Typing `/` while ready opens slash picker and posts one list request.
2. Typing more query text does not post another list request.
3. `@` wins over slash detection and opens attachment picker.
4. Skill pick mutates draft only.
5. Input command pick records claim; Send posts `executeSlashCommand`.
6. Bare command pick consumes token and posts immediately.
7. Remaining inline text is not submitted by a bare command pick.
8. Invalidated claim falls back to ordinary `submit`.
9. Disallowed image chips keep state and surface a local error.

Mock `acquireVsCodeApi().postMessage` before importing `App`, send host messages through `window.dispatchEvent(new MessageEvent("message", { data }))`, and assert posted `dsh/ui` envelopes. Use real reducer, token, filter, Composer, and SlashPicker code; mock only the host port.

- [ ] **Step 2: Refactor `onDraftChange` into explicit arbitration**

Use:

```ts
const attachment = tokenAt(text, selectionStart);
const slash = attachment === undefined
  ? activeSlashToken(text, selectionStart)
  : undefined;
```

Dispatch the appropriate open/change/dismiss action by `picker.kind`. Slash query changes reuse the current request id.

- [ ] **Step 3: Wire slash catalog effect**

Change the current picker effect:

```ts
if (picker?.kind === "attachment") {
  post({ kind: "listFileReferences", query: picker.query, requestId: picker.requestId });
}
if (picker?.kind === "slash") {
  post({ kind: "listSlashItems", requestId: picker.requestId });
}
```

The dependency remains `state.picker?.requestId`; slash query edits do not change it.

- [ ] **Step 4: Wire pick outcomes**

For `insert` and `command-input`, dispatch the reducer pick action and restore the textarea caret from the replacement result. For `execute`, dispatch token consumption then post:

```ts
post({ kind: "executeSlashCommand", line: `/${item.name}` });
```

For Send:

```ts
const command = serializeCommand(state);
if (command !== undefined) {
  if (command.images !== undefined && !state.commandClaim?.acceptsImages) {
    dispatch({ kind: "localError", detail: `/${state.commandClaim?.name} does not accept images` });
    return;
  }
  post({ kind: "executeSlashCommand", ...command });
  return;
}
post({ kind: "submit", ...serializeDraft(state) });
```

- [ ] **Step 5: Run extension tests**

Run:

```bash
pnpm --filter dsh run typecheck
pnpm --filter dsh run test
```

- [ ] **Step 6: Commit-ready checkpoint**

Suggested commit if explicitly authorized: `feat(extension): wire slash discovery and picks`

---

### Task 7: Bridge command execution and cancellation

**Files:**
- Create: `packages/bridge/src/slash-command.ts`
- Create: `packages/bridge/src/slash-command.test.ts`
- Modify: `packages/bridge/src/runner.ts`
- Modify: `packages/bridge/src/commands.ts`
- Modify: `packages/bridge/test/commands.test.ts`
- Modify: `packages/bridge/test/session-controller.test.ts`

**Interfaces:**
- Consumes: `EncodedImageAttachment`, `admitImages`, `ctx.commands`.
- Produces:

```ts
export interface SlashCommandExecutor {
  execute(line: string, images?: EncodedImageAttachment[]): void;
  cancel(): void;
  dispose(): void;
}

export function createSlashCommandExecutor(
  ctx: Context,
  currentAgent: () => Agent,
  send: (message: OutboundMessage) => void,
): SlashCommandExecutor;
```

`SessionController` gains:

```ts
executeSlashCommand(line: string, images?: EncodedImageAttachment[]): void;
```

- [ ] **Step 1: Write execution tests**

Assert:

- `/compact` calls `commands.execute` with the current Agent and no user message.
- `/goal ship` passes the full line.
- unknown command is rejected before `execute`.
- missing service sends `status:error`, code `command-rejected`.
- admitted image refs reach an image-capable command.
- malformed/disallowed images reject before execution.
- second execute while active rejects rather than running concurrently.
- cancel aborts the active signal.
- session replacement/dispose aborts execution.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @dsh-vscode/bridge exec vitest run src/slash-command.test.ts
```

- [ ] **Step 3: Implement executor**

Parse the first non-whitespace token:

```ts
const match = /^\/([a-z][a-z0-9_-]*)(?:\s|$)/.exec(line.trim());
```

Require the exact name in `commands.list(agent)`. Create one `AbortController`, admit images with `admitImages`, then call:

```ts
await commands.execute(agent, line.trim(), refs, controller.signal);
```

Use the installed package's exact `execute` signature; if image refs are wrapped in an envelope, adapt here and keep that dependency out of the protocol.

On validation/admission errors:

```ts
send({
  kind: "status",
  state: "error",
  code: "command-rejected",
  detail: error instanceof Error ? error.message : String(error),
});
```

On completion send idle only after DSH has emitted `command/done`.

- [ ] **Step 4: Wire dispatcher and runner lifecycle**

Add:

```ts
case "executeSlashCommand":
  hooks.runner.executeSlashCommand(msg.line, msg.images);
  return;
```

Make the existing `cancel()` abort both active image admission/agent turn and active slash command. Dispose catalog/executor before replacing the live Agent and recreate both against `() => live.handle.agent`.

- [ ] **Step 5: Verify session event ordering**

In a real command-runtime test, assert:

```ts
expect(eventTypes).toContain("command/run");
expect(eventTypes).toContain("command/done");
expect(eventTypes).not.toContain("user/message");
```

- [ ] **Step 6: Run bridge checks**

Run:

```bash
pnpm --filter @dsh-vscode/bridge run typecheck
pnpm --filter @dsh-vscode/bridge run test
pnpm --filter @dsh-vscode/bridge run build
```

- [ ] **Step 7: Commit-ready checkpoint**

Suggested commit if explicitly authorized: `feat(bridge): execute slash commands`

---

### Task 8: End-to-end verification and documentation

**Files:**
- Modify: `packages/extension/README.md`
- Test: `packages/extension/src/webview/media/App.test.tsx`
- Verify: `docs/superpowers/specs/2026-08-23-dsh-vscode-slash-menu-design.md`

**Interfaces:**
- Consumes: complete protocol v4 feature.
- Produces: packaged VSIX with a protocol-v4 bridge profile and documented behavior.

- [ ] **Step 1: Update README**

Document:

- `/` trigger boundaries;
- Commands and Skills grouping;
- arrow/Enter/Escape/Shift+Enter;
- bare, input-command, skill, and unknown-token outcomes;
- command image eligibility;
- unavailable-source behavior;
- command invocations appearing in resumed transcript history.

- [ ] **Step 2: Run the integrated App test**

The Task 6 App test must prove:

```text
type "/" → receive command + skill rows
pick skill → draft is "/skill "
pick input command → Send emits executeSlashCommand
pick bare command → executes immediately
command/run → transcript contains one user slash row
```

Run:

```bash
pnpm --filter dsh exec vitest run src/webview/media/App.test.tsx
```

Do not make the VS Code Extension Test host depend on a real command catalog or credentials; deterministic bridge behavior is covered by Tasks 3 and 7.

- [ ] **Step 3: Run all relevant checks**

Run:

```bash
pnpm -r run typecheck
pnpm -r run test
pnpm -r run build
git diff --check
```

Expected totals must include the new protocol, bridge, grammar/filter, reducer, picker, and integration tests with zero failures.

- [ ] **Step 4: Package and inspect**

Run:

```bash
pnpm --filter dsh run package
unzip -l packages/extension/dsh-0.1.0.vsix
```

Confirm `dist/extension.js`, `dist/webview.js`, `resources/dsh.svg`, and `resources/dsh.png` are present; source tests and full-color master artwork remain excluded.

- [ ] **Step 5: Manual smoke in one VS Code and one Cursor window**

For each editor:

1. Install the newly packaged VSIX and reload the window.
2. Open DSH and wait for Ready.
3. Type `/`; verify Commands then Skills.
4. Filter with a fuzzy command query and a skill prefix.
5. Use arrows + Enter to pick each behavior type.
6. Confirm bare command execution, command-input Send, skill prompt submission, Escape, and Shift+Enter.
7. Resume the session and confirm command invocation history.

- [ ] **Step 6: Final diff review**

Check:

```bash
git status --short
git diff --stat
git diff --check
```

Ensure no `.vsix`, `.DS_Store`, credentials, generated `lib/`, or unrelated changes are staged.

- [ ] **Step 7: Commit-ready checkpoint**

When the user explicitly requests commits, split by the independently reviewable boundaries above or make one feature commit if they request a single commit. Suggested final feature message: `feat(extension): add DSH slash command menu`.

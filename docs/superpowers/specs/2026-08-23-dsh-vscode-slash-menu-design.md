# DSH VS Code Slash Menu — Design Spec

**Date:** 2026-08-23
**Status:** Approved
**Classification:** Architectural (protocol v4 + bridge command/skill catalog and execution + webview trigger picker)
**Baseline:** `dsh-vscode-extension` `main` after retired-model reconciliation.

## 1. Goal

Give the VS Code and Cursor sidebar composer the same `/` discovery and selection semantics as DSH Web. Typing a live slash token shows session-scoped commands and user-invocable skills. Bare commands execute immediately, commands with input enter command mode, and skills insert slash text for normal prompt submission.

## 2. Non-goals

- Reusing DSH Web's React components, input machine, Typert remotes, popup controllers, or Cordis client events.
- Client-only command contributions and decorations used only by DSH Web.
- A launcher button for opening only the command group.
- `@` file-reference behavior changes.
- Lexicon-based decoration of slash names outside the active token.
- Subagent entries; DSH Web has a locale label but does not register a slash source for them.
- Compatibility with protocol v3. Extension and bridge move together.

## 3. Locked decisions

| Topic | Choice |
|---|---|
| Behavior | Match DSH Web selection semantics |
| Sources | Session-scoped DSH commands and user-invocable skills |
| Protocol | Bump `PROTOCOL_VERSION` to `4`; no compatibility shim |
| Service ownership | Bridge reads, normalizes, and executes DSH data |
| UI ownership | Webview detects tokens, filters, ranks, renders, and applies picks |
| Picker state | One discriminated `attachment \| slash` picker |
| Bare command pick | Consume active slash token and execute immediately |
| Input command pick | Replace token with `/name `, record a command claim, execute on Send |
| Skill pick | Replace token with `/name `; submit as an ordinary user message |
| Unknown slash line | Submit as an ordinary user message |
| Keyboard | Arrow highlight, Enter pick, Escape dismiss, Shift+Enter newline |
| Commands in transcript | Render `command/run` as a user slash turn. **Superseded** by [2026-08-25-dsh-vscode-agent-timeline-design.md](2026-08-25-dsh-vscode-agent-timeline-design.md): the stream uses a command card. Composer slash semantics in this spec are unchanged. |
| Missing services | Mark only the affected source unavailable; do not fail startup |

## 4. Architecture

The feature stays within the existing three runtime layers:

1. **Bridge** reads `ctx.commands` and `ctx.skills` against the live Agent, converts their descriptors into a dependency-free catalog, and executes command invocations.
2. **NDJSON contract** carries one merged slash catalog and explicit command execution requests.
3. **Webview** owns trigger detection, latest-request state, filtering, keyboard interaction, draft edits, and command-claim state.

The extension host remains a validated pass-through. Slash discovery does not require VS Code APIs or a host-only command.

### 4.1 Catalog item

The bridge projects commands and skills into:

```ts
interface SlashMenuItem {
  source: "command" | "skill";
  name: string;
  description: string;
  behavior: "execute" | "command-input" | "insert";
  hint?: string;
  acceptsImages?: boolean;
}
```

Mapping:

- Command without `input` → `behavior: "execute"`.
- Command with `input` → `behavior: "command-input"`, `hint` from `input.hint`, `acceptsImages` from `input.images`.
- User-invocable skill → `behavior: "insert"`.

The bridge must use the current live Agent when listing commands because command registration is session-scoped. Skill listing uses the live session cwd and current presenter scope, matching DSH Web's `skill.list` semantics. Skills that are not user-invocable are omitted.

Command and skill names may collide. They remain separate rows in separate groups because selection semantics differ.

### 4.2 Trigger detection

A slash token is active when the caret follows `/query` and:

- `/` is at the beginning of the draft, after whitespace, or after punctuation;
- `/` is not inside a word such as `a/b`;
- `/` is not the second slash in `//`;
- `/` is not part of a URL or drive prefix such as `https://` or `C:/`.

Detection scans backward from the caret to the first whitespace. It returns:

```ts
interface SlashToken {
  query: string;
  position: "leading" | "inline";
  start: number;
  end: number;
}
```

`leading` means the token begins the trimmed draft. Input-taking commands are excluded for inline tokens because their arguments claim the entire composer submission. Bare commands and skills may appear inline, matching DSH Web.

`@` takes priority when both grammars could match. Before the bridge is ready, typing remains unrestricted but no picker opens.

### 4.3 Catalog request and filtering

Opening a slash picker creates a new `requestId`. The webview sends `listSlashItems`; the bridge reads both sources and returns `slashItems`. The reducer accepts a reply only when its `requestId` matches the active slash picker. Query changes filter the accepted catalog locally and do not re-read providers. Closing and reopening always requests a fresh catalog, so registrations changed during the session become visible on the next open.

The bridge returns the full source catalogs for the open. The webview filters:

- Commands: case-insensitive fuzzy subsequence match with prefix-biased scoring, stable within equal scores.
- Skills: case-insensitive prefix match.
- Empty query: all eligible items in source order.
- Inline query: remove `command-input` items.

Groups appear as **Commands** then **Skills**. An unavailable source may show a non-selectable diagnostic row only when the other source has results; when both sources are unavailable or empty, the picker closes.

Catalog reads are latest-open-wins. The bridge aborts or suppresses a stale asynchronous skill read when another open supersedes it, and the reducer independently ignores stale replies.

### 4.4 Picker interaction

The slash overlay occupies the same composer overlay slot as the attachment picker. Focus stays in the textarea.

- Down/Up moves the highlight cyclically across selectable rows.
- Enter picks the highlighted row and prevents normal submit.
- Enter with no highlighted row follows ordinary submit behavior.
- Shift+Enter inserts a newline without picking.
- Escape closes the picker and leaves typed slash text intact.
- Pointer selection uses `mousedown` with `preventDefault` so textarea focus and caret survive.
- Pointer-down outside the overlay and composer closes it.
- Moving the caret out of the active token closes it.
- A catalog reply with no selectable rows closes it.

The default highlight is the first selectable row after each accepted catalog response. Query changes reset the highlight.

### 4.5 Selection outcomes

#### Skill

Replace `[token.start, token.end)` with `/name ` and place the caret after the space. Close the picker. The text remains ordinary draft content; Send follows the existing `submit` path. DSH's skill pre-step resolves the slash invocation and logs the resulting model-visible input.

#### Command with input

Replace the active token with `/name `, place the caret after the space, close the picker, and set:

```ts
interface CommandClaim {
  name: string;
  token: string;
  hint?: string;
  acceptsImages: boolean;
}
```

The composer shows `hint` as argument guidance. The claim remains valid only while the draft starts with exactly `token`. Editing or deleting that prefix clears the claim and restores ordinary prompt submission.

On Send with a valid claim:

1. Reject image chips when `acceptsImages` is false, retaining the draft and chips.
2. Serialize the draft with file/folder chip mentions exactly as normal submission does, then send `executeSlashCommand` with that full trimmed line and optional encoded image chips.
3. Enter the existing pending state so duplicate sends are blocked.
4. Clear the draft, claim, and accepted chips after the bridge acknowledges command start through `command/run`.
5. Return to idle after `command/done`; surface execution failure through the existing status channel.

#### Bare command

Remove the active token, close the picker, and send `executeSlashCommand` immediately with line `"/name"` and no images. Any text outside the consumed token remains in the draft. Bare command execution does not submit that remaining text.

### 4.6 Bridge command execution

`executeSlashCommand` resolves against `ctx.commands` and the current live Agent. The bridge:

1. Requires a mounted command service.
2. Requires the line to begin with a slash command name present in the current command catalog.
3. Admits encoded images through the existing image-admission path when present.
4. Calls `commands.execute(agent, line, imageRefs, signal)`.
5. Relies on DSH Commands to write `command/run` and `command/done`; it must not synthesize a `user/message`.

An active command execution has an `AbortController`. The existing Cancel action aborts it. New Session, Resume, disconnect, and runner disposal also abort it before replacing or disposing the live Agent.

Validation or admission failure sends `status:error` with code `command-rejected` and leaves the input command draft intact. Runtime execution failure is represented by DSH's command lifecycle and a visible error status.

### 4.7 Transcript projection

The webview reducer folds `command/run` for the current session into a non-streaming user entry containing the invocation line. `command/done` does not add a duplicate row. Any command-produced session events continue through their existing projections.

History folding applies the same rule, so resumed sessions show prior command invocations consistently.

## 5. Protocol (`PROTOCOL_VERSION = 4`)

### 5.1 Inbound

| kind | payload |
|---|---|
| `listSlashItems` | `{ requestId: string }` |
| `executeSlashCommand` | `{ line: string, images?: EncodedImageAttachment[] }` |

### 5.2 Outbound

| kind | payload |
|---|---|
| `slashItems` | `{ requestId: string, items: SlashMenuItem[], availability: { commands: boolean, skills: boolean } }` |

`availability.commands` or `.skills` is false when that service is missing or its list call fails. A successful empty list remains available.

Command execution uses the existing `event` and `status` messages; no duplicate command-result message is introduced.

### 5.3 Validation

Contract guards reject:

- unknown source, behavior, or position strings;
- empty item names;
- a skill item whose behavior is not `insert`;
- a command item whose behavior is `insert`;
- `command-input` without a non-empty hint;
- `acceptsImages` on non-command-input items;
- malformed request ids or image attachments;
- `executeSlashCommand.line` that is empty or does not start with `/`.

## 6. State model

`UiState.picker` becomes:

```ts
type PickerState = AttachmentPickerState | SlashPickerState;

interface SlashPickerState {
  kind: "slash";
  token: SlashToken;
  requestId: string;
  items: SlashMenuItem[];
  availability?: { commands: boolean; skills: boolean };
  highlightedKey?: string;
}
```

Every attachment-picker action narrows `picker.kind === "attachment"`. Slash actions follow the same open/dismiss/latest-reply discipline without sharing attachment-specific fields. Draft edits update the slash token and filtered rows without changing `requestId`.

`UiState.commandClaim` is independent of the picker and clears on invalidating draft edits, successful command start, session replacement, history load, host disconnect, or New Chat.

## 7. Failure behavior

- Missing command or skill service: affected group unavailable; other group remains usable.
- Catalog call failure: send an available=false source, not a process-level error.
- Stale catalog reply: ignored by bridge coordinator and reducer.
- Pick after token/caret revision changed: ignored; no draft edit or execution.
- Command service missing at execution: `command-rejected`; draft retained.
- Unknown command at execution: `command-rejected`; draft retained.
- Image admission failure: `command-rejected`; draft and chips retained.
- Execution cancellation: DSH lifecycle records cancellation; UI returns to idle.
- Protocol mismatch: existing mismatch diagnostic applies; v3 bridge and v4 extension are unsupported.

## 8. Testing

### Contract

- Accept complete v4 list, catalog, and execute messages.
- Reject every invalid discriminant and dependent-field combination.
- Pin protocol version 4.

### Bridge

- Merge commands and user-invocable skills with correct behavior mapping.
- Preserve command and skill name collisions as separate entries.
- Use the current live Agent and session cwd.
- Report each service's availability independently.
- Suppress stale asynchronous replies.
- Execute bare and input commands through `ctx.commands.execute`.
- Admit allowed images and reject disallowed/malformed images before execution.
- Abort execution on cancel, session replacement, and disconnect.
- Prove `command/run` and `command/done` are logged and no `user/message` is synthesized.

### Webview state and grammar

- DSH Web-compatible slash boundaries, URL suppression, positions, spans, and query extraction.
- Command fuzzy score and stable ordering; skill prefix filtering.
- Open, query change, dismissal, latest-request guard, and no-result close.
- Skill insertion, command claim, claim invalidation, bare-command consume.
- Command image eligibility and failure retention.
- `command/run` transcript/history projection.

### Components

- Group rendering and availability diagnostics.
- Default highlight, cyclic arrows, Enter pick, Shift+Enter newline, Escape, pointer pick, and outside dismiss.
- Textarea focus and caret retention.
- Accessibility roles: textarea combobox attributes, overlay listbox, selectable options, active descendant.

### Integrated flow

- Type `/`, receive commands and skills, pick each behavior type, and observe the correct bridge request or draft mutation.
- Switch sessions while a catalog request or command is active; no stale mutation reaches the new session.

## 9. Documentation

Update the extension README with trigger grammar, selection outcomes, command logging, unavailable-source behavior, and keyboard controls. Keep this spec as the rationale owner for protocol v4 and command-claim state.

# DSH VS Code Composer Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Plus-triggered picker that attaches workspace file/folder references and raster images to the next DSH message without losing the draft when admission fails.

**Architecture:** Protocol v3 carries cancellable file-reference searches and encoded image submissions over the existing NDJSON bridge. The bridge delegates path discovery to `ctx.fileReferences`, admits images through DSH’s attachment and model-capability services, and sends mixed text/image content. The extension host owns native dialogs; the reducer owns draft, picker, and chip state so submission clears only after `turn/start`.

**Tech Stack:** TypeScript, React 18 webview, VS Code Extension API, NDJSON protocol, Cordis services, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-dsh-vscode-composer-attachments-design.md`

## Global Constraints

- Protocol and both endpoints move together to `PROTOCOL_VERSION = 3`; do not add compatibility shims.
- Files and folders are model-visible canonical `@path` text, not binary uploads.
- Image MIME is limited to `image/png`, `image/jpeg`, `image/webp`, and `image/gif`.
- Search ranking, exclusions, and limits belong to `@deepseek-ai/dsh-file-reference-local`.
- Image count, bytes, pixels, dimensions, and media limits belong to `ctx.attachments.imageLimits`.
- Native filesystem dialogs remain host-only and must never enter `InboundMessage`.
- An image-admission failure emits `status:error` with `code: "submit-rejected"`, calls no `followup`, and retains text and chips.
- `newSession`, `resume`, and `history` clear draft chips; foreign-session events do not.
- Keep host-side absolute paths out of image names and protocol errors.
- Run the narrow package test after each red/green cycle; run workspace typecheck and tests before the final commit.

---

## File Responsibility Map

- `packages/contract/src/protocol.ts`: dependency-free v3 wire records and boundary guards.
- `packages/extension/src/webview/media/fileMention.ts`: browser-safe copy of the DSH `@` token grammar.
- `packages/bridge/src/file-references.ts`: one cancellable search coordinator over `ctx.fileReferences`.
- `packages/bridge/src/image-admission.ts`: wire-image validation, route capability check, and durable save.
- `packages/bridge/src/runner.ts`: session-scoped orchestration; consumes the two helpers and builds user content.
- `packages/extension/src/webview/attachments.ts`: pure host helpers for cwd-relative folders and encoded images.
- `packages/extension/src/webview/panel.ts`: native dialog orchestration only.
- `packages/extension/src/webview/media/store.ts`: durable webview draft/picker/chip transaction state.
- `packages/extension/src/webview/media/components/AttachmentPicker.tsx`: picker presentation and interaction.
- `packages/extension/src/webview/media/components/ChipRail.tsx`: removable reference/image chips and thumbnail URL lifecycle.
- `packages/extension/src/webview/media/components/Composer.tsx`: controlled textarea and toolbar composition.

---

### Task 1: Canonical Mention Grammar and Protocol v3

**Files:**
- Create: `packages/extension/src/webview/media/fileMention.ts`
- Create: `packages/extension/src/webview/media/fileMention.test.ts`
- Modify: `packages/contract/src/protocol.ts`
- Modify: `packages/contract/src/protocol.test.ts`

**Interfaces:**
- Produces:
  - `activeAtToken(line: string, cursorCol: number): ActiveAtToken | undefined`
  - `formatFileMention(candidate: FileReferenceItem, preserveQuote: boolean): string | undefined`
  - `EncodedImageAttachment`
  - `FileReferenceItem`
  - inbound `ListFileReferencesCommand`
  - outbound `FileReferencesMessage`
  - `SubmitCommand.images?: EncodedImageAttachment[]`

- [ ] **Step 1: Add failing grammar tests**

Copy the behavioral cases from the harness grammar, not its package dependency:

```ts
import { describe, expect, it } from "vitest";
import { activeAtToken, formatFileMention } from "./fileMention.js";

describe("activeAtToken", () => {
  it("detects plain and quoted tokens only at a token boundary", () => {
    expect(activeAtToken("read @src/in", 12)).toEqual({
      prefix: "@src/in", query: "src/in", quoted: false,
    });
    expect(activeAtToken('read @"src/my f', 15)).toEqual({
      prefix: '@"src/my f', query: "src/my f", quoted: true,
    });
    expect(activeAtToken("a@b.com", 7)).toBeUndefined();
  });
});

describe("formatFileMention", () => {
  it("quotes whitespace, appends a directory slash, and rejects controls", () => {
    expect(formatFileMention({ path: "src/a.ts", kind: "file" }, false)).toBe("@src/a.ts");
    expect(formatFileMention({ path: "my file.ts", kind: "file" }, false)).toBe('@"my file.ts"');
    expect(formatFileMention({ path: "src", kind: "directory" }, false)).toBe("@src/");
    expect(formatFileMention({ path: "bad\nname", kind: "file" }, false)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the grammar test and verify red**

Run: `pnpm --dir packages/extension vitest run src/webview/media/fileMention.test.ts`

Expected: FAIL because `fileMention.ts` does not exist.

- [ ] **Step 3: Implement the browser-safe grammar**

Copy `ActiveAtToken`, `activeAtToken`, and `formatFileMention` behavior from `deepseek-harness/packages/context/file-reference/src/grammar.ts`. Import `FileReferenceItem` as a type from the contract. Add a module comment naming the harness source and stating that tests intentionally lock parity.

- [ ] **Step 4: Run the grammar test and verify green**

Run: `pnpm --dir packages/extension vitest run src/webview/media/fileMention.test.ts`

Expected: PASS.

- [ ] **Step 5: Add failing protocol-v3 tests**

Extend `protocol.test.ts`:

```ts
it("uses protocol v3", () => {
  expect(PROTOCOL_VERSION).toBe(3);
});

it("accepts reference search and raster image submit records", () => {
  expect(isInboundMessage({
    kind: "listFileReferences", query: "src", requestId: "r1",
  })).toBe(true);
  expect(isOutboundMessage({
    kind: "fileReferences", requestId: "r1",
    items: [{ path: "src", kind: "directory" }],
  })).toBe(true);
  expect(isInboundMessage({
    kind: "submit",
    text: "describe this",
    images: [{ mediaType: "image/png", data: "AQ==", name: "a.png" }],
  })).toBe(true);
});

it("rejects invalid image media types at the wire boundary", () => {
  expect(isInboundMessage({
    kind: "submit",
    text: "",
    images: [{ mediaType: "image/svg+xml", data: "PHN2Zz4=" }],
  })).toBe(false);
});
```

- [ ] **Step 6: Run contract tests and verify red**

Run: `pnpm --dir packages/contract test`

Expected: FAIL on version 2 and unknown kinds.

- [ ] **Step 7: Implement protocol v3 and payload-aware validation**

Add:

```ts
export type ImageMediaType =
  | "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export interface EncodedImageAttachment {
  mediaType: ImageMediaType;
  data: string;
  name?: string;
}

export interface FileReferenceItem {
  path: string;
  kind: "file" | "directory";
}

export interface ListFileReferencesCommand {
  kind: "listFileReferences";
  query: string;
  requestId: string;
}

export interface FileReferencesMessage {
  kind: "fileReferences";
  requestId: string;
  items: FileReferenceItem[];
  available?: boolean;
}
```

Set `PROTOCOL_VERSION = 3`, add the kinds to the unions and kind rolls, and validate the new payloads. For `submit`, require string `text`; when `images` exists, require an array whose records use one of the four MIME values, string `data`, and absent-or-string `name`. Do not broaden validation of unrelated v2 records in this task.

- [ ] **Step 8: Run contract and grammar tests**

Run:

```bash
pnpm --dir packages/contract test
pnpm --dir packages/extension vitest run src/webview/media/fileMention.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/contract/src/protocol.ts packages/contract/src/protocol.test.ts \
  packages/extension/src/webview/media/fileMention.ts \
  packages/extension/src/webview/media/fileMention.test.ts
git commit -m "feat: define composer attachment protocol v3"
```

---

### Task 2: Bridge File-Reference Search and Profile Mount

**Files:**
- Create: `packages/bridge/src/file-references.ts`
- Create: `packages/bridge/src/file-references.test.ts`
- Modify: `packages/bridge/src/runner.ts`
- Modify: `packages/bridge/src/commands.ts`
- Modify: `packages/bridge/test/commands.test.ts`
- Modify: `packages/bridge/cordis.patch.yml`
- Modify: `packages/bridge/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `ListFileReferencesCommand`, `FileReferenceItem`
- Produces:
  - `createFileReferenceSearch(ctx, currentAgent, send): FileReferenceSearch`
  - `FileReferenceSearch.list(query: string, requestId: string): void`
  - `FileReferenceSearch.dispose(): void`
  - `SessionController.listFileReferences(query: string, requestId: string): void`

- [ ] **Step 1: Write failing coordinator tests**

Use a mock service and deferred promises:

```ts
it("aborts the previous query and emits only the latest result", async () => {
  const calls: AbortSignal[] = [];
  const service = {
    list: vi.fn(async (_agent, query: string, signal: AbortSignal) => {
      calls.push(signal);
      await Promise.resolve();
      signal.throwIfAborted();
      return [{ path: query, kind: "file" as const }];
    }),
  };
  const sent: OutboundMessage[] = [];
  const search = createFileReferenceSearch(
    contextWithFileReferences(service), agent, (message) => sent.push(message),
  );
  search.list("old", "r1");
  search.list("new", "r2");
  await vi.waitFor(() => expect(sent).toContainEqual({
    kind: "fileReferences", requestId: "r2",
    items: [{ path: "new", kind: "file" }],
  }));
  expect(calls[0]?.aborted).toBe(true);
  expect(sent.some((message) =>
    message.kind === "fileReferences" && message.requestId === "r1"
  )).toBe(false);
});

it("reports unavailable when the service is absent", async () => {
  // Expect { kind: "fileReferences", requestId: "r1", items: [], available: false }.
});
```

- [ ] **Step 2: Run the coordinator test and verify red**

Run: `pnpm --dir packages/bridge vitest run src/file-references.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the coordinator**

`createFileReferenceSearch` stores one `AbortController`. `list` aborts it, creates the next controller, reads `ctx.get("fileReferences")`, calls `service.list(currentAgent(), query, signal)`, and sends only if that controller is still current and not aborted. Missing service or non-abort rejection sends:

```ts
{
  kind: "fileReferences",
  requestId,
  items: [],
  available: false,
}
```

`dispose()` aborts and clears the current request. `currentAgent` is a callback so session replacement does not leave the helper pointing at a disposed agent.

- [ ] **Step 4: Run the coordinator test and verify green**

Run: `pnpm --dir packages/bridge vitest run src/file-references.test.ts`

Expected: PASS.

- [ ] **Step 5: Add failing command-dispatch coverage**

Extend the `CommandHooks.runner` stub and assert:

```ts
dispatchCommand(ctx, {
  kind: "listFileReferences", query: "src", requestId: "r1",
}, hooks);
expect(hooks.runner.listFileReferences).toHaveBeenCalledWith("src", "r1");
```

- [ ] **Step 6: Run command tests and verify red**

Run: `pnpm --dir packages/bridge vitest run test/commands.test.ts`

Expected: FAIL because `SessionController` lacks the method and dispatch has no case.

- [ ] **Step 7: Wire the coordinator into the runner**

Add `listFileReferences(query, requestId)` to `SessionController`. Construct the coordinator after `live` exists:

```ts
const fileReferenceSearch = createFileReferenceSearch(
  ctx,
  () => live.handle.agent,
  (message) => io.send(message),
);
```

Return `listFileReferences: fileReferenceSearch.list`. Abort the coordinator inside lifecycle replacement before the old agent is disposed and in runner teardown if a teardown seam exists; otherwise `replaceLive` and process disconnect are the two owners. Add the exhaustive dispatch case.

- [ ] **Step 8: Mount and declare the provider**

In `cordis.patch.yml`, insert before `vscode-runner`:

```yaml
- id: file-reference-local
  name: '@deepseek-ai/dsh-file-reference-local'
```

Add direct dependencies:

```json
"@deepseek-ai/dsh-file-reference": "^0.1.0-rc.8",
"@deepseek-ai/dsh-file-reference-local": "^0.1.0-rc.8"
```

Run `pnpm install` from the repository root; do not hand-edit `pnpm-lock.yaml`.

- [ ] **Step 9: Run bridge tests and typecheck**

Run:

```bash
pnpm --dir packages/bridge test
pnpm --dir packages/bridge typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/bridge/src/file-references.ts \
  packages/bridge/src/file-references.test.ts packages/bridge/src/runner.ts \
  packages/bridge/src/commands.ts packages/bridge/test/commands.test.ts \
  packages/bridge/cordis.patch.yml packages/bridge/package.json pnpm-lock.yaml
git commit -m "feat(bridge): serve workspace attachment references"
```

---

### Task 3: Bridge Image Admission and Mixed User Messages

**Files:**
- Create: `packages/bridge/src/image-admission.ts`
- Create: `packages/bridge/src/image-admission.test.ts`
- Modify: `packages/bridge/src/runner.ts`
- Modify: `packages/bridge/test/session-controller.test.ts`
- Modify: `packages/bridge/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `EncodedImageAttachment[]`, current live `Agent`, `ctx.attachments`, `ctx.llm`
- Produces:
  - `admitImages(ctx: Context, agent: Agent, images: readonly EncodedImageAttachment[], signal: AbortSignal): Promise<readonly ImageAttachmentRef[]>`
  - `SubmitOptions.images?: readonly EncodedImageAttachment[]`

- [ ] **Step 1: Write failing image-admission tests**

Test the ACP-equivalent obligations without importing ACP internals:

```ts
it("decodes canonical images, verifies model support, and saves one batch", async () => {
  const saveImages = vi.fn(async () => [IMAGE_REF]);
  const ctx = imageContext({
    attachments: { saveImages, imageLimits: LIMITS },
    modelInfo: { inputModalities: ["text", "image"] },
  });
  await expect(admitImages(ctx, agent, [{
    mediaType: "image/png", data: "AQ==", name: "/private/a.png",
  }], new AbortController().signal)).resolves.toEqual([IMAGE_REF]);
  expect(saveImages).toHaveBeenCalledWith([{
    mediaType: "image/png",
    data: Uint8Array.of(1),
    name: "a.png",
  }]);
});

it("rejects non-canonical base64 before persistence", async () => {
  const ctx = imageContext({
    attachments: { saveImages: vi.fn(), imageLimits: LIMITS },
    modelInfo: { inputModalities: ["text", "image"] },
  });
  await expect(admitImages(ctx, agent, [{
    mediaType: "image/png", data: "A===",
  }], new AbortController().signal)).rejects.toThrow("canonical base64");
  expect(ctx.attachments.saveImages).not.toHaveBeenCalled();
});

it("rejects a route without image input before persistence", async () => {
  const saveImages = vi.fn();
  const ctx = imageContext({
    attachments: { saveImages, imageLimits: LIMITS },
    modelInfo: { inputModalities: ["text"] },
  });
  await expect(admitImages(ctx, agent, [{
    mediaType: "image/png", data: "AQ==",
  }], new AbortController().signal)).rejects.toThrow("does not declare image input");
  expect(saveImages).not.toHaveBeenCalled();
});
```

The helper must strip path components from `name` even though the host already does so.

- [ ] **Step 2: Run the helper tests and verify red**

Run: `pnpm --dir packages/bridge vitest run src/image-admission.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement image admission**

Port the narrow policy from `deepseek-harness/packages/acp/acp/src/content.ts`:

- strict RFC 4648 canonical base64 regex and decode/re-encode equality;
- current route from `session.requestHeader()?.config`, then agent options;
- `ctx.llm.resolveModelInfo(provider, model, signal)` and `inputModalities.includes("image")`;
- `ctx.attachments.saveImages(inputs)`;
- `signal.throwIfAborted()` before and after persistence;
- safe errors with no base64 or absolute path included.

Use `basename(name)` before passing `name` to the store. Add `@deepseek-ai/dsh-attachment` as a direct dependency and run `pnpm install`.

- [ ] **Step 4: Run helper tests and verify green**

Run: `pnpm --dir packages/bridge vitest run src/image-admission.test.ts`

Expected: PASS.

- [ ] **Step 5: Add failing runner tests**

Extend the session-controller fixture with injectable attachments and image-capable model metadata. Assert:

```ts
controller.submit("look", {
  images: [{ mediaType: "image/png", data: "AQ==", name: "a.png" }],
});
await waitFor(() => userMessages(session).length === 1);
expect(userMessages(session)[0]?.data.content).toEqual([
  { type: "text", text: "look" },
  { type: "image", attachment: IMAGE_REF },
]);
```

Add an admission-failure case:

```ts
controller.submit("keep me", { images: [TOO_LARGE_IMAGE] });
await waitFor(() => messages.some((m) =>
  m.kind === "status" && m.code === "submit-rejected"
));
expect(agent.followup).not.toHaveBeenCalled();
```

Also test image-only submit creates content with one image block and no empty text block.

- [ ] **Step 6: Run runner tests and verify red**

Run: `pnpm --dir packages/bridge vitest run test/session-controller.test.ts`

Expected: FAIL because submit ignores images.

- [ ] **Step 7: Integrate admission into submit**

Extend `SubmitOptions`, create one admission controller for the active queued submit, and cancel it from `cancel`, `replaceLive`, and process teardown. After model/permission preflight and before `followup`:

```ts
let refs: readonly ImageAttachmentRef[] = [];
try {
  refs = opts.images?.length
    ? await admitImages(ctx, current.handle.agent, opts.images, admission.signal)
    : [];
} catch (error) {
  sendError(error, "submit-rejected");
  return;
}
const content: ContentBlock[] = [];
if (text.trim() !== "") content.push({ type: "text", text: text.trim() });
content.push(...refs.map((attachment) => ({ type: "image" as const, attachment })));
if (content.length === 0) {
  sendError(new Error("message has no text or images"), "submit-rejected");
  return;
}
current.handle.agent.followup(createUserMessage({
  content,
  source: { kind: "user" },
}));
```

Change `sendError` to accept optional `code` and place it on `StatusMessage`. Preserve existing picker preflight behavior: model/permission errors still revert their controls and continue with the message; only image admission rejects the whole submit.

- [ ] **Step 8: Forward images from command dispatch**

Include `images` in the options only when present:

```ts
...(msg.images !== undefined ? { images: msg.images } : {}),
```

Update `commands.test.ts` to assert exact forwarding.

- [ ] **Step 9: Run bridge tests and typecheck**

Run:

```bash
pnpm --dir packages/bridge test
pnpm --dir packages/bridge typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/bridge/src/image-admission.ts \
  packages/bridge/src/image-admission.test.ts packages/bridge/src/runner.ts \
  packages/bridge/src/commands.ts packages/bridge/test/commands.test.ts \
  packages/bridge/test/session-controller.test.ts packages/bridge/package.json \
  pnpm-lock.yaml
git commit -m "feat(bridge): admit image attachments on submit"
```

---

### Task 4: Extension Host Folder and Image Dialogs

**Files:**
- Create: `packages/extension/src/webview/attachments.ts`
- Create: `packages/extension/test/attachments.test.ts`
- Modify: `packages/extension/src/webview/media/vscode.ts`
- Modify: `packages/extension/src/webview/panel.ts`

**Interfaces:**
- Produces:
  - host commands `{ kind: "browseFolder" }`, `{ kind: "attachImage" }`
  - `relativeFolderPath(cwd: string, selected: string): string | undefined`
  - `encodeImage(uri: vscode.Uri): Promise<EncodedImageAttachment>`
  - host messages `FolderPickedMessage`, `ImagesPickedMessage`

- [ ] **Step 1: Write failing pure host-helper tests**

```ts
describe("relativeFolderPath", () => {
  it("normalizes descendants to posix paths and represents the cwd as dot", () => {
    expect(relativeFolderPath("/work/app", "/work/app")).toBe(".");
    expect(relativeFolderPath("/work/app", "/work/app/src/lib")).toBe("src/lib");
    expect(relativeFolderPath("/work/app", "/work/other")).toBeUndefined();
  });
});

describe("encodeImageBytes", () => {
  it("maps supported extensions, emits canonical base64, and strips paths", () => {
    expect(encodeImageBytes(Uint8Array.of(1), "/private/a.png")).toEqual({
      mediaType: "image/png", data: "AQ==", name: "a.png",
    });
  });
  it("rejects svg and unknown extensions", () => {
    expect(() => encodeImageBytes(new Uint8Array(), "a.svg")).toThrow(
      "Unsupported image type",
    );
  });
});
```

Keep byte encoding in a Node-only pure helper (`Buffer.from(bytes).toString("base64")`); `encodeImage(uri)` only performs `vscode.workspace.fs.readFile`.

- [ ] **Step 2: Run helper tests and verify red**

Run: `pnpm --dir packages/extension vitest run test/attachments.test.ts`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement helpers**

Use `node:path.relative`, `node:path.isAbsolute`, and a segment-boundary check; never use string prefix alone (`/work/app2` is outside `/work/app`). Convert separators to `/`. Map `.jpg` and `.jpeg` to `image/jpeg`; map `.png`, `.webp`, `.gif` directly.

- [ ] **Step 4: Run helper tests and verify green**

Run: `pnpm --dir packages/extension vitest run test/attachments.test.ts`

Expected: PASS.

- [ ] **Step 5: Add host-only command and response types**

In `vscode.ts`, add to `UiCommandCmd`:

```ts
| { kind: "browseFolder" }
| { kind: "attachImage" }
```

Define and export:

```ts
export interface FolderPickedMessage {
  kind: "folderPicked";
  path: string;
}
export interface ImagesPickedMessage {
  kind: "imagesPicked";
  images: EncodedImageAttachment[];
}
```

- [ ] **Step 6: Implement dialog handlers in `panel.ts`**

Handle both kinds before `isInboundMessage`:

```ts
if (kind === "browseFolder") {
  void this.browseFolder();
  return;
}
if (kind === "attachImage") {
  void this.attachImages();
  return;
}
```

`browseFolder()` requires `this.hello?.cwd` or the latest `ready.cwd`; call `showOpenDialog` with folder-only options; cancel is silent; outside cwd posts `{ kind: "status", state: "error", detail: "Folder is outside the session workspace" }`; success posts `folderPicked`.

`attachImages()` uses:

```ts
{
  canSelectFiles: true,
  canSelectFolders: false,
  canSelectMany: true,
  filters: { Images: ["png", "jpg", "jpeg", "webp", "gif"] },
}
```

Encode every URI independently. Post one `status:error` per failed filename without its absolute parent path, then post `imagesPicked` with successful records if non-empty.

- [ ] **Step 7: Typecheck and run extension tests**

Run:

```bash
pnpm --dir packages/extension typecheck
pnpm --dir packages/extension test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/extension/src/webview/attachments.ts \
  packages/extension/test/attachments.test.ts \
  packages/extension/src/webview/media/vscode.ts \
  packages/extension/src/webview/panel.ts
git commit -m "feat(extension): add native attachment dialogs"
```

---

### Task 5: Draft, Picker, and Chip Reducer Transactions

**Files:**
- Modify: `packages/extension/src/webview/media/store.ts`
- Modify: `packages/extension/src/webview/media/store.test.ts`

**Interfaces:**
- Consumes: `FileReferencesMessage`, `FolderPickedMessage`, `ImagesPickedMessage`
- Produces:
  - `DraftChip = ReferenceChip | ImageChip`
  - `PickerState`
  - reducer-local messages `draftChanged`, `pickerOpened`, `pickerQueryChanged`, `pickerDismissed`, `referencePicked`, `chipRemoved`, `submitStarted`
  - `serializeDraft(state: Pick<UiState, "draft" | "chips">): { text: string; images?: EncodedImageAttachment[] }`

- [ ] **Step 1: Add failing reducer tests for picker correlation**

```ts
it("opens at an @ token and ignores stale search replies", () => {
  const opened = reduce(initialState, {
    kind: "pickerOpened",
    text: "read @src",
    token: { start: 5, end: 9, query: "src", quoted: false },
    requestId: "r2",
  });
  const stale = reduce(opened, {
    kind: "fileReferences", requestId: "r1",
    items: [{ path: "old", kind: "file" }],
  });
  expect(stale).toBe(opened);
});
```

Add cases for `available: false`, query updates replacing only the tracked token, and dismiss removing a lonely `@` but retaining `@src` typed by the user.

- [ ] **Step 2: Add failing reducer tests for chips and serialization**

Cover:

- file/folder pick removes the trigger span and appends one chip;
- folder-picked host message formats `@path/`;
- image picks append in order;
- remove by id;
- text + mentions spacing;
- image-only serialization omits an empty text payload at bridge level but returns `text: ""`;
- `session` change and `history` clear chips and draft;
- foreign-session `event` leaves chips unchanged.

Example:

```ts
expect(serializeDraft({
  draft: "review this",
  chips: [
    { id: "c1", kind: "file", path: "src/a.ts", mention: "@src/a.ts", label: "a.ts" },
    { id: "c2", kind: "image", image: PNG, label: "shot.png" },
  ],
})).toEqual({
  text: "review this @src/a.ts",
  images: [PNG],
});
```

- [ ] **Step 3: Add failing submit-transaction tests**

```ts
it("retains draft on submit rejection and clears on current-session turn start", () => {
  const pending = reduce(stateWithDraftAndChips, { kind: "submitStarted" });
  const rejected = reduce(pending, {
    kind: "status", state: "error",
    code: "submit-rejected", detail: "model has no image input",
  });
  expect(rejected.draft).toBe("look");
  expect(rejected.chips).toHaveLength(1);
  expect(rejected.submitPending).toBe(false);

  const accepted = reduce(pending, currentEvent("turn/start"));
  expect(accepted.draft).toBe("");
  expect(accepted.chips).toEqual([]);
});
```

Also assert a foreign-session `turn/start` does not clear.

- [ ] **Step 4: Run store tests and verify red**

Run: `pnpm --dir packages/extension vitest run src/webview/media/store.test.ts`

Expected: FAIL because draft/picker/chip state and local messages do not exist.

- [ ] **Step 5: Implement reducer state and helpers**

Add:

```ts
export interface ReferenceChip {
  id: string;
  kind: "file" | "folder";
  path: string;
  mention: string;
  label: string;
}
export interface ImageChip {
  id: string;
  kind: "image";
  image: EncodedImageAttachment;
  label: string;
}
export type DraftChip = ReferenceChip | ImageChip;

export interface PickerState {
  requestId: string;
  query: string;
  quoted: boolean;
  tokenStart: number;
  tokenEnd: number;
  items: FileReferenceItem[];
  unavailable: boolean;
}
```

Extend `UiState` with `draft`, `chips`, `picker`, and `submitPending`. Use deterministic IDs from local messages (components mint via `crypto.randomUUID()`); the reducer remains pure.

`serializeDraft` joins non-empty trimmed body and reference mentions with single spaces; image chips preserve rail order. `turn/start` clears only if `submitPending` and event session matches. `status:error` with `code === "submit-rejected"` unlocks but retains; other errors also unlock without clearing.

- [ ] **Step 6: Run store tests and verify green**

Run: `pnpm --dir packages/extension vitest run src/webview/media/store.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/extension/src/webview/media/store.ts \
  packages/extension/src/webview/media/store.test.ts
git commit -m "feat(extension): model attachment draft transactions"
```

---

### Task 6: Composer Picker, Chip Rail, App Wiring, and Documentation

**Files:**
- Create: `packages/extension/src/webview/media/components/AttachmentPicker.tsx`
- Create: `packages/extension/src/webview/media/components/ChipRail.tsx`
- Create: `packages/extension/src/webview/media/components/AttachmentPicker.test.tsx`
- Create: `packages/extension/src/webview/media/components/ChipRail.test.tsx`
- Modify: `packages/extension/src/webview/media/components/Composer.tsx`
- Modify: `packages/extension/src/webview/media/App.tsx`
- Modify: `packages/extension/src/webview/media/style.css`
- Modify: `packages/extension/README.md`
- Modify: `packages/extension/package.json` only if jsdom/component test dependencies are missing
- Modify: `pnpm-lock.yaml` only through `pnpm install`

**Interfaces:**
- Consumes: Task 5 reducer state/messages and `serializeDraft`
- Produces: visible Plus button, overlay, chip rail, and end-to-end webview commands

- [ ] **Step 1: Add component-test support only if needed**

Check whether `@testing-library/react` and jsdom are already resolvable. If missing:

```bash
pnpm --dir packages/extension add -D @testing-library/react jsdom
```

Do not add a browser component library.

- [ ] **Step 2: Write failing picker interaction tests**

Use `// @vitest-environment jsdom` on line 1:

```tsx
it("offers native actions and closes on Escape", () => {
  const onDismiss = vi.fn();
  render(<AttachmentPicker
    query=""
    items={[{ path: "src", kind: "directory" }]}
    unavailable={false}
    onQuery={vi.fn()}
    onPick={vi.fn()}
    onBrowseFolder={vi.fn()}
    onAttachImage={vi.fn()}
    onDismiss={onDismiss}
  />);
  expect(screen.getByRole("button", { name: "Browse folders…" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Attach image…" })).toBeVisible();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onDismiss).toHaveBeenCalled();
});
```

Add unavailable-state and file/folder-label cases. Test pointer-down outside with a wrapper ref, following `Header.tsx`.

- [ ] **Step 3: Write failing chip-rail tests**

Assert basename labels, full mention tooltip, remove callback, image thumbnail alt, and cleanup:

```tsx
const revoke = vi.spyOn(URL, "revokeObjectURL");
const { unmount } = render(<ChipRail chips={[imageChip]} onRemove={vi.fn()} />);
unmount();
expect(revoke).toHaveBeenCalled();
```

Stub `URL.createObjectURL` and convert base64 to `Blob` inside the image-chip component.

- [ ] **Step 4: Run component tests and verify red**

Run:

```bash
pnpm --dir packages/extension vitest run \
  src/webview/media/components/AttachmentPicker.test.tsx \
  src/webview/media/components/ChipRail.test.tsx
```

Expected: FAIL because components do not exist.

- [ ] **Step 5: Implement `AttachmentPicker` and `ChipRail`**

Picker:

- `role="dialog"` and list `role="listbox"`;
- focused search input;
- two fixed host-action rows;
- max-height list with unavailable/empty copy;
- Escape and outside pointer-down dismissal;
- no raw HTML path insertion.

Rail:

- file/folder/image glyphs;
- `<button aria-label={`Remove ${label}`}>`;
- image thumbnail blob URL created in `useEffect` and revoked on cleanup/change;
- no absolute image path in title.

- [ ] **Step 6: Convert `Composer` to controlled props**

Remove local `useState`. Add exact props:

```ts
draft: string;
chips: DraftChip[];
picker: PickerState | undefined;
submitPending: boolean;
onDraftChange(text: string, selectionStart: number): void;
onOpenPicker(selectionStart: number): void;
onPickerQuery(query: string): void;
onPickReference(item: FileReferenceItem): void;
onDismissPicker(): void;
onRemoveChip(id: string): void;
onBrowseFolder(): void;
onAttachImage(): void;
onSubmit(): void;
```

Keep a textarea ref. The Plus button is inside `.dsh-composer-actions`, immediately before the meter:

```tsx
<button
  className="dsh-icon-button"
  type="button"
  title="Attach"
  aria-label="Attach files, folders, or images"
  disabled={!ready}
  onClick={() => onOpenPicker(inputRef.current?.selectionStart ?? draft.length)}
>
  <PlusIcon />
</button>
```

Disable Send when not ready, `submitPending`, or `serializeDraft` has empty text and no images. Keep Stop behavior while thinking.

- [ ] **Step 7: Wire App messages and transaction**

In `App.tsx`:

- dispatch host `folderPicked` / `imagesPicked` through the existing message listener;
- when picker opens/query changes, post `listFileReferences` with the reducer’s request ID and query;
- `browseFolder` / `attachImage` post host-only commands;
- reference pick uses `formatFileMention`, dispatches chip, and closes;
- submit computes `serializeDraft(state)`, dispatches `submitStarted`, then posts `{ kind: "submit", ...payload }`;
- do not clear draft in `Composer`.

Use an effect keyed by `state.picker?.requestId` to post the search once per request:

```ts
useEffect(() => {
  const picker = state.picker;
  if (picker !== undefined) {
    post({
      kind: "listFileReferences",
      query: picker.query,
      requestId: picker.requestId,
    });
  }
}, [post, state.picker?.requestId]);
```

- [ ] **Step 8: Add styles**

Add:

- `.dsh-attachment-picker`: absolute above composer, `left/right: 8px`, capped width, panel background, border, shadow, z-index above stream;
- `.dsh-attachment-actions`, `.dsh-attachment-list`, `.dsh-attachment-row`;
- `.dsh-chip-rail`, `.dsh-chip`, `.dsh-chip-thumbnail`, `.dsh-chip-remove`;
- horizontal wrap/scroll that does not increase the composer beyond a practical maximum;
- host focus-ring overrides on the new search input and remove buttons, following the existing explicit `:focus { outline: none }` rule.

Do not reintroduce a full composer focus border.

- [ ] **Step 9: Run focused and full extension verification**

Run:

```bash
pnpm --dir packages/extension vitest run \
  src/webview/media/fileMention.test.ts \
  src/webview/media/store.test.ts \
  src/webview/media/components/AttachmentPicker.test.tsx \
  src/webview/media/components/ChipRail.test.tsx
pnpm --dir packages/extension typecheck
pnpm --dir packages/extension test
```

Expected: PASS.

- [ ] **Step 10: Update README**

In the usage/features section, document:

- Plus opens workspace file/folder search and native image selection;
- file/folder chips are sent as `@path` references and DSH reads contents only when needed;
- image support depends on the selected model declaring image input and on DSH attachment limits.

- [ ] **Step 11: Build and package smoke**

Run:

```bash
pnpm -r build
pnpm --dir packages/extension package
```

Expected: `packages/extension/dsh-0.1.0.vsix` includes updated `dist/extension.js`, `dist/webview.js`, and `dist/style.css`.

- [ ] **Step 12: Commit**

```bash
git add packages/extension/src/webview/media/components/AttachmentPicker.tsx \
  packages/extension/src/webview/media/components/AttachmentPicker.test.tsx \
  packages/extension/src/webview/media/components/ChipRail.tsx \
  packages/extension/src/webview/media/components/ChipRail.test.tsx \
  packages/extension/src/webview/media/components/Composer.tsx \
  packages/extension/src/webview/media/App.tsx \
  packages/extension/src/webview/media/style.css \
  packages/extension/README.md packages/extension/package.json pnpm-lock.yaml
git commit -m "feat(extension): add composer attachment picker"
```

---

### Task 7: Cross-Layer Verification and Installed-Editor Smoke

**Files:**
- Modify only files required by failures found in this verification task.

**Interfaces:**
- Consumes: protocol v3, bridge search/admission, host dialogs, webview draft UI
- Produces: one verified installable VSIX

- [ ] **Step 1: Run all static and unit checks**

Run:

```bash
pnpm -r typecheck
pnpm -r test
git diff --check
```

Expected: contract, bridge, and extension suites all pass; no whitespace errors.

- [ ] **Step 2: Run the extension-host smoke**

Run: `pnpm --dir packages/extension test:e2e`

Expected: VS Code launches, extension activates, and `dsh.start` / `dsh.stop` pass. If the test runner’s downloaded macOS application uses `Code` rather than `Electron`, fix the runner setup in source; do not create a manual symlink outside the repository as the final solution.

- [ ] **Step 3: Install the VSIX into Cursor and VS Code**

Run:

```bash
cursor --install-extension packages/extension/dsh-0.1.0.vsix --force
code --install-extension packages/extension/dsh-0.1.0.vsix --force
```

Reload one window in each editor.

- [ ] **Step 4: Perform the manual acceptance script**

In each editor:

1. Open DSH Chat; Plus is left of the context meter.
2. Press Plus; textarea contains `@`; picker opens above composer.
3. Search for `package.json`; select it; picker closes and a removable chip appears.
4. Press Plus; Browse folders…; select a child folder; a folder chip appears.
5. Press Plus; Attach image…; select PNG; a thumbnail chip appears.
6. Send with text; transcript begins a turn and draft/chips clear on `turn/start`.
7. Select a text-only model, attach an image, Send; visible image-input error appears and draft/chips remain.
8. Remove image and retry; the message sends.
9. New Chat; chip rail is empty.
10. Type `@` manually; picker opens; Escape closes and removes the lonely `@`.

- [ ] **Step 5: Inspect process cleanup**

After closing the test editor windows:

```bash
ps -Ao pid,ppid,command | awk '/[d]sh --profile vscode/ && $2==1'
```

Expected: no orphaned vscode-profile child.

- [ ] **Step 6: Commit verification fixes if any**

If verification changed files:

```bash
git status --short
# Add each path reported above individually after confirming it is a
# verification fix; never stage unrelated user work.
git add packages/contract/src/protocol.ts
git commit -m "fix: complete composer attachment integration"
```

The `git add` line names the most likely verification surface; replace it with
the exact reported attachment-integration paths when a different file required
the fix. If no files changed, do not create an empty commit.

---

## Plan Self-Review Results

- **Spec coverage:** Every requirement in spec sections 3–10 maps to Tasks 1–7. Native dialogs are Task 4; file service mount is Task 2; durable image admission is Task 3; draft retention is Task 5; visible UI and docs are Task 6; installed-editor behavior is Task 7.
- **Placeholder scan:** No incomplete instructions, deferred work, unspecified error-handling steps, or undefined task dependencies remain.
- **Type consistency:** `EncodedImageAttachment`, `FileReferenceItem`, `listFileReferences`, `fileReferences`, `submit-rejected`, `DraftChip`, `PickerState`, and `serializeDraft` use the same names throughout.
- **Risk resolution:** The plan does not import ACP’s unpublished internal helper. `image-admission.ts` ports its narrow policy locally while consuming the maintained attachment/LLM services. Draft clear is acknowledged by current-session `turn/start`, not optimistic click-time mutation.

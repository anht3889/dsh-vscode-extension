# DSH VS Code Composer Attachments — Design Spec

**Date:** 2026-08-22
**Status:** Approved
**Classification:** Architectural (protocol v3 + bridge file-reference/image admission + webview picker)
**Baseline:** `dsh-vscode-extension` `main` after chat-chrome and focus-ring fixes.

## 1. Goal

Let the sidebar composer attach workspace files, workspace folders, and raster images to the next send. Files and folders become DSH `@path` mentions on removable chips. Images become durable attachment objects admitted by DSH, not path text.

## 2. Non-goals

- Video or audio upload.
- Keeping the picker open for multi-select; checkboxes; an explicit Add button.
- Rebuilding the web `@` trigger pipeline (`ui-input-trigger`) inside the VS Code webview.
- Host HTTP RPC / JSON-RPC SDK.
- Changing DSH image limits, file-search exclusions, or mention grammar.
- Settings UI.

## 3. Locked decisions

| Topic | Choice |
|---|---|
| Integration | Bridge-backed unified picker (option 1) |
| File / folder appearance | Removable chip; submitted as canonical `@path` |
| Image appearance | Removable thumbnail chip; submitted as image content |
| Picker contents | Searchable workspace files and folders, plus Browse folders… and Attach image… |
| After a pick | Close the picker; Plus again to add another |
| Types in v1 | Files, folders, and raster images (`png` / `jpeg` / `webp` / `gif`) |
| Workspace `.png` from the list | Path mention, not a vision upload |
| Protocol | Bump `PROTOCOL_VERSION` to `3` |
| Native dialogs | Host-only; never forwarded to the bridge |
| Image persistence | Bytes stay in the webview draft until Send; DSH `saveImages` runs at submit |

## 4. Architecture

Layers stay as they are. New work is confined to:

1. **Webview** — Plus button, picker overlay, chip rail, draft serialization.
2. **Extension host** — folder dialog, image-file dialog, cwd-relative path conversion, image-byte read, host-only commands.
3. **Bridge** — `ctx.fileReferences.list`, image admission matching ACP, mixed `followup` content.
4. **Profile** — insert `@deepseek-ai/dsh-file-reference-local` into the vscode patch. `attachment-local` already rides `dsh-base`.

Do not duplicate DSH ranking, exclusions, quoting, or image validation in the extension.

### 4.1 Plus and `@`

Plus sits immediately left of the context-usage circle, same 28px icon button as header actions. Disabled until `ready`.

On press:

1. Focus the textarea.
2. Insert `@` at the caret unless an active `@` token already ends there (`activeAtToken` from `@deepseek-ai/dsh-file-reference/grammar`).
3. Open the picker overlay above the composer, inset 8px from both panel edges.

Typing `@` in the textarea (active token at the caret) opens the same overlay and binds search to that token’s query. Escape or pointer-down outside the overlay closes it. A leftover lonely `@` (token is only `@`, no chips added in that open) is removed on dismiss.

### 4.2 Overlay

- Search field, focused, bound to the active `@` query.
- Row **Browse folders…** — host `showOpenDialog` with `canSelectFolders: true`, `canSelectFiles: false`.
- Row **Attach image…** — host `showOpenDialog` with image filters for png/jpeg/webp/gif, `canSelectMany: true` allowed for that dialog only; each selected file becomes one image chip, then the overlay closes.
- Scrollable list of `{ path, kind }` from the latest `fileReferences` reply. Files and folders are labeled distinctly. Directory pick still **closes** the overlay.

An in-flight list is aborted when the query changes (`requestId` correlation; stale replies ignored).

### 4.3 Chips

A rail above the textarea holds chips in insertion order. File/folder chips show a glyph, basename, and remove control; the chip stores the canonical mention from `formatFileMention`. Image chips show a thumbnail from a blob URL created in the webview, basename, and remove; the chip stores `{ mediaType, data, name? }`.

`newSession`, `resume`, and `history` clear the rail. Nested-session events do not.

Send is enabled when DSH is ready and the serialized `text` is non-empty or at least one image chip exists. File/folder chips serialize to their mentions, so chips with an empty textarea still enable send.

Remove drops that chip from the next send. Blob URLs for removed or cleared images are revoked.

### 4.4 Submit serialization

Webview builds one `submit`:

- `text` = typed body with the active `@` token replaced by nothing, plus each file/folder mention in chip order, separated by spaces from the body as needed so mentions remain tokens (`(?:^|\s)@…`). Mentions that `formatFileMention` cannot represent are refused at pick time, not at send.
- `images` = encoded chips in chip order, omitted when empty.

The runner:

1. If `images` is present and non-empty, admit like ACP (`admitAcpPrompt` policy): canonical base64, declared MIME in the raster set, `ctx.attachments` required, current model must declare `image` input, then `saveImages`.
2. Build `ContentBlock[]`: optional text block from trimmed `text`, then image blocks in order.
3. `followup(createUserMessage({ content, source: { kind: "user" } }))`.

Admission failure: `status:error`, no `followup`, chips and text retained.

## 5. Protocol (`PROTOCOL_VERSION = 3`)

### 5.1 Inbound (webview → host → bridge)

| kind | payload |
|---|---|
| `listFileReferences` | `{ query: string, requestId: string }` |
| `submit` | existing fields plus optional `images?: EncodedImageAttachment[]` |

`EncodedImageAttachment`: `{ mediaType: "image/png" \| "image/jpeg" \| "image/webp" \| "image/gif", data: string, name?: string }`.

`query` is the path text after `@` or `@"`, possibly empty.

### 5.2 Outbound (bridge → extension → webview)

| kind | payload |
|---|---|
| `fileReferences` | `{ requestId: string, items: FileReferenceItem[], available?: boolean }` |

`FileReferenceItem`: `{ path: string, kind: "file" \| "directory" }`.

`available: false` means the service is missing or the list call failed; `items` is empty. Treat omitted `available` as `true` when `items` arrives from a successful list.

### 5.3 Host-only UI commands (never reach the bridge)

| kind | host action | webview follow-up |
|---|---|---|
| `browseFolder` | `showOpenDialog` folders | `{ kind: "folderPicked", path }` or nothing on cancel |
| `attachImage` | `showOpenDialog` images | `{ kind: "imagesPicked", images: EncodedImageAttachment[] }` or nothing on cancel |

Host-to-webview pick results are `UiMessage` variants handled only by the store, not `OutboundMessage` kinds. Cancelled dialogs are silent (no error).

Folder path: if the absolute folder is the session cwd, the relative path is `.` and the directory mention is `@./`. If it is a descendant, convert to a posix-relative path with `/` separators and no leading `./`. Otherwise `status:error` “Folder is outside the session workspace” and no chip.

Image path: host reads bytes, infers MIME from extension then verifies against the four raster types, encodes canonical base64, strips directory from `name`. Unreadable or non-raster files are skipped with `status:error` naming the file; remaining files in a multi-select still attach.

## 6. Profile

`packages/bridge/cordis.patch.yml` inserts `@deepseek-ai/dsh-file-reference-local` so `ctx.fileReferences` exists. `@dsh-vscode/bridge` depends on that package (and `@deepseek-ai/dsh-file-reference` for grammar if the webview cannot import it — grammar is browser-safe; the webview may copy the two functions into the extension package to avoid bundling the whole harness graph). **Choice: copy `activeAtToken` and `formatFileMention` into `packages/extension/src/webview/media/fileMention.ts` with tests**, rather than adding a harness dependency to the webview bundle. Behavior must stay identical; comment the source package and grammar rules.

`dsh-base` already mounts `attachment-local`. If `ctx.attachments` is absent at submit with images, fail loud with `status:error`.

## 7. Error handling

| Failure | User-visible behavior |
|---|---|
| Plus before `ready` | Button disabled |
| `fileReferences` missing / list throws | Overlay: native rows remain; list area “File search unavailable”; `available: false` |
| Stale `fileReferences` reply | Ignored |
| Folder outside cwd | `status:error`; no chip |
| Native dialog cancel | No message, picker stays as it was (already closed after the row click) |
| Image MIME / base64 / limits / no image input / no store | `status:error`; chips and text kept; no `followup` |
| `formatFileMention` undefined | Do not add the chip; `status:error` that the path cannot be referenced |

## 8. Testing

- **Contract:** v3 kinds; `submit.images` optional; guards accept valid / reject unknown MIME.
- **fileMention.ts:** `activeAtToken` and `formatFileMention` cases matching harness grammar tests (plain, quoted whitespace, directory trailing slash, control characters refused).
- **Bridge:** list maps `fileReferences.list`; abort superseded query; missing service → `available: false`; mentions-only submit; images admitted then mixed content; admission failure does not `followup`.
- **Host (unit where dialogs are injected):** cwd-relative folder; outside cwd error; image encode; dialogs not forwarded as inbound protocol.
- **Store:** picker open/close; chip add/remove; session change clears chips; serialize mentions + images; lonely `@` stripped on dismiss; send enabled with image-only chips.
- **No new keyless snapshot** unless a runnable example’s transcript gains `@path` or image content in this PR. Package tests cover the change.

## 9. Files (expected)

- `packages/contract/src/protocol.ts` — v3, new kinds, `submit.images`
- `packages/bridge/src/runner.ts`, `commands.ts`, `cordis.patch.yml`, `package.json`
- `packages/extension/src/webview/panel.ts` — host dialogs
- `packages/extension/src/webview/media/vscode.ts` — host-only cmds
- `packages/extension/src/webview/media/fileMention.ts` — copied grammar
- `packages/extension/src/webview/media/components/Composer.tsx`, `AttachmentPicker.tsx`, `ChipRail.tsx`
- `packages/extension/src/webview/media/{App,store,style}.*`
- Tests beside each of the above

## 10. Implementation order

1. Grammar copy + contract v3 + tests.
2. Bridge list + submit images + profile plugin + tests.
3. Host dialogs + forwarding.
4. Webview Plus, overlay, chips, store tests.
5. Extension README note that Plus attaches files/folders/images.

## 11. Open implementation details (non-blocking)

- Exact basename display vs full relative path on the chip (spec: basename; tooltip is the mention or path).
- Whether Attach image `canSelectMany` stays true (spec: true).
- Whether an empty query lists a default ranking from `fileReferences.list("", …)` (spec: yes; that is what the service already does).

import { isAbsolute, join, resolve } from "node:path";
import type { SessionEventWire, ToolDiff } from "@dsh-vscode/contract";
// Type-only namespace import: erased at runtime (vitest never resolves `vscode`),
// but provides the `vscode.*` type annotations used inside `applyDiffs`. The
// runtime values come from the dynamic `import("vscode")` below.
import type * as vscode from "vscode";

// ---- pure diff extraction (TDD'd; no `vscode` import here) -----------------
//
// A `tool/result` can expose diffs through legacy metadata or arguments and
// through its presenter result view. Everything is defensive — a missing
// `data` or `meta` yields `[]` rather than throwing, and there is no hard dep on
// the dsh-tool-fs runtime.

/** Extract a single render-ready diff from a `data.meta` record, if diff-shaped. */
function diffFromMeta(data: Record<string, unknown>): ToolDiff | undefined {
  const meta = data.meta;
  if (typeof meta !== "object" || meta === null) return undefined;
  const m = meta as Record<string, unknown>;
  if (
    typeof m.path === "string" &&
    typeof m.oldText === "string" &&
    typeof m.newText === "string"
  ) {
    return { path: m.path, oldText: m.oldText, newText: m.newText };
  }
  return undefined;
}

/** Extract a diff from str-replace-editor `arguments` when `data.meta` is absent. */
function diffFromArguments(data: Record<string, unknown>): ToolDiff | undefined {
  const args = data.arguments;
  if (typeof args !== "object" || args === null) return undefined;
  const a = args as Record<string, unknown>;
  if (
    typeof a.path === "string" &&
    typeof a.oldText === "string" &&
    typeof a.newText === "string"
  ) {
    return { path: a.path, oldText: a.oldText, newText: a.newText };
  }
  return undefined;
}

/**
 * Extract legacy and presenter `ToolDiff[]` from a session event in source
 * order. Returns an empty array for every event that is not a qualifying
 * `tool/result`, never throws.
 */
export function diffsFromEvent(event: SessionEventWire): ToolDiff[] {
  if (typeof event !== "object" || event === null) return [];
  if (event.type !== "tool/result") return [];
  const data = event.data;
  if (typeof data !== "object" || data === null) return [];

  const diffs: ToolDiff[] = [];
  const legacy = diffFromMeta(data) ?? diffFromArguments(data);
  if (legacy !== undefined) diffs.push(legacy);

  if (event.view?.for === "result" && event.view.view.card === "diff") {
    for (const diff of event.view.view.diffs) {
      const normalized = {
        path: diff.path,
        oldText: diff.oldText ?? "",
        newText: diff.newText,
      };
      if (
        !diffs.some((candidate) =>
          candidate.path === normalized.path &&
          candidate.oldText === normalized.oldText &&
          candidate.newText === normalized.newText
        )
      ) {
        diffs.push(normalized);
      }
    }
  }

  return diffs;
}

// ---- editor application (vscode runtime; typecheck-only) --------------------
//
// `vscode` is the VS Code host's ambient module (provided at extension runtime,
// not resolvable as an npm package). It is imported *dynamically* inside
// `applyDiffs` so that importing `diffsFromEvent` (in vitest) does not drag in
// the `vscode` module. `applyDiffs` is typecheck-only, mirroring Task 8's
// panel.ts treatment.

/**
 * Anchor a `ToolDiff.path` to the workspace folder root (pure; no `vscode`).
 * `ToolDiff.path` comes from dsh-tool-fs / str-replace-editor and is emitted
 * workspace-relative; `vscode.Uri.file()` otherwise resolves against the
 * extension's process CWD (which is *not* the workspace folder), so relative
 * paths must be joined to the workspace root before constructing a `Uri`. Absolute
 * paths (already rooted) pass through unchanged. A `undefined` root means no
 * workspace folder is open: the relative path is resolved against the process CWD
 * as a fallback.
 */
export function resolveDiffPath(
  path: string,
  workspaceRoot: string | undefined,
): string {
  if (isAbsolute(path)) return path;
  if (workspaceRoot !== undefined) return join(workspaceRoot, path);
  return resolve(path);
}

/**
 * Convert each `ToolDiff` into a `WorkspaceEdit` replacement and apply it.
 * Uses a per-file range replace when `oldText` locates a unique span in the
 * current document, falling back to a full-document replace otherwise. A
 * non-existent path is treated as a newly-created file. Returns `true` iff
 * `vscode.workspace.applyEdit` reports success.
 */
export async function applyDiffs(diffs: ToolDiff[]): Promise<boolean> {
  const vscode = await import("vscode");
  const edit = new vscode.WorkspaceEdit();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  for (const diff of diffs) {
    const uri = vscode.Uri.file(resolveDiffPath(diff.path, workspaceRoot));

    let doc: vscode.TextDocument | undefined;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      doc = undefined;
    }

    if (doc === undefined) {
      // File does not exist yet (e.g. a newly-created file): create it and write
      // the target text in full.
      edit.createFile(uri, { ignoreIfExists: true });
      edit.insert(uri, new vscode.Position(0, 0), diff.newText);
      continue;
    }

    const text = doc.getText();
    let range: vscode.Range;
    if (diff.oldText.length > 0) {
      const idx = text.indexOf(diff.oldText);
      range =
        idx >= 0
          ? new vscode.Range(
              doc.positionAt(idx),
              doc.positionAt(idx + diff.oldText.length),
            )
          : new vscode.Range(doc.positionAt(0), doc.positionAt(text.length));
    } else {
      range = new vscode.Range(doc.positionAt(0), doc.positionAt(text.length));
    }
    edit.replace(uri, range, diff.newText);
  }

  return vscode.workspace.applyEdit(edit);
}

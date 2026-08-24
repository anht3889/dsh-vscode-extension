import type { SessionEventWire, ToolDiff } from "./events.js";
import { isToolEventView } from "./protocol.js";

// The single derivation of a `tool/result`'s applyable diffs. The extension host
// (Apply-all `pending`) and the webview (row diffs plus the current-turn apply
// buffer) both call it, so what a row shows and what Apply all writes can never
// diverge.

/** Read a `{ path, oldText, newText }` diff out of a legacy metadata record. */
function diffFromRecord(value: unknown): ToolDiff | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fields = value as Record<string, unknown>;
  if (
    typeof fields.path === "string" &&
    typeof fields.oldText === "string" &&
    typeof fields.newText === "string"
  ) {
    return {
      path: fields.path,
      oldText: fields.oldText,
      newText: fields.newText,
    };
  }
  return undefined;
}

function same(left: ToolDiff, right: ToolDiff): boolean {
  return (
    left.path === right.path &&
    left.oldText === right.oldText &&
    left.newText === right.newText
  );
}

/**
 * Extract the normalized, deduplicated diffs one session event carries.
 *
 * Legacy `data.meta` / `data.arguments` diffs come first (source order), then
 * every `DiffResultView` diff the presenter attached, with a created file's
 * `oldText: null` normalized to `""`. An event that is not a `tool/result`, a
 * result without diffs, and a structurally invalid `view` all yield `[]` rather
 * than throwing.
 *
 * @param event - one wire session event, trusted only for `type`.
 * @returns the diffs to display and apply, in source order without repeats.
 */
export function toolDiffsFromEvent(event: SessionEventWire): ToolDiff[] {
  if (event.type !== "tool/result") return [];
  const data: unknown = event.data;
  if (typeof data !== "object" || data === null) return [];
  const fields = data as Record<string, unknown>;

  const diffs: ToolDiff[] = [];
  const legacy = diffFromRecord(fields.meta) ?? diffFromRecord(fields.arguments);
  if (legacy !== undefined) diffs.push(legacy);

  const view: unknown = event.view;
  if (
    isToolEventView(view) &&
    view.for === "result" &&
    view.view.card === "diff"
  ) {
    for (const diff of view.view.diffs) {
      const normalized: ToolDiff = {
        path: diff.path,
        oldText: diff.oldText ?? "",
        newText: diff.newText,
      };
      if (!diffs.some((candidate) => same(candidate, normalized))) {
        diffs.push(normalized);
      }
    }
  }

  return diffs;
}

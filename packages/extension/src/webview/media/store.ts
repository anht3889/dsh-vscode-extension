import type {
  AskQuestionWire,
  OutboundMessage,
  ToolDiff,
} from "@dsh-vscode/contract";

// ---- webview UI state -------------------------------------------------------
//
// The reducer is pure and TDD'd (store.test.ts); the React components in this
// directory are view-layer consumers wired but not unit-tested (typechecked only,
// matching Task 8's panel.ts treatment).

export interface ApprovalState {
  askId: string;
  questions: AskQuestionWire[];
}

export interface UiState {
  /** Assistant text accumulated from `assistant/chunk` + `assistant/message`. */
  stream: string[];
  /** The current pending approval (set by `ask`, kept until the matching answer). */
  approval: ApprovalState | undefined;
  /** File diffs extracted from `tool/result` events for DiffView. */
  diffs: ToolDiff[];
}

export const initialState: UiState = {
  stream: [],
  approval: undefined,
  diffs: [],
};

/**
 * Extract assistant text from an event's verbatim `data` record, tolerant of the
 * two shapes the bridge forwards: `assistant/chunk` ({text, delta?}) and
 * `assistant/message` ({message:{content:[{type:"text",text}]}}).
 */
function assistantText(data: Record<string, unknown>): string | undefined {
  const text = data.text;
  if (typeof text === "string" && text.length > 0) return text;
  const message = data.message;
  if (typeof message === "object" && message !== null) {
    const content = (message as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (
          typeof part === "object" &&
          part !== null &&
          (part as { type?: unknown }).type === "text"
        ) {
          const t = (part as { text?: unknown }).text;
          if (typeof t === "string" && t.length > 0) return t;
        }
      }
    }
  }
  return undefined;
}

/**
 * Extract a render-ready diff from a `tool/result` event's `data.meta` when it
 * carries a `{ path, oldText, newText }` shape (dsh-tool-fs / str-replace-editor).
 * Returns undefined for non-diff metas (best-effort, no hard dep on dsh-tool-fs).
 */
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

/**
 * Fold one outbound message into the UI state. Pure: returns a new object when
 * the message is handled, the same object (reference-equal) when it is not.
 */
export function reduce(state: UiState, msg: OutboundMessage): UiState {
  switch (msg.kind) {
    case "ask":
      return { ...state, approval: { askId: msg.askId, questions: msg.questions } };

    case "event": {
      const type = msg.event.type;
      if (type === "turn/start") {
        // New turn: reset per-turn accumulation so a fresh turn does not re-render
        // (or re-apply) the previous turn's diffs. Mirrors the extension host,
        // which clears its own `pending` on `turn/start`.
        return { ...state, stream: [], diffs: [] };
      }
      if (type === "assistant/chunk" || type === "assistant/message") {
        const text = assistantText(msg.event.data);
        if (text !== undefined) {
          return { ...state, stream: [...state.stream, text] };
        }
        return state;
      }
      if (type === "tool/result") {
        const diff = diffFromMeta(msg.event.data);
        if (diff !== undefined) {
          return { ...state, diffs: [...state.diffs, diff] };
        }
        return state;
      }
      return state;
    }

    default:
      return state;
  }
}

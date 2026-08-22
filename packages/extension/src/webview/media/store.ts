import type {
  AskQuestionWire,
  CatalogPayload,
  ContextPayload,
  OutboundMessage,
  PermissionsPayload,
  SessionEventWire,
  SessionListItem,
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
  /** Last surfaced error (e.g. child process crashed, handshake failed). */
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
}

export const initialState: UiState = {
  stream: [],
  approval: undefined,
  diffs: [],
  error: undefined,
  starting: true,
  ready: false,
  status: "idle",
  sessionId: undefined,
  sessions: [],
  sessionsUnavailable: false,
  models: undefined,
  permissions: undefined,
  context: undefined,
};

/** Host-only lifecycle message sent when the retained DSH child exits. */
export interface HostDisconnectedMessage {
  kind: "hostDisconnected";
  detail: string;
}

/** Webview-local acknowledgement that an ask answer was sent to the host. */
export interface AskSettledMessage {
  kind: "askSettled";
  askId: string;
}

/** Messages accepted by the webview reducer. */
export type UiMessage =
  | OutboundMessage
  | HostDisconnectedMessage
  | AskSettledMessage;

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

function eventText(event: SessionEventWire): string | undefined {
  if (event.type !== "assistant/chunk" && event.type !== "assistant/message") {
    return undefined;
  }
  return assistantText(event.data);
}

/** Filter recent sessions by case-insensitive title text. */
export function filterSessions(
  items: SessionListItem[],
  query: string,
): SessionListItem[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return items;
  return items.filter((item) =>
    item.title.toLowerCase().includes(normalized),
  );
}

/** Convert next-request context pressure to a capped whole percentage. */
export function contextPercent(
  context: ContextPayload | undefined,
): number | undefined {
  if (context === undefined || context.window <= 0) return undefined;
  return Math.min(100, Math.round((100 * context.used) / context.window));
}

/**
 * Fold one outbound message into the UI state. Pure: returns a new object when
 * the message is handled, the same object (reference-equal) when it is not.
 */
export function reduce(state: UiState, msg: UiMessage): UiState {
  switch (msg.kind) {
    case "askSettled":
      if (state.approval?.askId !== msg.askId) return state;
      return { ...state, approval: undefined, status: "thinking" };

    case "hostDisconnected":
      return {
        ...state,
        starting: false,
        ready: false,
        status: "error",
        error: msg.detail,
      };

    case "ask":
      return {
        ...state,
        approval: { askId: msg.askId, questions: msg.questions },
        status: "awaiting-approval",
      };

    case "ready":
      return {
        ...state,
        starting: false,
        ready: true,
        status: "idle",
        error: undefined,
        sessionId: msg.sessionId,
        models: msg.models,
        permissions: msg.permissions,
        context: msg.context,
      };

    case "sessions":
      return {
        ...state,
        sessions: msg.items,
        sessionsUnavailable: msg.available === false,
      };

    case "catalog":
      return {
        ...state,
        models: { current: msg.current, models: msg.models },
      };

    case "permissions":
      return {
        ...state,
        permissions: { current: msg.current, presets: msg.presets },
      };

    case "context":
      return { ...state, context: { used: msg.used, window: msg.window } };

    case "session": {
      const changed = state.sessionId !== msg.sessionId;
      return {
        ...state,
        sessionId: msg.sessionId,
        ...(changed
          ? {
              stream: [],
              diffs: [],
              approval: undefined,
              context: undefined,
            }
          : {}),
      };
    }

    case "history":
      return {
        ...state,
        sessionId: msg.sessionId,
        stream: msg.events
          .map(eventText)
          .filter((text): text is string => text !== undefined),
        diffs: [],
        approval: undefined,
      };

    case "status":
      // Surfaced (not silently swallowed): a crashed child or failed startup is
      // relayed as status:error and rendered by App as a visible error banner.
      if (msg.state === "error") {
        return {
          ...state,
          error: msg.detail ?? "DSH reported an error",
          starting: false,
          status: "error",
        };
      }
      if (msg.state === "idle") {
        return {
          ...state,
          approval: undefined,
          error: undefined,
          status: "idle",
        };
      }
      return { ...state, status: msg.state };

    case "event": {
      const type = msg.event.type;
      if (type === "turn/start") {
        return {
          ...state,
          approval: undefined,
          diffs: [],
          status: "thinking",
        };
      }
      if (type === "turn/end") {
        return { ...state, approval: undefined, status: "idle" };
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

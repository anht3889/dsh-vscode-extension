import type {
  AskQuestionWire,
  CatalogPayload,
  ContextPayload,
  EncodedImageAttachment,
  FileReferenceItem,
  OutboundMessage,
  PermissionsPayload,
  SessionEventWire,
  SessionListItem,
  ToolDiff,
} from "@dsh-vscode/contract";
import type {
  FolderPickedMessage,
  ImagesPickedMessage,
} from "./vscode.js";
import { formatFileMention } from "./fileMention.js";

// ---- webview UI state -------------------------------------------------------
//
// The reducer is pure and TDD'd (store.test.ts); the React components in this
// directory are view-layer consumers wired but not unit-tested (typechecked only,
// matching Task 8's panel.ts treatment).

export interface ApprovalState {
  askId: string;
  questions: AskQuestionWire[];
}

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
  draft: string;
  chips: DraftChip[];
  picker: PickerState | undefined;
  submitPending: boolean;
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
  draft: "",
  chips: [],
  picker: undefined,
  submitPending: false,
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

interface ActivePickerToken {
  start: number;
  end: number;
  query: string;
  quoted: boolean;
}

interface DraftChangedMessage {
  kind: "draftChanged";
  text: string;
}

interface PickerOpenedMessage {
  kind: "pickerOpened";
  text: string;
  token: ActivePickerToken;
  requestId: string;
}

interface PickerQueryChangedMessage {
  kind: "pickerQueryChanged";
  query: string;
  requestId: string;
}

interface PickerDismissedMessage {
  kind: "pickerDismissed";
}

interface ReferencePickedMessage {
  kind: "referencePicked";
  id: string;
  item: FileReferenceItem;
}

interface ChipRemovedMessage {
  kind: "chipRemoved";
  id: string;
}

interface SubmitStartedMessage {
  kind: "submitStarted";
}

/** Messages accepted by the webview reducer. */
export type UiMessage =
  | OutboundMessage
  | HostDisconnectedMessage
  | AskSettledMessage
  | FolderPickedMessage
  | ImagesPickedMessage
  | DraftChangedMessage
  | PickerOpenedMessage
  | PickerQueryChangedMessage
  | PickerDismissedMessage
  | ReferencePickedMessage
  | ChipRemovedMessage
  | SubmitStartedMessage;

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
 * Extract a render-ready diff record from tool result metadata or arguments.
 */
function diffFromRecord(value: unknown): ToolDiff | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.path === "string" &&
    typeof record.oldText === "string" &&
    typeof record.newText === "string"
  ) {
    return {
      path: record.path,
      oldText: record.oldText,
      newText: record.newText,
    };
  }
  return undefined;
}

function diffFromEventData(data: Record<string, unknown>): ToolDiff | undefined {
  return diffFromRecord(data.meta) ?? diffFromRecord(data.arguments);
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

/** Build the next submit payload from the current body and attachment rail. */
export function serializeDraft(
  state: Pick<UiState, "draft" | "chips">,
): { text: string; images?: EncodedImageAttachment[] } {
  const text = [
    state.draft.trim(),
    ...state.chips
      .filter((chip): chip is ReferenceChip => chip.kind !== "image")
      .map((chip) => chip.mention),
  ]
    .filter((part) => part !== "")
    .join(" ");
  const images = state.chips
    .filter((chip): chip is ImageChip => chip.kind === "image")
    .map((chip) => chip.image);
  return images.length === 0 ? { text } : { text, images };
}

function labelFromPath(path: string): string {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
}

function nextChipId(state: UiState, prefix: string): string {
  let index = 1;
  while (state.chips.some((chip) => chip.id === `${prefix}-${index}`)) {
    index += 1;
  }
  return `${prefix}-${index}`;
}

/**
 * Fold one outbound message into the UI state. Pure: returns a new object when
 * the message is handled, the same object (reference-equal) when it is not.
 */
export function reduce(state: UiState, msg: UiMessage): UiState {
  switch (msg.kind) {
    case "draftChanged":
      return { ...state, draft: msg.text };

    case "pickerOpened":
      return {
        ...state,
        draft: msg.text,
        picker: {
          requestId: msg.requestId,
          query: msg.token.query,
          quoted: msg.token.quoted,
          tokenStart: msg.token.start,
          tokenEnd: msg.token.end,
          items: [],
          unavailable: false,
        },
      };

    case "pickerQueryChanged": {
      if (state.picker === undefined) return state;
      const token = `${state.picker.quoted ? '@"' : "@"}${msg.query}`;
      return {
        ...state,
        draft:
          state.draft.slice(0, state.picker.tokenStart) +
          token +
          state.draft.slice(state.picker.tokenEnd),
        picker: {
          ...state.picker,
          requestId: msg.requestId,
          query: msg.query,
          tokenEnd: state.picker.tokenStart + token.length,
          items: [],
          unavailable: false,
        },
      };
    }

    case "pickerDismissed": {
      if (state.picker === undefined) return state;
      const token = state.draft.slice(
        state.picker.tokenStart,
        state.picker.tokenEnd,
      );
      return {
        ...state,
        draft:
          token === "@"
            ? state.draft.slice(0, state.picker.tokenStart) +
              state.draft.slice(state.picker.tokenEnd)
            : state.draft,
        picker: undefined,
      };
    }

    case "referencePicked": {
      if (state.picker === undefined) return state;
      const mention = formatFileMention(msg.item, state.picker.quoted);
      if (mention === undefined) {
        return {
          ...state,
          error: "Selected path cannot be referenced",
          status: "error",
        };
      }
      const chip: ReferenceChip = {
        id: msg.id,
        kind: msg.item.kind === "directory" ? "folder" : "file",
        path: msg.item.path,
        mention,
        label: labelFromPath(msg.item.path),
      };
      const retryingInvalidReference =
        state.error === "Selected path cannot be referenced";
      return {
        ...state,
        draft:
          state.draft.slice(0, state.picker.tokenStart) +
          state.draft.slice(state.picker.tokenEnd),
        chips: [...state.chips, chip],
        picker: undefined,
        error: retryingInvalidReference ? undefined : state.error,
        status: retryingInvalidReference ? "idle" : state.status,
      };
    }

    case "folderPicked": {
      const path = msg.path.replace(/\/+$/, "");
      const mention = formatFileMention(
        { path, kind: "directory" },
        false,
      );
      if (mention === undefined) return state;
      return {
        ...state,
        chips: [
          ...state.chips,
          {
            id: nextChipId(state, "folder"),
            kind: "folder",
            path,
            mention,
            label: labelFromPath(path),
          },
        ],
      };
    }

    case "imagesPicked": {
      let nextState = state;
      const chips = [...state.chips];
      for (const image of msg.images) {
        const id = nextChipId({ ...nextState, chips }, "image");
        chips.push({
          id,
          kind: "image",
          image,
          label: image.name ?? "Image",
        });
        nextState = { ...nextState, chips };
      }
      return { ...state, chips };
    }

    case "chipRemoved": {
      const chips = state.chips.filter((chip) => chip.id !== msg.id);
      return chips.length === state.chips.length ? state : { ...state, chips };
    }

    case "submitStarted":
      return { ...state, submitPending: true, picker: undefined };

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
        submitPending: false,
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
              draft: "",
              chips: [],
              picker: undefined,
              submitPending: false,
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
        draft: "",
        chips: [],
        picker: undefined,
        submitPending: false,
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
          submitPending: false,
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

    case "fileReferences":
      if (
        state.picker === undefined ||
        state.picker.requestId !== msg.requestId
      ) {
        return state;
      }
      return {
        ...state,
        picker: {
          ...state.picker,
          items: msg.items,
          unavailable: msg.available === false,
        },
      };

    case "event": {
      if (
        state.sessionId !== undefined &&
        msg.sessionId !== state.sessionId
      ) {
        return state;
      }
      const type = msg.event.type;
      if (type === "turn/start") {
        return {
          ...state,
          approval: undefined,
          diffs: [],
          status: "thinking",
          ...(state.submitPending
            ? {
                draft: "",
                chips: [],
                picker: undefined,
                submitPending: false,
              }
            : {}),
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
        const diff = diffFromEventData(msg.event.data);
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

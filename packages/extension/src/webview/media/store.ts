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
import type { ImagesPickedMessage } from "./vscode.js";
import { formatChipMention } from "./chipMention.js";

// ---- webview UI state -------------------------------------------------------
//
// The reducer is pure and owns every draft, picker, and chip transition
// (store.test.ts). Components hold only presentation state; App.tsx mints the
// non-deterministic values (request ids, chip ids) the reducer folds in.

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

/**
 * One rendered turn of the conversation.
 *
 * Assistant text is markdown source; user text is shown verbatim. `streaming`
 * marks the entry that `text-delta` chunks are still appending to, which is
 * also the entry `assistant/message` finalizes instead of duplicating.
 */
export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  streaming: boolean;
}

export interface UiState {
  /** The conversation, folded from `user/message` and `assistant/*` events. */
  transcript: TranscriptEntry[];
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
  transcript: [],
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
  | ImagesPickedMessage
  | DraftChangedMessage
  | PickerOpenedMessage
  | PickerQueryChangedMessage
  | PickerDismissedMessage
  | ReferencePickedMessage
  | ChipRemovedMessage
  | SubmitStartedMessage;

/**
 * Join the text blocks of one logged message's `content`. Non-text blocks
 * (images, tool calls, reasoning) carry no transcript text and are skipped.
 */
function messageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    if ((block as { type?: unknown }).type !== "text") continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text === "string" && text !== "") parts.push(text);
  }
  return parts.join("\n\n");
}

/** Stop `text-delta` chunks from extending the newest assistant entry. */
function closeStreaming(entries: TranscriptEntry[]): TranscriptEntry[] {
  const last = entries.at(-1);
  if (last === undefined || last.role !== "assistant" || !last.streaming) {
    return entries;
  }
  return [...entries.slice(0, -1), { ...last, streaming: false }];
}

/**
 * Fold one session event into the transcript, returning the same array when the
 * event contributes no text.
 *
 * Both live events and a resumed `history` reply go through here, so a resumed
 * session reads exactly like the session that produced it. Only `source.kind`
 * `"user"` messages are shown: plugin, session-reference, and subagent-report
 * messages are injected context the person never typed.
 */
export function foldEvent(
  entries: TranscriptEntry[],
  event: SessionEventWire,
): TranscriptEntry[] {
  switch (event.type) {
    case "user/message": {
      const source: unknown = event.data.source;
      const kind =
        typeof source === "object" && source !== null
          ? (source as { kind?: unknown }).kind
          : undefined;
      if (kind !== "user") return entries;
      const text = messageText(event.data.content);
      if (text === "") return entries;
      return [
        ...closeStreaming(entries),
        { role: "user", text, streaming: false },
      ];
    }

    case "assistant/chunk": {
      const chunk: unknown = event.data.chunk;
      if (typeof chunk !== "object" || chunk === null) return entries;
      const { type, text } = chunk as { type?: unknown; text?: unknown };
      // Only visible answer text streams into the transcript; reasoning and
      // tool-call deltas are separate surfaces.
      if (type !== "text-delta" || typeof text !== "string" || text === "") {
        return entries;
      }
      const last = entries.at(-1);
      if (last !== undefined && last.role === "assistant" && last.streaming) {
        return [
          ...entries.slice(0, -1),
          { ...last, text: last.text + text },
        ];
      }
      return [...entries, { role: "assistant", text, streaming: true }];
    }

    case "assistant/message": {
      const message: unknown = event.data.message;
      const content =
        typeof message === "object" && message !== null
          ? (message as { content?: unknown }).content
          : undefined;
      const text = messageText(content);
      const last = entries.at(-1);
      if (last !== undefined && last.role === "assistant" && last.streaming) {
        // The assembled message is authoritative over the accumulated deltas,
        // except when it holds no text at all (tool-call-only steps).
        return [
          ...entries.slice(0, -1),
          {
            role: "assistant",
            text: text === "" ? last.text : text,
            streaming: false,
          },
        ];
      }
      if (text === "") return entries;
      return [...entries, { role: "assistant", text, streaming: false }];
    }

    default:
      return entries;
  }
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
 * Build the next submit payload from the current body and attachment rail.
 *
 * An open picker's trigger token (`@`, `@sr`, `@"my f`) is an incomplete
 * completion, not message text: submitting with the picker still open drops it
 * rather than sending a dangling mention.
 */
export function serializeDraft(
  state: Pick<UiState, "draft" | "chips" | "picker">,
): { text: string; images?: EncodedImageAttachment[] } {
  const body =
    state.picker === undefined
      ? state.draft
      : state.draft.slice(0, state.picker.tokenStart) +
        state.draft.slice(state.picker.tokenEnd);
  const text = [
    body.trim(),
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
      // Drafting works before the bridge is ready, but there is nothing to
      // search: keep the typed text and leave the picker closed.
      if (!state.ready) return { ...state, draft: msg.text };
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
      const mention = formatChipMention(msg.item, state.picker.quoted);
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

    case "imagesPicked": {
      const chips = [...state.chips];
      for (const image of msg.images) {
        chips.push({
          id: nextChipId({ ...state, chips }, "image"),
          kind: "image",
          image,
          label: image.name ?? "Image",
        });
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
              transcript: [],
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
        transcript: msg.events.reduce(foldEvent, []),
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
      //
      // Only `submit-rejected` answers the queued submit. An unrelated error
      // (an unknown model, a failed permission switch) can arrive between the
      // submit and its `turn/start`, so unlocking on it would let a second send
      // duplicate the turn; the acknowledgement stays current-session
      // `turn/start`, plus the `hostDisconnected` lifecycle path.
      if (msg.state === "error") {
        return {
          ...state,
          error: msg.detail ?? "DSH reported an error",
          starting: false,
          status: "error",
          ...(msg.code === "submit-rejected" ? { submitPending: false } : {}),
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
          transcript: closeStreaming(state.transcript),
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
      if (
        type === "user/message" ||
        type === "assistant/chunk" ||
        type === "assistant/message"
      ) {
        const transcript = foldEvent(state.transcript, msg.event);
        return transcript === state.transcript
          ? state
          : { ...state, transcript };
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

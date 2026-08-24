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
  SlashAvailability,
  SlashMenuItem,
  ToolCallView,
  ToolDiff,
  ToolResultView,
} from "@dsh-vscode/contract";
import { isSessionEventWire } from "@dsh-vscode/contract";
import type { ImagesPickedMessage } from "./vscode.js";
import { formatChipMention } from "./chipMention.js";
import { filterSlashItems, type SlashGroup } from "./slashFilter.js";
import {
  replaceSlashToken,
  type SlashToken,
} from "./slashToken.js";

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

export interface AttachmentPickerState {
  kind: "attachment";
  requestId: string;
  query: string;
  quoted: boolean;
  tokenStart: number;
  tokenEnd: number;
  items: FileReferenceItem[];
  unavailable: boolean;
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

export interface PendingCommandSubmission {
  line: string;
  draft: string;
  chips: DraftChip[];
}

export interface PendingPromptSubmission {
  requestId: string;
  mode: "queue" | "steer";
  draft: string;
  chips: DraftChip[];
}

/** One ordered row folded from the session event stream. */
export type TimelineRow =
  | { kind: "user"; seq: number; text: string }
  | { kind: "thinking"; seq: number; text: string; running: boolean }
  | { kind: "assistant"; seq: number; text: string; streaming: boolean }
  | {
      kind: "tool";
      seq: number;
      callId: string;
      name: string;
      argsRaw: string;
      status: "running" | "ok" | "error" | "stopped";
      resultText?: string;
      callView?: ToolCallView;
      resultView?: ToolResultView;
      diffs: ToolDiff[];
    }
  | {
      kind: "command";
      seq: number;
      commandId: string;
      name: string;
      args: string | null;
      status: "running" | "success" | "error";
      output?: string;
    };

type ToolTimelineRow = Extract<TimelineRow, { kind: "tool" }>;

export interface UiState {
  /** The conversation timeline folded from session events. */
  timeline: TimelineRow[];
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
  commandClaim: CommandClaim | undefined;
  submitPending: boolean;
  pendingPromptSubmission: PendingPromptSubmission | undefined;
  pendingCommandSubmission: PendingCommandSubmission | undefined;
}

export const initialState: UiState = {
  timeline: [],
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
  commandClaim: undefined,
  submitPending: false,
  pendingPromptSubmission: undefined,
  pendingCommandSubmission: undefined,
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

interface PickerClosedForSettingsMessage {
  kind: "pickerClosedForSettings";
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
  requestId: string;
  mode: "queue" | "steer";
}

interface CommandSubmitStartedMessage {
  kind: "commandSubmitStarted";
  line: string;
}

interface SlashPickerOpenedMessage {
  kind: "slashPickerOpened";
  text: string;
  token: SlashToken;
  requestId: string;
}

interface SlashTokenChangedMessage {
  kind: "slashTokenChanged";
  text: string;
  token: SlashToken | undefined;
}

interface SlashPickerDismissedMessage {
  kind: "slashPickerDismissed";
}

interface SlashItemsReceivedMessage {
  kind: "slashItemsReceived";
  requestId: string;
  items: SlashMenuItem[];
  availability: SlashAvailability;
}

interface SlashHighlightMovedMessage {
  kind: "slashHighlightMoved";
  delta: -1 | 1;
}

interface SlashItemPickedMessage {
  kind: "slashItemPicked";
  item: SlashMenuItem;
}

interface CommandStartedMessage {
  kind: "commandStarted";
}

interface CommandRejectedMessage {
  kind: "commandRejected";
  detail: string;
}

interface LocalErrorMessage {
  kind: "localError";
  detail: string;
}

interface NewChatStartedMessage {
  kind: "newChatStarted";
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
  | PickerClosedForSettingsMessage
  | ReferencePickedMessage
  | ChipRemovedMessage
  | SubmitStartedMessage
  | CommandSubmitStartedMessage
  | SlashPickerOpenedMessage
  | SlashTokenChangedMessage
  | SlashPickerDismissedMessage
  | SlashItemsReceivedMessage
  | SlashHighlightMovedMessage
  | SlashItemPickedMessage
  | CommandStartedMessage
  | CommandRejectedMessage
  | LocalErrorMessage
  | NewChatStartedMessage;

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

function snapshotChip(chip: DraftChip): DraftChip {
  return chip.kind === "image"
    ? { ...chip, image: { ...chip.image } }
    : { ...chip };
}

function sameChip(left: DraftChip, right: DraftChip): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "image" && right.kind === "image") {
    return (
      left.id === right.id &&
      left.label === right.label &&
      left.image.mediaType === right.image.mediaType &&
      left.image.data === right.image.data &&
      left.image.name === right.image.name
    );
  }
  if (left.kind === "image" || right.kind === "image") return false;
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.path === right.path &&
    left.mention === right.mention &&
    left.label === right.label
  );
}

function sameChips(left: DraftChip[], right: DraftChip[]): boolean {
  return (
    left.length === right.length &&
    left.every((chip, index) => sameChip(chip, right[index]!))
  );
}

function commandRunLine(event: SessionEventWire): string | undefined {
  if (event.type !== "command/run") return undefined;
  const name = event.data.name;
  if (typeof name !== "string" || name === "") return undefined;
  const args = event.data.args;
  return `/${name}${typeof args === "string" ? args : ""}`;
}

function commandRunName(event: SessionEventWire): string | undefined {
  if (event.type !== "command/run") return undefined;
  const name = event.data.name;
  return typeof name === "string" && name !== "" ? name : undefined;
}

function commandNameFromLine(line: string): string | undefined {
  const match = /^\/(\S+)/.exec(line.trim());
  return match?.[1];
}

function settlePendingCommand(
  state: UiState,
): Pick<UiState, "submitPending" | "pendingCommandSubmission"> | undefined {
  return state.pendingCommandSubmission === undefined
    ? undefined
    : {
        submitPending: false,
        pendingCommandSubmission: undefined,
      };
}

/** Stop open assistant text streams. */
function closeAssistantStreaming(rows: TimelineRow[]): TimelineRow[] {
  let changed = false;
  const closed = rows.map((row): TimelineRow => {
    if (row.kind === "assistant" && row.streaming) {
      changed = true;
      return { ...row, streaming: false };
    }
    return row;
  });
  return changed ? closed : rows;
}

function lastRowIndex(
  rows: TimelineRow[],
  matches: (row: TimelineRow) => boolean,
): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (matches(rows[index]!)) return index;
  }
  return -1;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function callViewFromEvent(event: SessionEventWire): ToolCallView | undefined {
  const candidate: unknown = {
    type: event.type,
    seq: event.seq,
    time: event.time,
    data: {},
    view: event.view,
  };
  if (!isSessionEventWire(candidate) || candidate.view?.for !== "call") {
    return undefined;
  }
  return candidate.view.view;
}

function resultViewFromEvent(event: SessionEventWire): ToolResultView | undefined {
  const candidate: unknown = {
    type: event.type,
    seq: event.seq,
    time: event.time,
    data: {},
    view: event.view,
  };
  if (!isSessionEventWire(candidate) || candidate.view?.for !== "result") {
    return undefined;
  }
  return candidate.view.view;
}

function upsertTool(
  rows: TimelineRow[],
  callId: string,
  seq: number,
  update: (row: ToolTimelineRow) => ToolTimelineRow,
): TimelineRow[] {
  const index = lastRowIndex(
    rows,
    (row) => row.kind === "tool" && row.callId === callId,
  );
  if (index < 0) {
    return [
      ...rows,
      update({
        kind: "tool",
        seq,
        callId,
        name: "tool",
        argsRaw: "",
        status: "running",
        diffs: [],
      }),
    ];
  }
  const row = rows[index]!;
  if (row.kind !== "tool") return rows;
  return [
    ...rows.slice(0, index),
    update(row),
    ...rows.slice(index + 1),
  ];
}

function toolResultBlock(event: SessionEventWire): {
  callId: string;
  content: unknown;
  isError: boolean;
} | undefined {
  const message = record(event.data.message);
  const source = record(message?.source);
  if (typeof source?.callId !== "string") return undefined;
  const blocks = message?.content;
  if (!Array.isArray(blocks)) return undefined;
  const result = blocks
    .map(record)
    .find((block) => block?.type === "tool-result");
  return {
    callId: source.callId,
    content: result?.content,
    isError: result?.isError === true,
  };
}

function diffsFromResultView(view: ToolResultView | undefined): ToolDiff[] {
  if (view?.card !== "diff" || !Array.isArray(view.diffs)) return [];
  const diffs: ToolDiff[] = [];
  for (const diff of view.diffs) {
    if (
      typeof diff?.path === "string" &&
      (typeof diff.oldText === "string" || diff.oldText === null) &&
      typeof diff.newText === "string"
    ) {
      diffs.push({
        path: diff.path,
        oldText: diff.oldText ?? "",
        newText: diff.newText,
      });
    }
  }
  return diffs;
}

function closeThinking(rows: TimelineRow[]): TimelineRow[] {
  const index = lastRowIndex(
    rows,
    (row) => row.kind === "thinking" && row.running,
  );
  if (index < 0) return rows;
  const row = rows[index]!;
  if (row.kind !== "thinking") return rows;
  return [
    ...rows.slice(0, index),
    { ...row, running: false },
    ...rows.slice(index + 1),
  ];
}

/**
 * Fold one session event into the timeline, returning the same array when the
 * event contributes no text.
 *
 * Both live events and a resumed `history` reply go through here, so a resumed
 * session reads exactly like the session that produced it. Only `source.kind`
 * `"user"` messages are shown: plugin, session-reference, and subagent-report
 * messages are injected context the person never typed.
 */
export function foldEvent(
  rows: TimelineRow[],
  event: SessionEventWire,
): TimelineRow[] {
  switch (event.type) {
    case "user/message": {
      const source: unknown = event.data.source;
      const kind =
        typeof source === "object" && source !== null
          ? (source as { kind?: unknown }).kind
          : undefined;
      if (kind !== "user") return rows;
      const text = messageText(event.data.content);
      if (text === "") return rows;
      return [
        ...closeAssistantStreaming(rows),
        { kind: "user", seq: event.seq, text },
      ];
    }

    case "command/run": {
      const line = commandRunLine(event);
      if (line === undefined) return rows;
      return [
        ...closeAssistantStreaming(rows),
        { kind: "user", seq: event.seq, text: line },
      ];
    }

    case "assistant/chunk": {
      const chunk: unknown = event.data.chunk;
      if (typeof chunk !== "object" || chunk === null) return rows;
      const { type, text } = chunk as { type?: unknown; text?: unknown };
      if (type === "tool-call-delta") {
        const {
          id,
          name,
          argumentsDelta,
        } = chunk as {
          id?: unknown;
          name?: unknown;
          argumentsDelta?: unknown;
        };
        if (
          typeof id !== "string" ||
          typeof argumentsDelta !== "string" ||
          (name !== undefined && typeof name !== "string")
        ) {
          return rows;
        }
        return upsertTool(rows, id, event.seq, (row) => ({
          ...row,
          ...(name === undefined ? {} : { name }),
          argsRaw: row.argsRaw + argumentsDelta,
          status: "running",
        }));
      }
      if (typeof text !== "string" || text === "") return rows;
      if (type === "reasoning-delta") {
        const index = lastRowIndex(
          rows,
          (row) => row.kind === "thinking" && row.running,
        );
        if (index < 0) {
          return [
            ...rows,
            { kind: "thinking", seq: event.seq, text, running: true },
          ];
        }
        const row = rows[index]!;
        if (row.kind !== "thinking") return rows;
        return [
          ...rows.slice(0, index),
          { ...row, text: row.text + text },
          ...rows.slice(index + 1),
        ];
      }
      if (type !== "text-delta") return rows;
      const index = lastRowIndex(
        rows,
        (row) => row.kind === "assistant" && row.streaming,
      );
      if (index >= 0) {
        const row = rows[index]!;
        if (row.kind !== "assistant") return rows;
        return [
          ...rows.slice(0, index),
          { ...row, text: row.text + text },
          ...rows.slice(index + 1),
        ];
      }
      return [
        ...rows,
        { kind: "assistant", seq: event.seq, text, streaming: true },
      ];
    }

    case "assistant/message": {
      const message: unknown = event.data.message;
      const content =
        typeof message === "object" && message !== null
          ? (message as { content?: unknown }).content
          : undefined;
      const text = messageText(content);
      const index = lastRowIndex(
        rows,
        (row) => row.kind === "assistant" && row.streaming,
      );
      let nextRows = rows;
      if (index >= 0) {
        const row = rows[index]!;
        if (row.kind !== "assistant") return rows;
        // The assembled message is authoritative over the accumulated deltas,
        // except when it holds no text at all (tool-call-only steps).
        nextRows = [
          ...rows.slice(0, index),
          {
            ...row,
            text: text === "" ? row.text : text,
            streaming: false,
          },
          ...rows.slice(index + 1),
        ];
      } else if (text !== "") {
        nextRows = [
          ...rows,
          { kind: "assistant", seq: event.seq, text, streaming: false },
        ];
      }
      if (!Array.isArray(content)) return nextRows;
      for (const value of content) {
        const block = record(value);
        if (
          block?.type !== "tool-call" ||
          typeof block.id !== "string" ||
          typeof block.name !== "string" ||
          typeof block.arguments !== "string"
        ) {
          continue;
        }
        nextRows = upsertTool(nextRows, block.id, event.seq, (row) => ({
          ...row,
          name: block.name as string,
          argsRaw: block.arguments as string,
          status: "running",
        }));
      }
      return nextRows;
    }

    case "tool/call": {
      const { callId, name, arguments: argsRaw } = event.data;
      if (
        typeof callId !== "string" ||
        typeof name !== "string" ||
        typeof argsRaw !== "string"
      ) {
        return rows;
      }
      const callView = callViewFromEvent(event);
      return upsertTool(rows, callId, event.seq, (row) => ({
        ...row,
        name,
        argsRaw,
        status: "running",
        ...(callView === undefined ? {} : { callView }),
      }));
    }

    case "tool/result": {
      const result = toolResultBlock(event);
      if (result === undefined) return rows;
      const resultView = resultViewFromEvent(event);
      const metadataDiff = diffFromEventData(event.data);
      const diffs = [
        ...(metadataDiff === undefined ? [] : [metadataDiff]),
        ...diffsFromResultView(resultView),
      ];
      const resultText = messageText(result.content);
      const failed = result.isError || record(event.data.error) !== undefined;
      return upsertTool(rows, result.callId, event.seq, (row) => ({
        ...row,
        status: failed ? "error" : "ok",
        ...(resultText === "" ? {} : { resultText }),
        ...(resultView === undefined ? {} : { resultView }),
        diffs,
      }));
    }

    case "assistant/analysis-end":
      return closeThinking(rows);

    case "turn/start":
      return closeAssistantStreaming(rows);

    case "turn/end":
      return closeThinking(closeAssistantStreaming(rows));

    default:
      return rows;
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
    state.picker === undefined || state.picker.kind === "slash"
      ? state.draft
      : state.draft.slice(0, state.picker.tokenStart) +
        state.draft.slice(state.picker.tokenEnd);
  const serialized = serializeComposer(body, state.chips);
  return serialized.images === undefined
    ? { text: serialized.value }
    : { text: serialized.value, images: serialized.images };
}

function serializeComposer(
  body: string,
  chips: DraftChip[],
): { value: string; images?: EncodedImageAttachment[] } {
  const value = [
    body.trim(),
    ...chips
      .filter((chip): chip is ReferenceChip => chip.kind !== "image")
      .map((chip) => chip.mention),
  ]
    .filter((part) => part !== "")
    .join(" ");
  const images = chips
    .filter((chip): chip is ImageChip => chip.kind === "image")
    .map((chip) => chip.image);
  return images.length === 0
    ? { value }
    : { value, images };
}

/** Build a claimed command invocation using normal attachment serialization. */
export function serializeCommand(
  state: Pick<UiState, "draft" | "chips" | "commandClaim">,
): { line: string; images?: EncodedImageAttachment[] } | undefined {
  if (
    state.commandClaim === undefined ||
    !state.draft.startsWith(state.commandClaim.token)
  ) {
    return undefined;
  }
  const serialized = serializeComposer(state.draft, state.chips);
  return serialized.images === undefined
    ? { line: serialized.value }
    : { line: serialized.value, images: serialized.images };
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

/** Return the stable identity used by slash-menu highlighting. */
export function slashItemKey(item: SlashMenuItem): string {
  return `${item.source}:${item.name}`;
}

function slashRows(groups: SlashGroup[]): SlashMenuItem[] {
  return groups.flatMap((group) => group.items);
}

function validCommandClaim(
  claim: CommandClaim | undefined,
  draft: string,
): CommandClaim | undefined {
  return claim !== undefined && draft.startsWith(claim.token)
    ? claim
    : undefined;
}

function receiveSlashItems(
  state: UiState,
  requestId: string,
  items: SlashMenuItem[],
  availability: SlashAvailability,
): UiState {
  if (
    state.picker?.kind !== "slash" ||
    state.picker.requestId !== requestId
  ) {
    return state;
  }
  const groups = filterSlashItems(items, state.picker.token);
  const first = slashRows(groups)[0];
  if (first === undefined) {
    return { ...state, picker: undefined };
  }
  return {
    ...state,
    picker: {
      ...state.picker,
      catalog: items,
      groups,
      availability,
      highlightedKey: slashItemKey(first),
    },
  };
}

/**
 * Fold one outbound message into the UI state. Pure: returns a new object when
 * the message is handled, the same object (reference-equal) when it is not.
 */
export function reduce(state: UiState, msg: UiMessage): UiState {
  switch (msg.kind) {
    case "draftChanged": {
      const commandClaim = validCommandClaim(state.commandClaim, msg.text);
      return { ...state, draft: msg.text, commandClaim };
    }

    case "pickerOpened":
      // Drafting works before the bridge is ready, but there is nothing to
      // search: keep the typed text and leave the picker closed.
      if (!state.ready) return { ...state, draft: msg.text };
      return {
        ...state,
        draft: msg.text,
        commandClaim: validCommandClaim(state.commandClaim, msg.text),
        picker: {
          kind: "attachment",
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
      if (state.picker?.kind === "slash" || state.picker === undefined) {
        return state;
      }
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
      if (state.picker?.kind === "slash" || state.picker === undefined) {
        return state;
      }
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

    case "pickerClosedForSettings":
      return state.picker === undefined ? state : { ...state, picker: undefined };

    case "referencePicked": {
      if (state.picker?.kind === "slash" || state.picker === undefined) {
        return state;
      }
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

    case "slashPickerOpened":
      if (!state.ready) return { ...state, draft: msg.text };
      return {
        ...state,
        draft: msg.text,
        commandClaim: validCommandClaim(state.commandClaim, msg.text),
        picker: {
          kind: "slash",
          token: msg.token,
          requestId: msg.requestId,
          catalog: [],
          groups: [],
          highlightedKey: undefined,
        },
      };

    case "slashTokenChanged": {
      if (state.picker?.kind !== "slash") return state;
      const commandClaim = validCommandClaim(state.commandClaim, msg.text);
      if (msg.token === undefined) {
        return {
          ...state,
          draft: msg.text,
          picker: undefined,
          commandClaim,
        };
      }
      const groups = filterSlashItems(state.picker.catalog, msg.token);
      const first = slashRows(groups)[0];
      return {
        ...state,
        draft: msg.text,
        commandClaim,
        picker:
          first === undefined && state.picker.catalog.length > 0
            ? undefined
            : {
                ...state.picker,
                token: msg.token,
                groups,
                highlightedKey:
                  first === undefined ? undefined : slashItemKey(first),
              },
      };
    }

    case "slashPickerDismissed":
      return state.picker?.kind === "slash"
        ? { ...state, picker: undefined }
        : state;

    case "slashItemsReceived":
      return receiveSlashItems(
        state,
        msg.requestId,
        msg.items,
        msg.availability,
      );

    case "slashItems":
      return receiveSlashItems(
        state,
        msg.requestId,
        msg.items,
        msg.availability,
      );

    case "slashHighlightMoved": {
      if (state.picker?.kind !== "slash") return state;
      const rows = slashRows(state.picker.groups);
      if (rows.length === 0) return state;
      const highlightedKey = state.picker.highlightedKey;
      const current = rows.findIndex(
        (item) => slashItemKey(item) === highlightedKey,
      );
      const index =
        current < 0
          ? 0
          : (current + msg.delta + rows.length) % rows.length;
      return {
        ...state,
        picker: {
          ...state.picker,
          highlightedKey: slashItemKey(rows[index]!),
        },
      };
    }

    case "slashItemPicked": {
      if (state.picker?.kind !== "slash") return state;
      const replacement =
        msg.item.behavior === "execute" ? "" : `/${msg.item.name} `;
      const next = replaceSlashToken(
        state.draft,
        state.picker.token,
        replacement,
      );
      const replacementClaim: CommandClaim | undefined =
        msg.item.behavior === "command-input" &&
        next.text.startsWith(replacement)
          ? {
              name: msg.item.name,
              token: replacement,
              ...(msg.item.hint === undefined ? {} : { hint: msg.item.hint }),
              acceptsImages: msg.item.acceptsImages === true,
            }
          : undefined;
      const commandClaim =
        replacementClaim ?? validCommandClaim(state.commandClaim, next.text);
      return {
        ...state,
        draft: next.text,
        picker: undefined,
        commandClaim,
      };
    }

    case "commandStarted":
      return {
        ...state,
        picker: undefined,
        commandClaim: undefined,
        submitPending: false,
        pendingCommandSubmission: undefined,
        status: "thinking",
      };

    case "commandRejected":
      return {
        ...state,
        submitPending: false,
        pendingCommandSubmission: undefined,
        error: msg.detail,
        status: "error",
      };

    case "localError":
      return { ...state, error: msg.detail, status: "error" };

    case "newChatStarted":
      return {
        ...state,
        picker: undefined,
        commandClaim: undefined,
        submitPending: false,
        pendingPromptSubmission: undefined,
        pendingCommandSubmission: undefined,
      };

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
      return {
        ...state,
        submitPending: true,
        error: undefined,
        pendingPromptSubmission: {
          requestId: msg.requestId,
          mode: msg.mode,
          draft: state.draft,
          chips: state.chips.map(snapshotChip),
        },
        pendingCommandSubmission: undefined,
        picker: undefined,
      };

    case "submitResult": {
      const pending = state.pendingPromptSubmission;
      if (pending === undefined || pending.requestId !== msg.requestId) return state;
      const unchanged =
        state.draft === pending.draft && sameChips(state.chips, pending.chips);
      if (!msg.result.ok) {
        return {
          ...state,
          submitPending: false,
          pendingPromptSubmission: undefined,
          error: msg.result.detail,
        };
      }
      return {
        ...state,
        submitPending: false,
        pendingPromptSubmission: undefined,
        ...(unchanged
          ? {
              draft: "",
              chips: [],
              picker: undefined,
              commandClaim: undefined,
            }
          : {}),
      };
    }

    case "commandSubmitStarted":
      return {
        ...state,
        submitPending: true,
        pendingCommandSubmission: {
          line: msg.line,
          draft: state.draft,
          chips: state.chips.map(snapshotChip),
        },
        picker: undefined,
      };

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
        picker: undefined,
        commandClaim: undefined,
        submitPending: false,
        pendingPromptSubmission: undefined,
        pendingCommandSubmission: undefined,
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
        picker: undefined,
        commandClaim: undefined,
        ...(changed
          ? {
              timeline: [],
              diffs: [],
              approval: undefined,
              context: undefined,
              draft: "",
              chips: [],
              submitPending: false,
              pendingPromptSubmission: undefined,
              pendingCommandSubmission: undefined,
            }
          : {}),
      };
    }

    case "history":
      return {
        ...state,
        sessionId: msg.sessionId,
        timeline: msg.events.reduce(foldEvent, []),
        diffs: [],
        approval: undefined,
        draft: "",
        chips: [],
        picker: undefined,
        commandClaim: undefined,
        submitPending: false,
        pendingPromptSubmission: undefined,
        pendingCommandSubmission: undefined,
      };

    case "status":
      // Surfaced (not silently swallowed): a crashed child or failed startup is
      // relayed as status:error and rendered by App as a visible error banner.
      //
      // Ordinary prompts settle only through correlated submitResult messages.
      // Command pending state is different: cancel or failure can arrive as
      // generic idle/error before `command/run`, so those settle its snapshot.
      if (msg.state === "error") {
        return {
          ...state,
          error: msg.detail ?? "DeepSeek Harness reported an error",
          starting: false,
          status: "error",
          ...(msg.code === "command-rejected"
            ? {
                submitPending: false,
                pendingCommandSubmission: undefined,
              }
            : settlePendingCommand(state) ?? {}),
        };
      }
      if (msg.state === "idle") {
        return {
          ...state,
          approval: undefined,
          error: undefined,
          status: "idle",
          ...settlePendingCommand(state),
        };
      }
      return { ...state, status: msg.state };

    case "fileReferences":
      if (
        state.picker === undefined ||
        state.picker.kind === "slash" ||
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
          timeline: foldEvent(state.timeline, msg.event),
        };
      }
      if (type === "turn/end") {
        return {
          ...state,
          approval: undefined,
          status: "idle",
          timeline: foldEvent(state.timeline, msg.event),
        };
      }
      if (
        type === "user/message" ||
        type === "assistant/chunk" ||
        type === "assistant/message" ||
        type === "assistant/analysis-end" ||
        type === "command/run" ||
        type === "tool/call" ||
        type === "tool/result"
      ) {
        const timeline = foldEvent(state.timeline, msg.event);
        if (type === "command/run") {
          const name = commandRunName(msg.event);
          const pending = state.pendingCommandSubmission;
          const matchesPending =
            name !== undefined &&
            pending !== undefined &&
            commandNameFromLine(pending.line) === name;
          const unchanged =
            matchesPending &&
            state.draft === pending.draft &&
            sameChips(state.chips, pending.chips);
          return {
            ...state,
            timeline,
            ...(unchanged
              ? {
                  draft: "",
                  chips: [],
                  picker: undefined,
                  commandClaim: undefined,
                }
              : {}),
            ...(matchesPending
              ? {
                  submitPending: false,
                  pendingCommandSubmission: undefined,
                }
              : {}),
            status: "thinking",
          };
        }
        if (type === "tool/result") {
          const diff = diffFromEventData(msg.event.data);
          if (timeline === state.timeline && diff === undefined) return state;
          return {
            ...state,
            timeline,
            ...(diff === undefined
              ? {}
              : { diffs: [...state.diffs, diff] }),
          };
        }
        return timeline === state.timeline ? state : { ...state, timeline };
      }
      if (type === "command/done") {
        const settled = settlePendingCommand(state);
        if (state.status === "idle" && settled === undefined) return state;
        return { ...state, status: "idle", ...settled };
      }
      return state;
    }

    default:
      return state;
  }
}

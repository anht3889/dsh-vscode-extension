import type { SessionEventWire } from "./events.js";
import type {
  SettingsInboundCommand,
  SettingsOutboundMessage,
} from "./settings.js";
import {
  isSettingsInboundCommand,
  isSettingsOutboundMessage,
  SETTINGS_INBOUND_KINDS,
  SETTINGS_OUTBOUND_KINDS,
} from "./settings.js";

export const PROTOCOL_VERSION = 6;

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

export interface ModelRef { provider: string; model: string }
export interface ModelListItem extends ModelRef {
  label: string;
  contextWindow?: number;
}
export interface SessionListItem {
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  cwd: string;
}
export interface PermissionPresetItem { id: string; label: string }
export interface CatalogPayload {
  current: ModelRef;
  models: ModelListItem[];
}
export interface PermissionsPayload {
  current: string;
  presets: PermissionPresetItem[];
}
export interface ContextPayload { used: number; window: number }

export interface HelloMessage {
  kind: "hello";
  version: number;
  dshVersion: string;
  cwd: string;
  model?: ModelRef;
}
export interface SessionMessage {
  kind: "session";
  sessionId: string;
  cwd?: string;
  createdAt: number;
}
export interface ReadyMessage {
  kind: "ready";
  sessionId: string;
  cwd: string;
  models: CatalogPayload;
  permissions: PermissionsPayload;
  context?: ContextPayload;
}
export interface SessionsMessage { kind: "sessions"; items: SessionListItem[]; available?: boolean }
export interface CatalogMessage extends CatalogPayload { kind: "catalog" }
export interface PermissionsMessage extends PermissionsPayload { kind: "permissions" }
export interface ContextMessage extends ContextPayload { kind: "context" }
export interface HistoryMessage {
  kind: "history";
  sessionId: string;
  events: SessionEventWire[];
}
export interface EventMessage { kind: "event"; sessionId: string; event: SessionEventWire }
export interface AskMessage { kind: "ask"; askId: string; questions: AskQuestionWire[] }
export interface StatusMessage {
  kind: "status";
  state: "idle" | "thinking" | "awaiting-approval" | "error";
  detail?: string;
  code?: string;
}
export interface FileReferencesMessage {
  kind: "fileReferences";
  requestId: string;
  items: FileReferenceItem[];
  available?: boolean;
}

export type SlashMenuSource = "command" | "skill";
export type SlashMenuBehavior = "execute" | "command-input" | "insert";

export interface SlashMenuItem {
  source: SlashMenuSource;
  name: string;
  description: string;
  behavior: SlashMenuBehavior;
  hint?: string;
  acceptsImages?: boolean;
}

export interface SlashAvailability {
  commands: boolean;
  skills: boolean;
}

export interface SlashItemsMessage {
  kind: "slashItems";
  requestId: string;
  items: SlashMenuItem[];
  availability: SlashAvailability;
}
export interface SubmitResultMessage {
  kind: "submitResult";
  requestId: string;
  result: { ok: true } | { ok: false; detail: string };
}

export type OutboundMessage =
  | HelloMessage | SessionMessage | ReadyMessage | SessionsMessage
  | CatalogMessage | PermissionsMessage | ContextMessage | HistoryMessage
  | EventMessage | AskMessage | StatusMessage | FileReferencesMessage
  | SlashItemsMessage | SubmitResultMessage | SettingsOutboundMessage;

export interface SubmitCommand {
  kind: "submit";
  requestId: string;
  mode: "queue" | "steer";
  text: string;
  provider?: string;
  model?: string;
  permission?: string;
  images?: EncodedImageAttachment[];
}
export interface AnswerCommand { kind: "answer"; askId: string; answered: AskAnswerWire }
export interface CancelCommand { kind: "cancel"; cause?: "user" }
export interface ResumeCommand { kind: "resume"; sessionId: string }
export interface ExitCommand { kind: "exit" }
export interface ListSessionsCommand { kind: "listSessions" }
export interface NewSessionCommand { kind: "newSession" }
export interface SelectModelCommand { kind: "selectModel"; provider: string; model: string }
export interface SelectPermissionCommand { kind: "selectPermission"; preset: string }
export interface ListFileReferencesCommand {
  kind: "listFileReferences";
  query: string;
  requestId: string;
}
export interface ListSlashItemsCommand {
  kind: "listSlashItems";
  requestId: string;
}
export interface ExecuteSlashCommand {
  kind: "executeSlashCommand";
  line: string;
  images?: EncodedImageAttachment[];
}
export type InboundMessage =
  | SubmitCommand | AnswerCommand | CancelCommand | ResumeCommand | ExitCommand
  | ListSessionsCommand | NewSessionCommand | SelectModelCommand | SelectPermissionCommand
  | ListFileReferencesCommand | ListSlashItemsCommand | ExecuteSlashCommand
  | SettingsInboundCommand;

// ---- question/answer wire types (mirror dsh-user-questions types, dependency-free) ----
export interface AskQuestionWire { id: string; question: string; detail?: string; header?: string; options?: { label: string; description?: string }[]; multiSelect?: boolean }
export interface AskAnswerWire { answers: { id: string; selected: string[]; custom?: string }[] }

const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = [
  "image/png", "image/jpeg", "image/webp", "image/gif",
];

function kindOf(m: unknown): string | undefined {
  if (typeof m !== "object" || m === null) return undefined;
  return (m as { kind?: unknown }).kind as string | undefined;
}

function hasOnlyOwnKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isImageMediaType(v: unknown): v is ImageMediaType {
  return typeof v === "string" && (IMAGE_MEDIA_TYPES as readonly string[]).includes(v);
}

function isEncodedImageAttachment(v: unknown): v is EncodedImageAttachment {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (!isImageMediaType(o.mediaType)) return false;
  if (typeof o.data !== "string") return false;
  if (o.name !== undefined && typeof o.name !== "string") return false;
  return true;
}

function isFileReferenceItem(v: unknown): v is FileReferenceItem {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.path === "string" && (o.kind === "file" || o.kind === "directory");
}

function isSlashMenuItem(v: unknown): v is SlashMenuItem {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== "string" || o.name.length === 0) return false;
  if (typeof o.description !== "string") return false;
  if (o.source === "skill") {
    return o.behavior === "insert"
      && o.hint === undefined
      && o.acceptsImages === undefined;
  }
  if (o.source !== "command" || o.behavior === "insert") return false;
  if (o.behavior === "command-input") {
    return typeof o.hint === "string"
      && o.hint.length > 0
      && (o.acceptsImages === undefined || typeof o.acceptsImages === "boolean");
  }
  return o.behavior === "execute"
    && o.hint === undefined
    && o.acceptsImages === undefined;
}

function isSlashAvailability(v: unknown): v is SlashAvailability {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.commands === "boolean" && typeof o.skills === "boolean";
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFileLocation(v: unknown): v is import("./events.js").FileLocation {
  if (!isPlainObject(v)) return false;
  if (typeof v.path !== "string") return false;
  if (v.line !== undefined && typeof v.line !== "number") return false;
  return true;
}

function isFileDiff(v: unknown): v is import("./events.js").FileDiff {
  if (!isPlainObject(v)) return false;
  if (typeof v.path !== "string") return false;
  if (v.oldText !== null && typeof v.oldText !== "string") return false;
  if (typeof v.newText !== "string") return false;
  return true;
}

function isToolCallKind(v: unknown): v is import("./events.js").ToolCallKind {
  return v === "read" || v === "edit" || v === "delete" || v === "move"
    || v === "search" || v === "execute" || v === "fetch" || v === "other";
}

function isGenericCallView(v: unknown): v is import("./events.js").GenericCallView {
  if (!isPlainObject(v) || v.card !== "generic") return false;
  if (typeof v.title !== "string") return false;
  if (v.kind !== undefined && !isToolCallKind(v.kind)) return false;
  if (v.locations !== undefined) {
    if (!Array.isArray(v.locations) || !v.locations.every(isFileLocation)) return false;
  }
  return true;
}

function isTerminalCallView(v: unknown): v is import("./events.js").TerminalCallView {
  if (!isPlainObject(v) || v.card !== "terminal") return false;
  if (typeof v.title !== "string") return false;
  if (v.description !== undefined && typeof v.description !== "string") return false;
  if (v.cwd !== undefined && typeof v.cwd !== "string") return false;
  return true;
}

function isDiffCallView(v: unknown): v is import("./events.js").DiffCallView {
  if (!isPlainObject(v) || v.card !== "diff") return false;
  if (typeof v.title !== "string") return false;
  if (!Array.isArray(v.diffs) || !v.diffs.every(isFileDiff)) return false;
  if (v.locations !== undefined) {
    if (!Array.isArray(v.locations) || !v.locations.every(isFileLocation)) return false;
  }
  return true;
}

function isToolCallView(v: unknown): v is import("./events.js").ToolCallView {
  if (!isPlainObject(v)) return false;
  switch (v.card) {
    case "generic":
      return isGenericCallView(v);
    case "terminal":
      return isTerminalCallView(v);
    case "diff":
      return isDiffCallView(v);
    default:
      return false;
  }
}

function isGenericResultView(v: unknown): v is import("./events.js").GenericResultView {
  if (!isPlainObject(v) || v.card !== "generic") return false;
  if (v.title !== undefined && typeof v.title !== "string") return false;
  return true;
}

function isTerminalResultView(v: unknown): v is import("./events.js").TerminalResultView {
  if (!isPlainObject(v) || v.card !== "terminal") return false;
  if (v.title !== undefined && typeof v.title !== "string") return false;
  if (v.output !== undefined && typeof v.output !== "string") return false;
  if (v.exitCode !== undefined && typeof v.exitCode !== "number") return false;
  if (v.signal !== undefined && typeof v.signal !== "string") return false;
  return true;
}

function isDiffResultView(v: unknown): v is import("./events.js").DiffResultView {
  if (!isPlainObject(v) || v.card !== "diff") return false;
  if (v.title !== undefined && typeof v.title !== "string") return false;
  if (!Array.isArray(v.diffs) || !v.diffs.every(isFileDiff)) return false;
  return true;
}

function isSearchLineMatch(v: unknown): v is import("./events.js").SearchLineMatch {
  if (!isPlainObject(v)) return false;
  return typeof v.lineNumber === "number" && typeof v.line === "string";
}

function isSearchFileMatches(v: unknown): v is import("./events.js").SearchFileMatches {
  if (!isPlainObject(v)) return false;
  if (typeof v.path !== "string") return false;
  if (!Array.isArray(v.matches) || !v.matches.every(isSearchLineMatch)) return false;
  return true;
}

function isSearchMatchesResultView(v: unknown): v is import("./events.js").SearchMatchesResultView {
  if (!isPlainObject(v) || v.card !== "search" || v.shape !== "matches") return false;
  if (v.title !== undefined && typeof v.title !== "string") return false;
  if (!Array.isArray(v.files) || !v.files.every(isSearchFileMatches)) return false;
  if (typeof v.truncated !== "boolean" || typeof v.total !== "number") return false;
  return true;
}

function isSearchPathsResultView(v: unknown): v is import("./events.js").SearchPathsResultView {
  if (!isPlainObject(v) || v.card !== "search" || v.shape !== "paths") return false;
  if (v.title !== undefined && typeof v.title !== "string") return false;
  if (!Array.isArray(v.paths) || !v.paths.every((p) => typeof p === "string")) return false;
  if (typeof v.truncated !== "boolean" || typeof v.total !== "number") return false;
  return true;
}

function isSearchResultView(v: unknown): v is import("./events.js").SearchResultView {
  if (!isPlainObject(v) || v.card !== "search") return false;
  if (v.shape === "matches") return isSearchMatchesResultView(v);
  if (v.shape === "paths") return isSearchPathsResultView(v);
  return false;
}

function isReadFileLine(v: unknown): v is import("./events.js").ReadFileLine {
  if (!isPlainObject(v)) return false;
  return typeof v.number === "number" && typeof v.text === "string";
}

function isReadResultView(v: unknown): v is import("./events.js").ReadResultView {
  if (!isPlainObject(v) || v.card !== "read") return false;
  if (v.title !== undefined && typeof v.title !== "string") return false;
  if (typeof v.path !== "string") return false;
  if (typeof v.offset !== "number") return false;
  if (!Array.isArray(v.lines) || !v.lines.every(isReadFileLine)) return false;
  if (typeof v.totalLines !== "number") return false;
  if (v.lang !== undefined && typeof v.lang !== "string") return false;
  return true;
}

function isWebSource(v: unknown): v is import("./events.js").WebSource {
  if (!isPlainObject(v)) return false;
  if (typeof v.url !== "string") return false;
  if (v.title !== undefined && typeof v.title !== "string") return false;
  if (v.snippet !== undefined && typeof v.snippet !== "string") return false;
  if (v.publishedAt !== undefined && typeof v.publishedAt !== "string") return false;
  return true;
}

function isWebSearchResultView(v: unknown): v is import("./events.js").WebSearchResultView {
  if (!isPlainObject(v) || v.card !== "web" || v.kind !== "search") return false;
  if (v.title !== undefined && typeof v.title !== "string") return false;
  if (!Array.isArray(v.sources) || !v.sources.every(isWebSource)) return false;
  if (v.answer !== undefined && typeof v.answer !== "string") return false;
  if (typeof v.truncated !== "boolean") return false;
  return true;
}

function isWebFetchResultView(v: unknown): v is import("./events.js").WebFetchResultView {
  if (!isPlainObject(v) || v.card !== "web" || v.kind !== "fetch") return false;
  if (v.title !== undefined && typeof v.title !== "string") return false;
  if (typeof v.url !== "string") return false;
  if (typeof v.statusCode !== "number") return false;
  if (typeof v.truncated !== "boolean") return false;
  return true;
}

function isWebResultView(v: unknown): v is import("./events.js").WebResultView {
  if (!isPlainObject(v) || v.card !== "web") return false;
  if (v.kind === "search") return isWebSearchResultView(v);
  if (v.kind === "fetch") return isWebFetchResultView(v);
  return false;
}

function isToolResultView(v: unknown): v is import("./events.js").ToolResultView {
  if (!isPlainObject(v)) return false;
  switch (v.card) {
    case "generic":
      return isGenericResultView(v);
    case "terminal":
      return isTerminalResultView(v);
    case "diff":
      return isDiffResultView(v);
    case "search":
      return isSearchResultView(v);
    case "read":
      return isReadResultView(v);
    case "web":
      return isWebResultView(v);
    default:
      return false;
  }
}

function isToolEventView(v: unknown): v is import("./events.js").ToolEventView {
  if (!isPlainObject(v)) return false;
  if (v.for === "call") {
    return isToolCallView(v.view);
  }
  if (v.for === "result") {
    return isToolResultView(v.view);
  }
  return false;
}

export function isSessionEventWire(value: unknown): value is SessionEventWire {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.type)) return false;
  if (!isFiniteNumber(value.seq)) return false;
  if (!isFiniteNumber(value.time)) return false;
  if (!isPlainObject(value.data)) return false;
  if (value.view !== undefined && !isToolEventView(value.view)) return false;
  return true;
}

function validateInboundPayload(m: unknown, k: string): boolean {
  if (typeof m !== "object" || m === null) return false;
  if ((SETTINGS_INBOUND_KINDS as readonly string[]).includes(k)) {
    return isSettingsInboundCommand(m);
  }
  const o = m as Record<string, unknown>;
  switch (k) {
    case "listFileReferences":
      return typeof o.query === "string" && typeof o.requestId === "string";
    case "listSlashItems":
      return typeof o.requestId === "string" && o.requestId.length > 0;
    case "executeSlashCommand":
      if (typeof o.line !== "string" || !o.line.trimStart().startsWith("/")) return false;
      if (o.images !== undefined) {
        if (!Array.isArray(o.images)) return false;
        if (!o.images.every(isEncodedImageAttachment)) return false;
      }
      return true;
    case "submit":
      if (!hasOnlyOwnKeys(o, [
        "kind", "requestId", "mode", "text", "provider", "model", "permission", "images",
      ])) return false;
      if (typeof o.requestId !== "string" || o.requestId.length === 0) return false;
      if (o.mode !== "queue" && o.mode !== "steer") return false;
      if (typeof o.text !== "string") return false;
      if (o.images !== undefined) {
        if (!Array.isArray(o.images)) return false;
        if (!o.images.every(isEncodedImageAttachment)) return false;
      }
      return true;
    default:
      return true;
  }
}

function validateOutboundPayload(m: unknown, k: string): boolean {
  if (typeof m !== "object" || m === null) return false;
  if ((SETTINGS_OUTBOUND_KINDS as readonly string[]).includes(k)) {
    return isSettingsOutboundMessage(m);
  }
  const o = m as Record<string, unknown>;
  switch (k) {
    case "submitResult": {
      if (!hasOnlyOwnKeys(o, ["kind", "requestId", "result"])) return false;
      if (typeof o.requestId !== "string" || o.requestId.length === 0) return false;
      if (typeof o.result !== "object" || o.result === null || Array.isArray(o.result)) {
        return false;
      }
      const result = o.result as Record<string, unknown>;
      if (result.ok === true) return hasOnlyOwnKeys(result, ["ok"]);
      return result.ok === false
        && hasOnlyOwnKeys(result, ["ok", "detail"])
        && typeof result.detail === "string"
        && result.detail.length > 0;
    }
    case "fileReferences":
      if (typeof o.requestId !== "string") return false;
      if (!Array.isArray(o.items)) return false;
      if (!o.items.every(isFileReferenceItem)) return false;
      if (o.available !== undefined && typeof o.available !== "boolean") return false;
      return true;
    case "slashItems":
      if (typeof o.requestId !== "string" || o.requestId.length === 0) return false;
      if (!Array.isArray(o.items)) return false;
      if (!o.items.every(isSlashMenuItem)) return false;
      return isSlashAvailability(o.availability);
    case "event":
      return typeof o.sessionId === "string" && o.sessionId.length > 0
        && isSessionEventWire(o.event);
    case "history":
      return typeof o.sessionId === "string" && o.sessionId.length > 0
        && Array.isArray(o.events)
        && o.events.every(isSessionEventWire);
    default:
      return true;
  }
}

const CORE_OUTBOUND_KINDS = [
  "hello", "session", "ready", "sessions", "catalog", "permissions",
  "context", "history", "event", "ask", "status", "fileReferences", "slashItems",
  "submitResult",
] as const;
const OUTBOUND_KINDS = [...CORE_OUTBOUND_KINDS, ...SETTINGS_OUTBOUND_KINDS] as const;
const CORE_INBOUND_KINDS = [
  "submit", "answer", "cancel", "resume", "exit",
  "listSessions", "newSession", "selectModel", "selectPermission",
  "listFileReferences", "listSlashItems", "executeSlashCommand",
] as const;
const INBOUND_KINDS = [...CORE_INBOUND_KINDS, ...SETTINGS_INBOUND_KINDS] as const;

export function isOutboundMessage(m: unknown): m is OutboundMessage {
  const k = kindOf(m);
  return k !== undefined
    && (OUTBOUND_KINDS as readonly string[]).includes(k)
    && validateOutboundPayload(m, k);
}
export function isInboundMessage(m: unknown): m is InboundMessage {
  const k = kindOf(m);
  return k !== undefined
    && (INBOUND_KINDS as readonly string[]).includes(k)
    && validateInboundPayload(m, k);
}

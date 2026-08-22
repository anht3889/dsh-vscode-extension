import type { SessionEventWire } from "./events.js";

export const PROTOCOL_VERSION = 3;

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
export type OutboundMessage =
  | HelloMessage | SessionMessage | ReadyMessage | SessionsMessage
  | CatalogMessage | PermissionsMessage | ContextMessage | HistoryMessage
  | EventMessage | AskMessage | StatusMessage | FileReferencesMessage;

export interface SubmitCommand {
  kind: "submit";
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
export type InboundMessage =
  | SubmitCommand | AnswerCommand | CancelCommand | ResumeCommand | ExitCommand
  | ListSessionsCommand | NewSessionCommand | SelectModelCommand | SelectPermissionCommand
  | ListFileReferencesCommand;

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

function validateInboundPayload(m: unknown, k: string): boolean {
  if (typeof m !== "object" || m === null) return false;
  const o = m as Record<string, unknown>;
  switch (k) {
    case "listFileReferences":
      return typeof o.query === "string" && typeof o.requestId === "string";
    case "submit":
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
  const o = m as Record<string, unknown>;
  switch (k) {
    case "fileReferences":
      if (typeof o.requestId !== "string") return false;
      if (!Array.isArray(o.items)) return false;
      if (!o.items.every(isFileReferenceItem)) return false;
      if (o.available !== undefined && typeof o.available !== "boolean") return false;
      return true;
    default:
      return true;
  }
}

const OUTBOUND_KINDS = [
  "hello", "session", "ready", "sessions", "catalog", "permissions",
  "context", "history", "event", "ask", "status", "fileReferences",
] as const;
const INBOUND_KINDS = [
  "submit", "answer", "cancel", "resume", "exit",
  "listSessions", "newSession", "selectModel", "selectPermission",
  "listFileReferences",
] as const;

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

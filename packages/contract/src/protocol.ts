import type { SessionEventWire } from "./events.js";

export const PROTOCOL_VERSION = 2;

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
export type OutboundMessage =
  | HelloMessage | SessionMessage | ReadyMessage | SessionsMessage
  | CatalogMessage | PermissionsMessage | ContextMessage | HistoryMessage
  | EventMessage | AskMessage | StatusMessage;

export interface SubmitCommand {
  kind: "submit";
  text: string;
  provider?: string;
  model?: string;
  permission?: string;
}
export interface AnswerCommand { kind: "answer"; askId: string; answered: AskAnswerWire }
export interface CancelCommand { kind: "cancel"; cause?: "user" }
export interface ResumeCommand { kind: "resume"; sessionId: string }
export interface ExitCommand { kind: "exit" }
export interface ListSessionsCommand { kind: "listSessions" }
export interface NewSessionCommand { kind: "newSession" }
export interface SelectModelCommand { kind: "selectModel"; provider: string; model: string }
export interface SelectPermissionCommand { kind: "selectPermission"; preset: string }
export type InboundMessage =
  | SubmitCommand | AnswerCommand | CancelCommand | ResumeCommand | ExitCommand
  | ListSessionsCommand | NewSessionCommand | SelectModelCommand | SelectPermissionCommand;

// ---- question/answer wire types (mirror dsh-user-questions types, dependency-free) ----
export interface AskQuestionWire { id: string; question: string; detail?: string; header?: string; options?: { label: string; description?: string }[]; multiSelect?: boolean }
export interface AskAnswerWire { answers: { id: string; selected: string[]; custom?: string }[] }

function kindOf(m: unknown): string | undefined {
  if (typeof m !== "object" || m === null) return undefined;
  return (m as { kind?: unknown }).kind as string | undefined;
}

const OUTBOUND_KINDS = [
  "hello", "session", "ready", "sessions", "catalog", "permissions",
  "context", "history", "event", "ask", "status",
] as const;
const INBOUND_KINDS = [
  "submit", "answer", "cancel", "resume", "exit",
  "listSessions", "newSession", "selectModel", "selectPermission",
] as const;

export function isOutboundMessage(m: unknown): m is OutboundMessage {
  const k = kindOf(m);
  return k !== undefined && (OUTBOUND_KINDS as readonly string[]).includes(k);
}
export function isInboundMessage(m: unknown): m is InboundMessage {
  const k = kindOf(m);
  return k !== undefined && (INBOUND_KINDS as readonly string[]).includes(k);
}

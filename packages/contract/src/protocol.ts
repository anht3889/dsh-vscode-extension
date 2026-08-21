import type { SessionEventWire } from "./events.js";

export const PROTOCOL_VERSION = 1;

// ---- Outbound (bridge -> extension) ----
export interface HelloMessage         { kind: "hello";    version: number; dshVersion: string; cwd: string; model?: { provider: string; model: string } }
export interface SessionMessage       { kind: "session";  sessionId: string; cwd?: string; createdAt: number }
export interface EventMessage        { kind: "event";     sessionId: string; event: SessionEventWire }
export interface AskMessage          { kind: "ask";       askId: string; questions: AskQuestionWire[] }
export interface StatusMessage       { kind: "status";    state: "idle" | "thinking" | "awaiting-approval" | "error"; detail?: string; code?: string }
export type OutboundMessage = HelloMessage | SessionMessage | EventMessage | AskMessage | StatusMessage;

// ---- Inbound (extension -> bridge) ----
export interface SubmitCommand  { kind: "submit";  text: string }
export interface AnswerCommand  { kind: "answer";  askId: string; answered: AskAnswerWire }
export interface CancelCommand  { kind: "cancel";  cause?: "user" }
export interface ResumeCommand  { kind: "resume";  sessionId: string }
export interface ExitCommand    { kind: "exit" }
export type InboundMessage = SubmitCommand | AnswerCommand | CancelCommand | ExitCommand | ResumeCommand;

// ---- question/answer wire types (mirror dsh-user-questions types, dependency-free) ----
export interface AskQuestionWire { id: string; question: string; detail?: string; header?: string; options?: { label: string; description?: string }[]; multiSelect?: boolean }
export interface AskAnswerWire { answers: { id: string; selected: string[]; custom?: string }[] }

function kindOf(m: unknown): string | undefined {
  if (typeof m !== "object" || m === null) return undefined;
  return (m as { kind?: unknown }).kind as string | undefined;
}

const OUTBOUND_KINDS = ["hello", "session", "event", "ask", "status"] as const;
const INBOUND_KINDS = ["submit", "answer", "cancel", "resume", "exit"] as const;

export function isOutboundMessage(m: unknown): m is OutboundMessage {
  const k = kindOf(m);
  return k !== undefined && (OUTBOUND_KINDS as readonly string[]).includes(k);
}
export function isInboundMessage(m: unknown): m is InboundMessage {
  const k = kindOf(m);
  return k !== undefined && (INBOUND_KINDS as readonly string[]).includes(k);
}

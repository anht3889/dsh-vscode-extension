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

export function isOutboundMessage(m: unknown): m is OutboundMessage {
  return typeof m === "object" && m !== null &&
    (m as any).kind === "hello" || (m as any).kind === "session" || (m as any).kind === "event" || (m as any).kind === "ask" || (m as any).kind === "status";
}
export function isInboundMessage(m: unknown): m is InboundMessage {
  return typeof m === "object" && m !== null &&
    ["submit","answer","cancel","resume","exit"].includes((m as any).kind);
}

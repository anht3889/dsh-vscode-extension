import type { OutboundMessage } from "@dsh-vscode/contract";

export type DshState = "idle" | "thinking" | "awaiting-approval" | "error";

export interface StatusUi {
  state: DshState;
  text: string;
}

export function nextStatus(prev: DshState, msg: OutboundMessage): StatusUi {
  switch (msg.kind) {
    case "status":
      return { state: msg.state, text: msg.detail ?? descriptionFor(msg.state) };
    case "ask":
      return { state: "awaiting-approval", text: "Awaiting approval" };
    case "event":
      if (msg.event.type === "turn/start") {
        return { state: "thinking", text: "Thinking…" };
      }
      if (msg.event.type === "turn/end") {
        return { state: "idle", text: "Idle" };
      }
      return { state: prev, text: descriptionFor(prev) };
    default:
      return { state: prev, text: descriptionFor(prev) };
  }
}

function descriptionFor(state: DshState): string {
  switch (state) {
    case "idle": return "Idle";
    case "thinking": return "Thinking…";
    case "awaiting-approval": return "Awaiting approval";
    case "error": return "Error";
  }
}

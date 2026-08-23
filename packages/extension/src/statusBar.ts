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
      if (msg.event.type === "turn/start" || msg.event.type === "command/run") {
        return { state: "thinking", text: "Thinking…" };
      }
      if (msg.event.type === "turn/end" || msg.event.type === "command/done") {
        return { state: "idle", text: "Idle" };
      }
      return { state: prev, text: descriptionFor(prev) };
    default:
      return { state: prev, text: descriptionFor(prev) };
  }
}

/** Visible status posted when the host refuses a mismatched hello handshake. */
export function protocolMismatchStatus(
  bridgeVersion: number,
  extensionVersion: number,
): { kind: "status"; state: "error"; detail: string } {
  return {
    kind: "status",
    state: "error",
    detail: `protocol version mismatch: bridge=${bridgeVersion} extension=${extensionVersion}`,
  };
}

function descriptionFor(state: DshState): string {
  switch (state) {
    case "idle": return "Idle";
    case "thinking": return "Thinking…";
    case "awaiting-approval": return "Awaiting approval";
    case "error": return "Error";
  }
}

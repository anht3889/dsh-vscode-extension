import { describe, it, expect } from "vitest";
import { nextStatus } from "./statusBar.js";
import type { OutboundMessage } from "@dsh-vscode/contract";

function status(state: "idle" | "thinking" | "awaiting-approval" | "error", detail?: string): OutboundMessage {
  return { kind: "status", state, ...(detail ? { detail } : {}) };
}
function ask(): OutboundMessage {
  return { kind: "ask", askId: "a1", questions: [{ id: "q1", question: "Confirm?" }] };
}
function event(type: string): OutboundMessage {
  return { kind: "event", sessionId: "s", event: { type, seq: 0, time: 0, data: {} } };
}

describe("statusBar.nextStatus", () => {
  it("transition turn/start -> thinking", () => {
    expect(nextStatus("idle", event("turn/start")).state).toBe("thinking");
  });
  it("ask -> awaiting-approval", () => {
    expect(nextStatus("thinking", ask())).toEqual({ state: "awaiting-approval", text: "Awaiting approval" });
  });
  it("turn/end -> idle", () => {
    expect(nextStatus("thinking", event("turn/end"))).toEqual({ state: "idle", text: "Idle" });
  });
  it("status mirrors state and uses detail", () => {
    expect(nextStatus("idle", status("error", "boom"))).toEqual({ state: "error", text: "boom" });
  });
  it("status without detail falls back to description", () => {
    expect(nextStatus("idle", status("thinking"))).toEqual({ state: "thinking", text: "Thinking…" });
  });
  it("unrecognized status state still mirrors state", () => {
    const m = status("error");
    expect(nextStatus("idle", m).state).toBe("error");
  });
  it("non-turn event keeps previous state with description", () => {
    expect(nextStatus("awaiting-approval", event("message"))).toEqual({ state: "awaiting-approval", text: "Awaiting approval" });
  });
  it("ready and catalog messages keep the previous state", () => {
    const ready: OutboundMessage = {
      kind: "ready",
      sessionId: "s",
      cwd: "/tmp",
      models: {
        current: { provider: "p", model: "m" },
        models: [],
      },
      permissions: {
        current: "workspace-write",
        presets: [],
      },
    };
    expect(nextStatus("thinking", ready).state).toBe("thinking");
    expect(
      nextStatus("idle", {
        kind: "catalog",
        current: { provider: "p", model: "m" },
        models: [],
      }).state,
    ).toBe("idle");
  });
});

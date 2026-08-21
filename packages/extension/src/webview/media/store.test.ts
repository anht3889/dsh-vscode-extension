import { describe, it, expect } from "vitest";
import type { EventMessage, AskQuestionWire, OutboundMessage } from "@dsh-vscode/contract";
import { reduce, initialState, type UiState } from "./store.js";

// Typed fixtures — no `as any` (pre-flight ruling #2). The bridge emits real
// SessionEventWire-shaped events with a verbatim `data` record; these fixtures
// mirror that shape without erasing types.

function eventMsg(type: string, data: Record<string, unknown>): EventMessage {
  return {
    kind: "event",
    sessionId: "s1",
    event: { type, seq: 1, time: 0, data },
  };
}

function textChunk(text: string, delta = false): EventMessage {
  return eventMsg("assistant/chunk", { text, delta });
}

function assistantMessage(text: string): EventMessage {
  return eventMsg("assistant/message", {
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

const QUESTION: AskQuestionWire = {
  id: "q1",
  question: "Proceed?",
  options: [{ label: "Yes" }, { label: "No" }],
};

function askMsg(askId = "a1"): OutboundMessage {
  return { kind: "ask", askId, questions: [QUESTION] };
}

describe("reduce", () => {
  it("appends assistant/chunk text to the stream", () => {
    const s = reduce(initialState, textChunk("hel"));
    const s2 = reduce(s, textChunk("lo"));
    expect(s2.stream).toContain("hel");
    expect(s2.stream).toContain("lo");
  });

  it("appends assistant/message text to the stream", () => {
    const s = reduce(initialState, assistantMessage("hi there"));
    expect(s.stream).toContain("hi there");
  });

  it("sets approval from an ask message", () => {
    const s = reduce(initialState, askMsg("ask-1"));
    expect(s.approval).toEqual({ askId: "ask-1", questions: [QUESTION] });
  });

  it("records tool/result diffs into diffs", () => {
    const s = reduce(
      initialState,
      eventMsg("tool/result", {
        meta: { path: "/x/a.ts", oldText: "a", newText: "b" },
      }),
    );
    expect(s.diffs).toContainEqual({ path: "/x/a.ts", oldText: "a", newText: "b" });
  });

  it("ignores tool/result events without a diff-shaped meta", () => {
    const s = reduce(initialState, eventMsg("tool/result", { meta: { command: "ls" } }));
    expect(s.diffs).toEqual([]);
  });

  it("resets stream and diffs on turn/start (per-turn accumulation)", () => {
    const withDiffs = reduce(
      initialState,
      eventMsg("tool/result", {
        meta: { path: "/x/a.ts", oldText: "a", newText: "b" },
      }),
    );
    expect(withDiffs.diffs).toHaveLength(1);

    const s = reduce(withDiffs, eventMsg("turn/start", {}));
    expect(s.diffs).toEqual([]);
    expect(s.stream).toEqual([]);
  });

  it("returns the same state object for unhandled messages (no-op)", () => {
    const s = reduce(initialState, textChunk("x"));
    const same = reduce(s, { kind: "status", state: "idle" });
    expect(same).toBe(s);
  });
});

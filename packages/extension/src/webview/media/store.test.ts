import { describe, it, expect } from "vitest";
import type { EventMessage, AskQuestionWire, OutboundMessage } from "@dsh-vscode/contract";
import {
  contextPercent,
  filterSessions,
  reduce,
  initialState,
  type UiState,
} from "./store.js";

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

function statusMsg(state: "idle" | "thinking" | "error", detail?: string): OutboundMessage {
  return { kind: "status", state, detail };
}

describe("reduce", () => {
  it("starts disabled and becomes ready from the bridge snapshot", () => {
    expect(initialState.starting).toBe(true);
    expect(initialState.ready).toBe(false);
    const state = reduce(initialState, {
      kind: "ready",
      sessionId: "s1",
      cwd: "/tmp",
      models: {
        current: { provider: "p", model: "m" },
        models: [{ provider: "p", model: "m", label: "M" }],
      },
      permissions: {
        current: "workspace-write",
        presets: [{ id: "workspace-write", label: "Workspace Write" }],
      },
      context: { used: 50, window: 100 },
    });
    expect(state.starting).toBe(false);
    expect(state.ready).toBe(true);
    expect(state.sessionId).toBe("s1");
    expect(state.context).toEqual({ used: 50, window: 100 });
  });

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

  it("preserves chat history and resets diffs on turn/start", () => {
    const withText = reduce(initialState, assistantMessage("previous turn"));
    const withDiffs = reduce(
      withText,
      eventMsg("tool/result", {
        meta: { path: "/x/a.ts", oldText: "a", newText: "b" },
      }),
    );
    expect(withDiffs.diffs).toHaveLength(1);

    const s = reduce(withDiffs, eventMsg("turn/start", {}));
    expect(s.diffs).toEqual([]);
    expect(s.stream).toEqual(["previous turn"]);
    expect(s.status).toBe("thinking");
  });

  it("replaces stream from resumed history", () => {
    const state = reduce(reduce(initialState, assistantMessage("old")), {
      kind: "history",
      sessionId: "resumed",
      events: [
        {
          type: "assistant/message",
          seq: 1,
          time: 1,
          data: {
            message: {
              role: "assistant",
              content: [{ type: "text", text: "restored" }],
            },
          },
        },
      ],
    });
    expect(state.sessionId).toBe("resumed");
    expect(state.stream).toEqual(["restored"]);
  });

  it("clears per-session state when the session changes", () => {
    const populated: UiState = {
      ...initialState,
      sessionId: "old",
      stream: ["old"],
      diffs: [{ path: "/x", oldText: "a", newText: "b" }],
      approval: { askId: "a", questions: [QUESTION] },
    };
    const state = reduce(populated, {
      kind: "session",
      sessionId: "new",
      cwd: "/tmp",
      createdAt: 1,
    });
    expect(state.stream).toEqual([]);
    expect(state.diffs).toEqual([]);
    expect(state.approval).toBeUndefined();
  });

  it("folds recent availability and picker updates", () => {
    const sessions = reduce(initialState, {
      kind: "sessions",
      available: false,
      items: [
        {
          sessionId: "s",
          title: "Build UI",
          createdAt: 1,
          updatedAt: 2,
          cwd: "/tmp",
        },
      ],
    });
    expect(sessions.sessionsUnavailable).toBe(true);
    expect(sessions.sessions).toHaveLength(1);

    const catalog = reduce(sessions, {
      kind: "catalog",
      current: { provider: "p", model: "m" },
      models: [{ provider: "p", model: "m", label: "Model" }],
    });
    expect(catalog.models?.current.model).toBe("m");
  });

  it("returns the same state object for unhandled messages (no-op)", () => {
    const s = reduce(initialState, textChunk("x"));
    // `hello` is host-only and never forwarded to the webview by panel.ts, so it
    // is a genuine no-op here.
    const same = reduce(s, { kind: "hello", version: 1, dshVersion: "x", cwd: "/" });
    expect(same).toBe(s);
  });

  it("surfaces status:error as a visible error", () => {
    const s = reduce(initialState, statusMsg("error", "dsh process exited with code 1"));
    expect(s.error).toBe("dsh process exited with code 1");
    expect(s.starting).toBe(false);
    expect(s.ready).toBe(false);
  });

  it("clears the error on status:idle", () => {
    const errored = reduce(initialState, statusMsg("error", "boom"));
    expect(errored.error).toBe("boom");
    const s = reduce(errored, statusMsg("idle"));
    expect(s.error).toBeUndefined();
  });
});

describe("composer helpers", () => {
  const sessions = [
    {
      sessionId: "1",
      title: "Fix sidebar",
      createdAt: 1,
      updatedAt: 2,
      cwd: "/tmp",
    },
    {
      sessionId: "2",
      title: "Write tests",
      createdAt: 1,
      updatedAt: 1,
      cwd: "/tmp",
    },
  ];

  it("filters recent sessions by title", () => {
    expect(filterSessions(sessions, "SIDE")).toEqual([sessions[0]]);
    expect(filterSessions(sessions, " ")).toEqual(sessions);
  });

  it("computes and caps context percentage", () => {
    expect(contextPercent(undefined)).toBeUndefined();
    expect(contextPercent({ used: 50, window: 100 })).toBe(50);
    expect(contextPercent({ used: 150, window: 100 })).toBe(100);
  });
});

import { describe, it, expect } from "vitest";
import type {
  EncodedImageAttachment,
  EventMessage,
  AskQuestionWire,
  OutboundMessage,
  SlashMenuItem,
  ToolEventView,
} from "@dsh-vscode/contract";
import { toolDiffsFromEvent } from "@dsh-vscode/contract";
import {
  contextPercent,
  filterSessions,
  reduce,
  initialState,
  serializeCommand,
  serializeDraft,
  type UiMessage,
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

function toolEventMsg(
  type: string,
  data: Record<string, unknown>,
  view: ToolEventView,
): EventMessage {
  return {
    ...eventMsg(type, data),
    event: { type, seq: 1, time: 0, data, view },
  };
}

// The real `assistant/chunk` payload wraps a StreamChunk: the text of one delta
// lives at `data.chunk.text`, not `data.text`.
function textDelta(text: string): EventMessage {
  return eventMsg("assistant/chunk", {
    turn: 1,
    step: 1,
    chunk: { type: "text-delta", index: 0, text },
  });
}

function reasoningDelta(text: string): EventMessage {
  return eventMsg("assistant/chunk", {
    turn: 1,
    step: 1,
    chunk: { type: "reasoning-delta", index: 0, text },
  });
}

function assistantMessage(...texts: string[]): EventMessage {
  return eventMsg("assistant/message", {
    turn: 1,
    step: 1,
    message: {
      role: "assistant",
      content: texts.map((text) => ({ type: "text", text })),
    },
  });
}

function userMessage(text: string, kind = "user"): EventMessage {
  return eventMsg("user/message", {
    id: "m1",
    role: "user",
    content: [{ type: "text", text }],
    source: { kind },
  });
}

const QUESTION: AskQuestionWire = {
  id: "q1",
  question: "Proceed?",
  options: [{ label: "Yes" }, { label: "No" }],
};

const PNG: EncodedImageAttachment = {
  mediaType: "image/png",
  data: "AQ==",
  name: "shot.png",
};

const COMPACT: SlashMenuItem = {
  source: "command",
  name: "compact",
  description: "Compact context",
  behavior: "execute",
};

const GOAL: SlashMenuItem = {
  source: "command",
  name: "goal",
  description: "Set the goal",
  behavior: "command-input",
  hint: "<objective>",
  acceptsImages: true,
};

const BRAINSTORMING: SlashMenuItem = {
  source: "skill",
  name: "brainstorming",
  description: "Design first",
  behavior: "insert",
};

/** The picker only opens once the bridge is ready, so picker cases start here. */
const readyState: UiState = { ...initialState, starting: false, ready: true };

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

  it("coalesces streamed deltas into one growing assistant entry", () => {
    const first = reduce(initialState, textDelta("## Hel"));
    const second = reduce(first, textDelta("lo"));
    expect(second.timeline).toEqual([
      { kind: "assistant", seq: 1, text: "## Hello", streaming: true },
    ]);
  });

  it("streams reasoning then collapses it when answer text starts", () => {
    const thinking = reduce(initialState, reasoningDelta("line one\nline two"));
    expect(thinking.timeline).toEqual([
      { kind: "thinking", seq: 1, text: "line one\nline two", running: true },
    ]);
    const answered = reduce(thinking, textDelta("Hello"));
    expect(answered.timeline).toEqual([
      { kind: "thinking", seq: 1, text: "line one\nline two", running: false },
      { kind: "assistant", seq: 1, text: "Hello", streaming: true },
    ]);
  });

  it("finalizes thinking from assistant/message", () => {
    const thinking = reduce(initialState, reasoningDelta("analysis"));
    const answered = reduce(thinking, assistantMessage("answer"));
    expect(answered.timeline).toEqual([
      { kind: "thinking", seq: 1, text: "analysis", running: false },
      { kind: "assistant", seq: 1, text: "answer", streaming: false },
    ]);
  });

  it("finalizes thinking on assistant/analysis-end", () => {
    const thinking = reduce(initialState, reasoningDelta("analysis"));
    const ended = reduce(
      thinking,
      eventMsg("assistant/analysis-end", { turn: 1, step: 1 }),
    );
    expect(ended.timeline).toEqual([
      { kind: "thinking", seq: 1, text: "analysis", running: false },
    ]);
  });

  it("finalizes thinking and assistant text on turn/end", () => {
    const running: UiState = {
      ...initialState,
      timeline: [
        { kind: "thinking", seq: 1, text: "analysis", running: true },
        { kind: "assistant", seq: 1, text: "answer", streaming: true },
      ],
    };
    const ended = reduce(running, eventMsg("turn/end", { turn: 1 }));
    expect(ended.timeline).toEqual([
      { kind: "thinking", seq: 1, text: "analysis", running: false },
      { kind: "assistant", seq: 1, text: "answer", streaming: false },
    ]);
  });

  it("ignores other chunk types", () => {
    expect(
      reduce(initialState, eventMsg("assistant/chunk", { chunk: { type: "usage" } })),
    ).toBe(initialState);
  });

  it("finalizes the streamed entry from assistant/message instead of duplicating it", () => {
    const streamed = reduce(initialState, textDelta("Hell"));
    const done = reduce(streamed, assistantMessage("Hello"));
    expect(done.timeline).toEqual([
      { kind: "assistant", seq: 1, text: "Hello", streaming: false },
    ]);
  });

  it("keeps streamed text when the assembled message carries none", () => {
    const streamed = reduce(initialState, textDelta("partial"));
    const toolOnly = reduce(streamed, assistantMessage());
    expect(toolOnly.timeline).toEqual([
      { kind: "assistant", seq: 1, text: "partial", streaming: false },
    ]);
  });

  it("joins multiple text blocks of one assembled message", () => {
    const s = reduce(initialState, assistantMessage("first", "second"));
    expect(s.timeline[0]).toMatchObject({ text: "first\n\nsecond" });
  });

  it("starts a new entry for each step of a multi-step turn", () => {
    const step1 = reduce(reduce(initialState, textDelta("looking")), assistantMessage("looking"));
    const step2 = reduce(reduce(step1, textDelta("done")), assistantMessage("done"));
    expect(step2.timeline.map((entry) => "text" in entry ? entry.text : "")).toEqual([
      "looking",
      "done",
    ]);
  });

  it("shows the person's own message and hides injected context messages", () => {
    const typed = reduce(initialState, userMessage("hi there"));
    expect(typed.timeline).toEqual([
      { kind: "user", seq: 1, text: "hi there" },
    ]);
    for (const kind of ["plugin", "session-reference", "subagent-report"]) {
      expect(reduce(typed, userMessage("injected", kind))).toBe(typed);
    }
  });

  it("closes a dangling streamed entry when the next turn starts", () => {
    const dangling = reduce(initialState, textDelta("cut off"));
    const next = reduce(dangling, eventMsg("turn/start", { turn: 2 }));
    expect(next.timeline).toEqual([
      { kind: "assistant", seq: 1, text: "cut off", streaming: false },
    ]);
  });

  it("folds turn/start identically for live events and history", () => {
    const events = [
      reasoningDelta("analysis").event,
      eventMsg("turn/start", { turn: 2 }).event,
    ];
    const live = events.reduce(
      (state, event) =>
        reduce(state, { kind: "event", sessionId: "s1", event }),
      initialState,
    );
    const replayed = reduce(initialState, {
      kind: "history",
      sessionId: "s1",
      events,
    });
    expect(live.timeline).toEqual([
      { kind: "thinking", seq: 1, text: "analysis", running: false },
    ]);
    expect(replayed.timeline).toEqual(live.timeline);
  });

  it("projects a resumed history into the same timeline", () => {
    const resumed = reduce(initialState, {
      kind: "history",
      sessionId: "s1",
      events: [
        userMessage("ask").event,
        userMessage("injected", "plugin").event,
        textDelta("par").event,
        textDelta("tial").event,
        assistantMessage("partial answer").event,
      ],
    });
    expect(resumed.timeline).toEqual([
      { kind: "user", seq: 1, text: "ask" },
      { kind: "assistant", seq: 1, text: "partial answer", streaming: false },
    ]);
  });

  it("folds command/run once from authoritative name and args fields", () => {
    const running = reduce(
      reduce(initialState, textDelta("unfinished")),
      eventMsg("command/run", {
        commandId: "cmd-1",
        name: "goal",
        args: " write tests",
        source: { kind: "user" },
      }),
    );
    expect(running.timeline).toEqual([
      { kind: "assistant", seq: 1, text: "unfinished", streaming: false },
      {
        kind: "command",
        commandId: "cmd-1",
        seq: 1,
        name: "goal",
        args: " write tests",
        status: "running",
      },
    ]);
    const done = reduce(
      running,
      eventMsg("command/done", {
        commandId: "cmd-1",
        kind: "success",
        text: "ok",
      }),
    );
    expect(done.timeline.at(-1)).toMatchObject({ status: "success", output: "ok" });
    expect(done.status).toBe("idle");
  });

  it("closes running thinking and streaming assistant rows before command/run", () => {
    const withRunningRows: UiState = {
      ...initialState,
      sessionId: "s1",
      timeline: [
        { kind: "thinking", seq: 1, text: "analysis", running: true },
        { kind: "assistant", seq: 1, text: "partial answer", streaming: true },
      ],
    };

    const afterCommand = reduce(
      withRunningRows,
      eventMsg("command/run", {
        commandId: "cmd-1",
        name: "compact",
        source: { kind: "user" },
      }),
    );
    expect(afterCommand.timeline).toEqual([
      { kind: "thinking", seq: 1, text: "analysis", running: false },
      { kind: "assistant", seq: 1, text: "partial answer", streaming: false },
      {
        kind: "command",
        commandId: "cmd-1",
        seq: 1,
        name: "compact",
        args: null,
        status: "running",
      },
    ]);
    expect(afterCommand.timeline.some((row) => row.kind === "user")).toBe(false);
  });

  it("folds command/run history and omits unrecorded command input", () => {
    const resumed = reduce(initialState, {
      kind: "history",
      sessionId: "s1",
      events: [
        eventMsg("command/run", {
          commandId: "cmd-1",
          name: "compact",
          source: { kind: "user" },
        }).event,
        eventMsg("command/done", {
          commandId: "cmd-1",
          kind: "success",
        }).event,
      ],
    });
    expect(resumed.timeline).toEqual([
      {
        kind: "command",
        commandId: "cmd-1",
        seq: 1,
        name: "compact",
        args: null,
        status: "success",
      },
    ]);
  });

  it("appends command/done without a matching run", () => {
    const s = reduce(
      initialState,
      eventMsg("command/done", { commandId: "x", kind: "error", text: "nope" }),
    );
    expect(s.timeline[0]).toMatchObject({
      kind: "command",
      commandId: "x",
      name: "",
      status: "error",
      output: "nope",
    });
  });

  it("settles only an exact success kind as success", () => {
    for (const kind of ["cancelled", "aborted", undefined]) {
      const settled = reduce(
        initialState,
        eventMsg("command/done", { commandId: "x", kind }),
      );
      expect(settled.timeline[0]).toMatchObject({
        kind: "command",
        status: "error",
      });
    }
  });

  it("folds command events identically for live events and history", () => {
    const events = [
      eventMsg("command/run", {
        commandId: "cmd-1",
        name: "goal",
        args: " write tests",
        source: { kind: "user" },
      }).event,
      eventMsg("command/done", {
        commandId: "cmd-1",
        kind: "success",
        text: "ok",
      }).event,
    ];
    const live = events.reduce(
      (state, event) =>
        reduce(state, { kind: "event", sessionId: "s1", event }),
      initialState,
    );
    const replayed = reduce(initialState, {
      kind: "history",
      sessionId: "s1",
      events,
    });
    expect(replayed.timeline).toEqual(live.timeline);
  });

  it("sets approval from an ask message", () => {
    const s = reduce(initialState, askMsg("ask-1"));
    expect(s.approval).toEqual({ askId: "ask-1", questions: [QUESTION] });
  });

  it("clears a matching approval after its answer is sent", () => {
    const pending = reduce(initialState, askMsg("ask-1"));
    const settled = reduce(pending, {
      kind: "askSettled",
      askId: "ask-1",
    });
    expect(settled.approval).toBeUndefined();
    expect(settled.status).toBe("thinking");
  });

  it("clears an aborted approval when the turn ends", () => {
    const pending = reduce(initialState, askMsg("ask-1"));
    const ended = reduce(pending, eventMsg("turn/end", {}));
    expect(ended.approval).toBeUndefined();
    expect(ended.status).toBe("idle");
  });

  it("keeps parent approval state across foreign-session turn events", () => {
    const pending: UiState = {
      ...reduce(initialState, askMsg("ask-1")),
      sessionId: "parent",
    };
    const foreignEnd: OutboundMessage = {
      kind: "event",
      sessionId: "child",
      event: { type: "turn/end", seq: 1, time: 1, data: {} },
    };
    expect(reduce(pending, foreignEnd)).toBe(pending);
  });

  it("upserts a running tool from tool-call-delta and tool/call", () => {
    const first = reduce(initialState, eventMsg("assistant/chunk", {
      turn: 1,
      step: 1,
      chunk: {
        type: "tool-call-delta",
        index: 0,
        id: "c1",
        name: "bash",
        argumentsDelta: "{\"command\":",
      },
    }));
    const delta = reduce(first, eventMsg("assistant/chunk", {
      turn: 1,
      step: 1,
      chunk: {
        type: "tool-call-delta",
        index: 0,
        id: "c1",
        argumentsDelta: "\"ls\"}",
      },
    }));
    expect(delta.timeline).toMatchObject([{
      kind: "tool",
      callId: "c1",
      name: "bash",
      argsRaw: "{\"command\":\"ls\"}",
      status: "running",
    }]);

    const called = reduce(delta, eventMsg("tool/call", {
      turn: 1,
      step: 1,
      callId: "c1",
      name: "bash",
      arguments: "{\"command\":\"ls\"}",
    }));
    expect(called.timeline).toHaveLength(1);
    expect(called.timeline[0]).toMatchObject({
      kind: "tool",
      callId: "c1",
      name: "bash",
      argsRaw: "{\"command\":\"ls\"}",
      status: "running",
    });
  });

  it("upserts tool calls from the assembled assistant message", () => {
    const state = reduce(initialState, eventMsg("assistant/message", {
      turn: 1,
      step: 1,
      message: {
        id: "m1",
        role: "assistant",
        source: { kind: "model", provider: "p", model: "m" },
        content: [{
          type: "tool-call",
          id: "c1",
          name: "read",
          arguments: "{\"path\":\"/a.ts\"}",
        }],
      },
    }));
    expect(state.timeline).toMatchObject([{
      kind: "tool",
      callId: "c1",
      name: "read",
      argsRaw: "{\"path\":\"/a.ts\"}",
      status: "running",
    }]);
  });

  it("stores valid call and result views and ignores malformed views", () => {
    const called = reduce(initialState, toolEventMsg("tool/call", {
      turn: 1,
      step: 1,
      callId: "c1",
      name: "bash",
      arguments: "{\"command\":\"ls\"}",
    }, {
      for: "call",
      view: {
        card: "terminal",
        title: "ls",
        description: "List files",
      },
    }));
    const done = reduce(called, toolEventMsg("tool/result", {
      turn: 1,
      step: 1,
      message: {
        id: "m1",
        role: "user",
        source: { kind: "tool", callId: "c1" },
        content: [{
          type: "tool-result",
          toolCallId: "c1",
          content: [{ type: "text", text: "ok" }],
          isError: false,
        }],
      },
    }, {
      for: "result",
      view: { card: "terminal", output: "ok", exitCode: 0 },
    }));
    expect(done.timeline[0]).toMatchObject({
      kind: "tool",
      callView: { card: "terminal", title: "ls", description: "List files" },
      resultView: { card: "terminal", output: "ok", exitCode: 0 },
    });

    const malformed = {
      ...eventMsg("tool/call", {
        callId: "c2",
        name: "read",
        arguments: "{\"path\":\"/a.ts\"}",
      }),
      event: {
        type: "tool/call",
        seq: 1,
        time: 0,
        data: {
          callId: "c2",
          name: "read",
          arguments: "{\"path\":\"/a.ts\"}",
        },
        view: { for: "call", view: { card: "terminal", title: 42 } },
      },
    } as unknown as EventMessage;
    expect(reduce(initialState, malformed).timeline[0]).toMatchObject({
      kind: "tool",
      callId: "c2",
      name: "read",
      argsRaw: "{\"path\":\"/a.ts\"}",
    });
    expect(reduce(initialState, malformed).timeline[0]).not.toHaveProperty("callView");
  });

  it("settles tools from tool/result including non-diff results", () => {
    const running = reduce(initialState, eventMsg("tool/call", {
      turn: 1,
      step: 1,
      callId: "c1",
      name: "bash",
      arguments: "{}",
    }));
    const done = reduce(running, eventMsg("tool/result", {
      turn: 1,
      step: 1,
      message: {
        id: "m1",
        role: "user",
        source: { kind: "tool", callId: "c1" },
        content: [{
          type: "tool-result",
          toolCallId: "c1",
          content: [{ type: "text", text: "ok" }],
          isError: false,
        }],
      },
    }));
    expect(done.timeline[0]).toMatchObject({
      kind: "tool",
      status: "ok",
      resultText: "ok",
    });
    expect(done.diffs).toEqual([]);
  });

  it("keeps interrupted and failed tool result name and code", () => {
    for (const { error, status } of [
      {
        error: { name: "AbortError", code: "interrupted" },
        status: "stopped",
      },
      {
        error: { name: "Error", code: "fail", detail: "not retained" },
        status: "error",
      },
    ]) {
      const running = reduce(initialState, eventMsg("tool/call", {
        turn: 1,
        step: 1,
        callId: "c1",
        name: "bash",
        arguments: "{}",
      }));
      const failed = reduce(running, eventMsg("tool/result", {
        turn: 1,
        step: 1,
        message: {
          id: "m1",
          role: "user",
          source: { kind: "tool", callId: "c1" },
          content: [{
            type: "tool-result",
            toolCallId: "c1",
            content: [],
            isError: true,
          }],
        },
        error,
      }));
      expect(failed.timeline[0]).toMatchObject({
        kind: "tool",
        status,
        error: { name: error.name, code: error.code },
      });
      expect(failed.timeline[0]).not.toHaveProperty("error.detail");
    }
  });

  it("appends a fully settled tool result with no matching call", () => {
    const result = toolEventMsg("tool/result", {
      turn: 1,
      step: 1,
      message: {
        id: "m1",
        role: "user",
        source: { kind: "tool", callId: "orphan" },
        content: [{
          type: "tool-result",
          toolCallId: "orphan",
          content: [{ type: "text", text: "failed output" }],
          isError: true,
        }],
      },
      error: { name: "Error", code: "fail", detail: "not retained" },
      meta: { path: "/x/orphan.ts", oldText: "a", newText: "b" },
    }, {
      for: "result",
      view: {
        card: "diff",
        title: "Failed edit",
        diffs: [{ path: "/x/new.ts", oldText: null, newText: "new" }],
      },
    });
    const state = reduce(initialState, result);
    expect(state.timeline).toEqual([{
      kind: "tool",
      seq: 1,
      callId: "orphan",
      name: "tool",
      argsRaw: "",
      status: "error",
      resultText: "failed output",
      error: { name: "Error", code: "fail" },
      resultView: {
        card: "diff",
        title: "Failed edit",
        diffs: [{ path: "/x/new.ts", oldText: null, newText: "new" }],
      },
      diffs: [
        { path: "/x/orphan.ts", oldText: "a", newText: "b" },
        { path: "/x/new.ts", oldText: "", newText: "new" },
      ],
    }]);
    expect(state.diffs).toEqual([
      { path: "/x/orphan.ts", oldText: "a", newText: "b" },
      { path: "/x/new.ts", oldText: "", newText: "new" },
    ]);

    const replayed = reduce(initialState, {
      kind: "history",
      sessionId: "s1",
      events: [result.event],
    });
    expect(replayed.timeline).toEqual(state.timeline);
    expect(replayed.diffs).toEqual([]);
  });

  it("keeps unparseable raw arguments without throwing", () => {
    const state = reduce(initialState, eventMsg("tool/call", {
      turn: 1,
      step: 1,
      callId: "c1",
      name: "mystery",
      arguments: "{",
    }));
    expect(state.timeline[0]).toMatchObject({
      kind: "tool",
      callId: "c1",
      argsRaw: "{",
      status: "running",
    });
  });

  it("buffers a presenter-only diff for Apply all", () => {
    const running = reduce(initialState, eventMsg("tool/call", {
      turn: 1,
      step: 1,
      callId: "c1",
      name: "edit",
      arguments: "{}",
    }));
    const done = reduce(running, toolEventMsg("tool/result", {
      turn: 1,
      step: 1,
      message: {
        id: "m1",
        role: "user",
        source: { kind: "tool", callId: "c1" },
        content: [{
          type: "tool-result",
          toolCallId: "c1",
          content: [],
          isError: false,
        }],
      },
    }, {
      for: "result",
      view: {
        card: "diff",
        diffs: [{ path: "/x/new.ts", oldText: null, newText: "new" }],
      },
    }));
    expect(done.timeline[0]).toMatchObject({
      diffs: [{ path: "/x/new.ts", oldText: "", newText: "new" }],
    });
    expect(done.diffs).toEqual([
      { path: "/x/new.ts", oldText: "", newText: "new" },
    ]);
  });

  it("buffers diffs from a result that changes no timeline row", () => {
    const orphan = toolEventMsg("tool/result", {
      turn: 1,
      step: 1,
      // No `message.source.callId`: the fold cannot place a row, but the host
      // still records the edit, so Apply all must stay paired with it.
      message: { id: "m1", role: "user", content: [] },
      meta: { path: "/x/a.ts", oldText: "a", newText: "b" },
    }, {
      for: "result",
      view: {
        card: "diff",
        diffs: [{ path: "/x/new.ts", oldText: null, newText: "new" }],
      },
    });
    const state = reduce(initialState, orphan);
    expect(state.timeline).toEqual([]);
    expect(state.diffs).toEqual([
      { path: "/x/a.ts", oldText: "a", newText: "b" },
      { path: "/x/new.ts", oldText: "", newText: "new" },
    ]);
    expect(toolDiffsFromEvent(orphan.event)).toEqual(state.diffs);
  });

  it("buffers the same diffs the host applies for every result", () => {
    const results: EventMessage[] = [
      toolEventMsg("tool/result", {
        turn: 1,
        step: 1,
        message: {
          id: "m1",
          role: "user",
          source: { kind: "tool", callId: "c1" },
          content: [{
            type: "tool-result",
            toolCallId: "c1",
            content: [],
            isError: false,
          }],
        },
        meta: { path: "/x/a.ts", oldText: "a", newText: "b" },
      }, {
        for: "result",
        view: {
          card: "diff",
          diffs: [
            { path: "/x/a.ts", oldText: "a", newText: "b" },
            { path: "/x/b.ts", oldText: null, newText: "c" },
          ],
        },
      }),
      toolEventMsg("tool/result", {
        turn: 1,
        step: 1,
        message: {
          id: "m2",
          role: "user",
          source: { kind: "tool", callId: "c2" },
          content: [{
            type: "tool-result",
            toolCallId: "c2",
            content: [],
            isError: false,
          }],
        },
      }, {
        for: "result",
        view: { card: "terminal", output: "ok", exitCode: 0 },
      }),
      eventMsg("tool/result", {
        turn: 1,
        step: 1,
        message: {
          id: "m3",
          role: "user",
          source: { kind: "tool", callId: "c3" },
          content: [{
            type: "tool-result",
            toolCallId: "c3",
            content: [],
            isError: false,
          }],
        },
        arguments: { path: "/x/c.ts", oldText: "x", newText: "y" },
      }),
    ];
    const live = results.reduce(reduce, { ...initialState, sessionId: "s1" });
    // What the extension host pushes onto its Apply-all `pending` buffer.
    const hostPending = results.flatMap((result) =>
      toolDiffsFromEvent(result.event),
    );
    expect(live.diffs).toEqual(hostPending);
    expect(live.diffs).toEqual([
      { path: "/x/a.ts", oldText: "a", newText: "b" },
      { path: "/x/b.ts", oldText: "", newText: "c" },
      { path: "/x/c.ts", oldText: "x", newText: "y" },
    ]);
    // Every buffered diff is also visible on the row that produced it.
    expect(
      live.timeline.flatMap((row) => (row.kind === "tool" ? row.diffs : [])),
    ).toEqual(hostPending);

    const replayed = reduce({ ...initialState, sessionId: "s1" }, {
      kind: "history",
      sessionId: "s1",
      events: results.map((result) => result.event),
    });
    expect(replayed.timeline).toEqual(live.timeline);
    expect(replayed.diffs).toEqual([]);
  });

  it("records metadata and presenter diffs on the row and the apply buffer", () => {
    const running = reduce(initialState, eventMsg("tool/call", {
      turn: 1,
      step: 1,
      callId: "c1",
      name: "edit",
      arguments: "{}",
    }));
    const done = reduce(running, toolEventMsg("tool/result", {
      turn: 1,
      step: 1,
      message: {
        id: "m1",
        role: "user",
        source: { kind: "tool", callId: "c1" },
        content: [{
          type: "tool-result",
          toolCallId: "c1",
          content: [],
          isError: false,
        }],
      },
      meta: { path: "/x/a.ts", oldText: "a", newText: "b" },
    }, {
      for: "result",
      view: {
        card: "diff",
        diffs: [{ path: "/x/new.ts", oldText: null, newText: "new" }],
      },
    }));
    expect(done.timeline[0]).toMatchObject({
      kind: "tool",
      status: "ok",
      diffs: [
        { path: "/x/a.ts", oldText: "a", newText: "b" },
        { path: "/x/new.ts", oldText: "", newText: "new" },
      ],
    });
    expect(done.diffs).toEqual([
      { path: "/x/a.ts", oldText: "a", newText: "b" },
      { path: "/x/new.ts", oldText: "", newText: "new" },
    ]);
  });

  it("preserves chat history and resets diffs on turn/start", () => {
    const withText = reduce(initialState, assistantMessage("previous turn"));
    const running = reduce(withText, eventMsg("tool/call", {
      turn: 1,
      step: 1,
      callId: "c1",
      name: "edit",
      arguments: "{}",
    }));
    const withDiffs = reduce(
      running,
      eventMsg("tool/result", {
        turn: 1,
        step: 1,
        message: {
          id: "m1",
          role: "user",
          source: { kind: "tool", callId: "c1" },
          content: [{
            type: "tool-result",
            toolCallId: "c1",
            content: [],
            isError: false,
          }],
        },
        meta: { path: "/x/a.ts", oldText: "a", newText: "b" },
      }),
    );
    expect(withDiffs.diffs).toHaveLength(1);

    const s = reduce(withDiffs, eventMsg("turn/start", {}));
    expect(s.diffs).toEqual([]);
    expect(s.timeline).toEqual([
      { kind: "assistant", seq: 1, text: "previous turn", streaming: false },
      {
        kind: "tool",
        seq: 1,
        callId: "c1",
        name: "edit",
        argsRaw: "{}",
        status: "ok",
        diffs: [{ path: "/x/a.ts", oldText: "a", newText: "b" }],
      },
    ]);
    expect(s.status).toBe("thinking");
  });

  it("replaces the timeline from resumed history", () => {
    const state = reduce(reduce(initialState, assistantMessage("old")), {
      kind: "history",
      sessionId: "resumed",
      events: [assistantMessage("restored").event],
    });
    expect(state.sessionId).toBe("resumed");
    expect(state.timeline).toEqual([
      { kind: "assistant", seq: 1, text: "restored", streaming: false },
    ]);
  });

  it("clears per-session state when the session changes", () => {
    const populated: UiState = {
      ...initialState,
      sessionId: "old",
      timeline: [{ kind: "assistant", seq: 1, text: "old", streaming: false }],
      diffs: [{ path: "/x", oldText: "a", newText: "b" }],
      approval: { askId: "a", questions: [QUESTION] },
    };
    const state = reduce(populated, {
      kind: "session",
      sessionId: "new",
      cwd: "/tmp",
      createdAt: 1,
    });
    expect(state.timeline).toEqual([]);
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
    const s = reduce(initialState, textDelta("x"));
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

  it("keeps a ready composer usable after a nonfatal bridge error", () => {
    const readyState: UiState = { ...initialState, starting: false, ready: true };
    expect(reduce(readyState, statusMsg("error", "unknown model")).ready).toBe(
      true,
    );
  });

  it("disables the composer when the retained child disconnects", () => {
    const readyState: UiState = { ...initialState, starting: false, ready: true };
    const state = reduce(readyState, {
      kind: "hostDisconnected",
      detail: "dsh exited",
    });
    expect(state.ready).toBe(false);
    expect(state.error).toBe("dsh exited");
  });

  it("clears the error on status:idle", () => {
    const errored = reduce(initialState, statusMsg("error", "boom"));
    expect(errored.error).toBe("boom");
    const s = reduce(errored, statusMsg("idle"));
    expect(s.error).toBeUndefined();
  });

  it("drafts before ready without opening or searching the picker", () => {
    const typed = reduce(initialState, {
      kind: "pickerOpened",
      text: "read @",
      token: { start: 5, end: 6, query: "", quoted: false },
      requestId: "r1",
    });
    expect(typed.draft).toBe("read @");
    expect(typed.picker).toBeUndefined();
  });

  it("opens at an @ token and ignores stale search replies", () => {
    const opened = reduce(readyState, {
      kind: "pickerOpened",
      text: "read @src",
      token: { start: 5, end: 9, query: "src", quoted: false },
      requestId: "r2",
    });
    const stale = reduce(opened, {
      kind: "fileReferences",
      requestId: "r1",
      items: [{ path: "old", kind: "file" }],
    });
    expect(stale).toBe(opened);
    expect(opened.picker).toMatchObject({
      requestId: "r2",
      query: "src",
      tokenStart: 5,
      tokenEnd: 9,
    });
  });

  it("keeps attachment and slash picker actions isolated", () => {
    const slash = reduce(readyState, {
      kind: "slashPickerOpened",
      text: "/go",
      token: { start: 0, end: 3, query: "go", position: "leading" },
      requestId: "slash-1",
    });
    expect(reduce(slash, { kind: "pickerDismissed" })).toBe(slash);
    expect(
      reduce(slash, {
        kind: "fileReferences",
        requestId: "slash-1",
        items: [{ path: "wrong", kind: "file" }],
      }),
    ).toBe(slash);

    const attachment = reduce(readyState, {
      kind: "pickerOpened",
      text: "@src",
      token: { start: 0, end: 4, query: "src", quoted: false },
      requestId: "attachment-1",
    });
    expect(reduce(attachment, { kind: "slashPickerDismissed" })).toBe(attachment);
    expect(
      reduce(attachment, {
        kind: "slashItemsReceived",
        requestId: "attachment-1",
        items: [COMPACT],
        availability: { commands: true, skills: true },
      }),
    ).toBe(attachment);
  });

  it("closes a picker for settings without changing conversation composition", () => {
    const opened = reduce(readyState, {
      kind: "pickerOpened",
      text: "read @src",
      token: { start: 5, end: 9, query: "src", quoted: false },
      requestId: "attachment-1",
    });
    const state: UiState = {
      ...opened,
      timeline: [{ kind: "assistant", seq: 1, text: "Existing", streaming: false }],
      chips: [{
        id: "image-1",
        kind: "image",
        image: PNG,
        label: "shot.png",
      }],
      commandClaim: {
        name: "goal",
        token: "/goal ",
        hint: "<objective>",
        acceptsImages: true,
      },
    };

    const closed = reduce(state, { kind: "pickerClosedForSettings" });

    expect(closed).toEqual({ ...state, picker: undefined });
    expect(closed.draft).toBe("read @src");
    expect(closed.timeline).toBe(state.timeline);
    expect(closed.chips).toBe(state.chips);
    expect(closed.commandClaim).toBe(state.commandClaim);
  });

  it("opens a slash picker without a catalog", () => {
    const opened = reduce(readyState, {
      kind: "slashPickerOpened",
      text: "try /go",
      token: { start: 4, end: 7, query: "go", position: "inline" },
      requestId: "slash-1",
    });
    expect(opened.draft).toBe("try /go");
    expect(opened.picker).toMatchObject({
      kind: "slash",
      requestId: "slash-1",
      token: { start: 4, end: 7, query: "go", position: "inline" },
      catalog: [],
      groups: [],
      highlightedKey: undefined,
    });
  });

  it("accepts only the current slash catalog and highlights its first row", () => {
    const opened = reduce(readyState, {
      kind: "slashPickerOpened",
      text: "/",
      token: { start: 0, end: 1, query: "", position: "leading" },
      requestId: "slash-2",
    });
    const stale = reduce(opened, {
      kind: "slashItemsReceived",
      requestId: "slash-1",
      items: [COMPACT],
      availability: { commands: true, skills: true },
    });
    expect(stale).toBe(opened);

    const accepted = reduce(opened, {
      kind: "slashItemsReceived",
      requestId: "slash-2",
      items: [GOAL, BRAINSTORMING],
      availability: { commands: true, skills: true },
    });
    expect(accepted.picker).toMatchObject({
      kind: "slash",
      requestId: "slash-2",
      catalog: [GOAL, BRAINSTORMING],
      groups: [
        { source: "command", items: [GOAL] },
        { source: "skill", items: [BRAINSTORMING] },
      ],
      highlightedKey: "command:goal",
    });
  });

  it("filters slash query edits locally without changing the request id", () => {
    const opened = reduce(readyState, {
      kind: "slashPickerOpened",
      text: "/",
      token: { start: 0, end: 1, query: "", position: "leading" },
      requestId: "slash-1",
    });
    const loaded = reduce(opened, {
      kind: "slashItemsReceived",
      requestId: "slash-1",
      items: [COMPACT, GOAL, BRAINSTORMING],
      availability: { commands: true, skills: true },
    });
    const filtered = reduce(loaded, {
      kind: "slashTokenChanged",
      text: "/go",
      token: { start: 0, end: 3, query: "go", position: "leading" },
    });
    expect(filtered.draft).toBe("/go");
    expect(filtered.picker).toMatchObject({
      kind: "slash",
      requestId: "slash-1",
      token: { start: 0, end: 3, query: "go", position: "leading" },
      groups: [{ source: "command", items: [GOAL] }],
      highlightedKey: "command:goal",
    });
  });

  it("dismisses slash picker when the caret leaves its token", () => {
    const opened = reduce(readyState, {
      kind: "slashPickerOpened",
      text: "/go",
      token: { start: 0, end: 3, query: "go", position: "leading" },
      requestId: "slash-1",
    });
    const dismissed = reduce(opened, {
      kind: "slashTokenChanged",
      text: "/go later",
      token: undefined,
    });
    expect(dismissed.draft).toBe("/go later");
    expect(dismissed.picker).toBeUndefined();
  });

  it("moves slash highlight cyclically across grouped rows", () => {
    const opened = reduce(readyState, {
      kind: "slashPickerOpened",
      text: "/",
      token: { start: 0, end: 1, query: "", position: "leading" },
      requestId: "slash-1",
    });
    const loaded = reduce(opened, {
      kind: "slashItemsReceived",
      requestId: "slash-1",
      items: [COMPACT, BRAINSTORMING],
      availability: { commands: true, skills: true },
    });
    const down = reduce(loaded, { kind: "slashHighlightMoved", delta: 1 });
    expect(down.picker).toMatchObject({ highlightedKey: "skill:brainstorming" });
    const wrapped = reduce(down, { kind: "slashHighlightMoved", delta: 1 });
    expect(wrapped.picker).toMatchObject({ highlightedKey: "command:compact" });
    const up = reduce(wrapped, { kind: "slashHighlightMoved", delta: -1 });
    expect(up.picker).toMatchObject({ highlightedKey: "skill:brainstorming" });
  });

  it("inserts a picked skill without claiming command execution", () => {
    const opened = reduce(readyState, {
      kind: "slashPickerOpened",
      text: "use /brain now",
      token: { start: 4, end: 10, query: "brain", position: "inline" },
      requestId: "slash-1",
    });
    const picked = reduce(opened, {
      kind: "slashItemPicked",
      item: BRAINSTORMING,
    });
    expect(picked.draft).toBe("use /brainstorming  now");
    expect(picked.picker).toBeUndefined();
    expect(picked.commandClaim).toBeUndefined();
  });

  it("retains a valid leading command claim after an inline skill pick", () => {
    const claim = {
      name: "goal",
      token: "/goal ",
      hint: "<objective>",
      acceptsImages: true,
    };
    const opened = reduce(
      {
        ...readyState,
        draft: "/goal args /brain",
        commandClaim: claim,
      },
      {
        kind: "slashPickerOpened",
        text: "/goal args /brain",
        token: { start: 11, end: 17, query: "brain", position: "inline" },
        requestId: "slash-1",
      },
    );

    const picked = reduce(opened, {
      kind: "slashItemPicked",
      item: BRAINSTORMING,
    });

    expect(picked.draft).toBe("/goal args /brainstorming ");
    expect(picked.commandClaim).toEqual(claim);
  });

  it("inserts an input command and records an exact-prefix claim", () => {
    const opened = reduce(readyState, {
      kind: "slashPickerOpened",
      text: "/go",
      token: { start: 0, end: 3, query: "go", position: "leading" },
      requestId: "slash-1",
    });
    const picked = reduce(opened, { kind: "slashItemPicked", item: GOAL });
    expect(picked.draft).toBe("/goal ");
    expect(picked.commandClaim).toEqual({
      name: "goal",
      token: "/goal ",
      hint: "<objective>",
      acceptsImages: true,
    });

    expect(
      reduce(picked, { kind: "draftChanged", text: "/goal write tests" })
        .commandClaim,
    ).toEqual(picked.commandClaim);
    expect(
      reduce(picked, { kind: "draftChanged", text: " /goal write tests" })
        .commandClaim,
    ).toBeUndefined();
    expect(
      reduce(picked, { kind: "draftChanged", text: "/go write tests" })
        .commandClaim,
    ).toBeUndefined();
  });

  it("does not claim an input command picked from an inline token", () => {
    const opened = reduce(readyState, {
      kind: "slashPickerOpened",
      text: "use /go",
      token: { start: 4, end: 7, query: "go", position: "inline" },
      requestId: "slash-1",
    });
    const picked = reduce(opened, { kind: "slashItemPicked", item: GOAL });
    expect(picked.draft).toBe("use /goal ");
    expect(picked.commandClaim).toBeUndefined();
  });

  it("consumes only a bare command token and leaves execution to App", () => {
    const opened = reduce(readyState, {
      kind: "slashPickerOpened",
      text: "keep /compact this",
      token: { start: 5, end: 13, query: "compact", position: "inline" },
      requestId: "slash-1",
    });
    const picked = reduce(opened, {
      kind: "slashItemPicked",
      item: COMPACT,
    });
    expect(picked.draft).toBe("keep  this");
    expect(picked.picker).toBeUndefined();
    expect(picked.commandClaim).toBeUndefined();
    expect(picked.submitPending).toBe(false);
  });

  it("surfaces a local command error without consuming its draft or chips", () => {
    const claimed: UiState = {
      ...readyState,
      draft: "/review src",
      chips: [{ id: "c1", kind: "image", image: PNG, label: "shot.png" }],
      commandClaim: {
        name: "review",
        token: "/review ",
        acceptsImages: false,
      },
    };

    const rejected = reduce(claimed, {
      kind: "localError",
      detail: "/review does not accept images",
    });

    expect(rejected.draft).toBe(claimed.draft);
    expect(rejected.chips).toBe(claimed.chips);
    expect(rejected.commandClaim).toBe(claimed.commandClaim);
    expect(rejected.error).toBe("/review does not accept images");
    expect(rejected.status).toBe("error");
  });

  it("clears picker and claim on session lifecycle boundaries", () => {
    const claimed: UiState = {
      ...readyState,
      sessionId: "old",
      draft: "/goal work",
      commandClaim: {
        name: "goal",
        token: "/goal ",
        hint: "<objective>",
        acceptsImages: true,
      },
    };
    const withPicker = reduce(claimed, {
      kind: "slashPickerOpened",
      text: "/goal work /b",
      token: { start: 11, end: 13, query: "b", position: "inline" },
      requestId: "slash-1",
    });
    const session = reduce(withPicker, {
      kind: "session",
      sessionId: "new",
      cwd: "/tmp",
      createdAt: 1,
    });
    expect(session.picker).toBeUndefined();
    expect(session.commandClaim).toBeUndefined();

    const lifecycleMessages: UiMessage[] = [
      { kind: "history", sessionId: "old", events: [] },
      { kind: "hostDisconnected", detail: "gone" },
      { kind: "newChatStarted" },
    ];
    for (const message of lifecycleMessages) {
      const next = reduce(withPicker, message);
      expect(next.picker).toBeUndefined();
      expect(next.commandClaim).toBeUndefined();
    }
  });

  it("clears picker and claim when the current session is announced again", () => {
    const claimed: UiState = {
      ...readyState,
      sessionId: "same",
      commandClaim: {
        name: "goal",
        token: "/goal ",
        acceptsImages: false,
      },
    };
    const withPicker = reduce(claimed, {
      kind: "slashPickerOpened",
      text: "/goal work /b",
      token: { start: 11, end: 13, query: "b", position: "inline" },
      requestId: "slash-1",
    });
    const announced = reduce(withPicker, {
      kind: "session",
      sessionId: "same",
      cwd: "/tmp",
      createdAt: 1,
    });
    expect(announced.picker).toBeUndefined();
    expect(announced.commandClaim).toBeUndefined();
  });

  it("marks the current picker search unavailable", () => {
    const opened = reduce(readyState, {
      kind: "pickerOpened",
      text: "@",
      token: { start: 0, end: 1, query: "", quoted: false },
      requestId: "r1",
    });
    const unavailable = reduce(opened, {
      kind: "fileReferences",
      requestId: "r1",
      items: [],
      available: false,
    });
    expect(unavailable.picker?.kind).toBe("attachment");
    if (unavailable.picker?.kind !== "attachment") {
      throw new Error("expected attachment picker");
    }
    expect(unavailable.picker.unavailable).toBe(true);
    expect(unavailable.picker.items).toEqual([]);
  });

  it("replaces only the tracked token when the picker query changes", () => {
    const opened = reduce(readyState, {
      kind: "pickerOpened",
      text: "read @src and keep @docs",
      token: { start: 5, end: 9, query: "src", quoted: false },
      requestId: "r1",
    });
    const updated = reduce(opened, {
      kind: "pickerQueryChanged",
      query: "lib",
      requestId: "r2",
    });
    expect(updated.draft).toBe("read @lib and keep @docs");
    expect(updated.picker).toMatchObject({
      requestId: "r2",
      query: "lib",
      tokenStart: 5,
      tokenEnd: 9,
      items: [],
      unavailable: false,
    });
  });

  it("removes a lonely @ on dismiss but retains a typed token", () => {
    const lonely = reduce(readyState, {
      kind: "pickerOpened",
      text: "read @",
      token: { start: 5, end: 6, query: "", quoted: false },
      requestId: "r1",
    });
    expect(reduce(lonely, { kind: "pickerDismissed" }).draft).toBe("read ");

    const typed = reduce(lonely, {
      kind: "pickerQueryChanged",
      query: "src",
      requestId: "r2",
    });
    expect(reduce(typed, { kind: "pickerDismissed" }).draft).toBe("read @src");
  });

  it("picks file and folder references by removing the trigger span", () => {
    const opened = reduce(readyState, {
      kind: "pickerOpened",
      text: "read @src now",
      token: { start: 5, end: 9, query: "src", quoted: false },
      requestId: "r1",
    });
    const file = reduce(opened, {
      kind: "referencePicked",
      id: "c1",
      item: { path: "src/a.ts", kind: "file" },
    });
    expect(file.draft).toBe("read  now");
    expect(file.picker).toBeUndefined();
    expect(file.chips).toEqual([
      {
        id: "c1",
        kind: "file",
        path: "src/a.ts",
        mention: "@src/a.ts",
        label: "a.ts",
      },
    ]);

    const reopened = reduce(file, {
      kind: "pickerOpened",
      text: "read  now @lib",
      token: { start: 10, end: 14, query: "lib", quoted: false },
      requestId: "r2",
    });
    const folder = reduce(reopened, {
      kind: "referencePicked",
      id: "c2",
      item: { path: "src/lib", kind: "directory" },
    });
    expect(folder.draft).toBe("read  now ");
    expect(folder.chips[1]).toMatchObject({
      kind: "folder",
      path: "src/lib",
      mention: "@src/lib/",
      label: "lib",
    });
  });

  it("closes the quote on a searched directory whose path has spaces", () => {
    const opened = reduce(readyState, {
      kind: "pickerOpened",
      text: "read @my",
      token: { start: 5, end: 8, query: "my", quoted: false },
      requestId: "r1",
    });
    const picked = reduce(opened, {
      kind: "referencePicked",
      id: "c1",
      item: { path: "my folder", kind: "directory" },
    });
    expect(picked.chips[0]).toMatchObject({
      kind: "folder",
      mention: '@"my folder/"',
    });
  });

  it("canonicalizes a picked reference from the tracked quote state", () => {
    const opened = reduce(readyState, {
      kind: "pickerOpened",
      text: 'read @"src',
      token: { start: 5, end: 10, query: "src", quoted: true },
      requestId: "r1",
    });
    const picked = reduce(opened, {
      kind: "referencePicked",
      id: "c1",
      item: { path: "src/a.ts", kind: "file" },
    });
    expect(picked.chips).toEqual([
      {
        id: "c1",
        kind: "file",
        path: "src/a.ts",
        mention: '@"src/a.ts"',
        label: "a.ts",
      },
    ]);
    expect(picked.draft).toBe("read ");
    expect(picked.picker).toBeUndefined();
  });

  it("retains the picker and reports an invalid picked path", () => {
    const opened = reduce(readyState, {
      kind: "pickerOpened",
      text: "read @bad",
      token: { start: 5, end: 9, query: "bad", quoted: false },
      requestId: "r1",
    });
    const rejected = reduce(opened, {
      kind: "referencePicked",
      id: "c1",
      item: { path: "bad\nname", kind: "file" },
    });
    expect(rejected.chips).toEqual([]);
    expect(rejected.draft).toBe("read @bad");
    expect(rejected.picker).toBe(opened.picker);
    expect(rejected.error).toBe("Selected path cannot be referenced");
    expect(rejected.status).toBe("error");

    const retried = reduce(rejected, {
      kind: "referencePicked",
      id: "c2",
      item: { path: "src/a.ts", kind: "file" },
    });
    expect(retried.chips).toHaveLength(1);
    expect(retried.error).toBeUndefined();
    expect(retried.status).toBe("idle");
    expect(retried.picker).toBeUndefined();
  });

  it("appends image picks in order and removes chips by id", () => {
    const picked = reduce(initialState, {
      kind: "imagesPicked",
      images: [
        PNG,
        { mediaType: "image/jpeg", data: "Ag==", name: "second.jpg" },
      ],
    });
    expect(picked.chips.map((chip) => chip.label)).toEqual([
      "shot.png",
      "second.jpg",
    ]);
    const removed = reduce(picked, {
      kind: "chipRemoved",
      id: picked.chips[0]!.id,
    });
    expect(removed.chips.map((chip) => chip.label)).toEqual(["second.jpg"]);
  });

  it("clears draft attachments on session change and history replacement", () => {
    const populated: UiState = {
      ...initialState,
      sessionId: "old",
      draft: "keep",
      chips: [
        {
          id: "c1",
          kind: "file",
          path: "src/a.ts",
          mention: "@src/a.ts",
          label: "a.ts",
        },
      ],
    };
    const changed = reduce(populated, {
      kind: "session",
      sessionId: "new",
      cwd: "/tmp",
      createdAt: 1,
    });
    expect(changed.draft).toBe("");
    expect(changed.chips).toEqual([]);

    const history = reduce(populated, {
      kind: "history",
      sessionId: "old",
      events: [],
    });
    expect(history.draft).toBe("");
    expect(history.chips).toEqual([]);
  });

  it("keeps draft attachments for foreign-session events", () => {
    const populated: UiState = {
      ...initialState,
      sessionId: "parent",
      draft: "keep",
      chips: [
        {
          id: "c1",
          kind: "image",
          image: PNG,
          label: "shot.png",
        },
      ],
    };
    const foreign = {
      kind: "event",
      sessionId: "child",
      event: { type: "turn/start", seq: 1, time: 1, data: {} },
    } satisfies OutboundMessage;
    expect(reduce(populated, foreign)).toBe(populated);
  });

  it("settles only the matching submit result and clears an unchanged accepted snapshot", () => {
    const populated: UiState = {
      ...initialState,
      sessionId: "s1",
      draft: "look",
      chips: [
        {
          id: "c1",
          kind: "image",
          image: PNG,
          label: "shot.png",
        },
      ],
    };
    const pending = reduce(populated, {
      kind: "submitStarted",
      requestId: "submit-1",
      mode: "steer",
    });
    expect(pending.pendingPromptSubmission).toMatchObject({
      requestId: "submit-1",
      mode: "steer",
      draft: "look",
    });
    const rejected = reduce(pending, {
      kind: "submitResult",
      requestId: "other",
      result: { ok: true },
    });
    expect(rejected.draft).toBe("look");
    expect(rejected.chips).toHaveLength(1);
    expect(rejected.submitPending).toBe(true);

    const accepted = reduce(pending, {
      kind: "submitResult",
      requestId: "submit-1",
      result: { ok: true },
    });
    expect(accepted.draft).toBe("");
    expect(accepted.chips).toEqual([]);
    expect(accepted.submitPending).toBe(false);
  });

  it("retains later edits on success and retains the submitted snapshot on failure", () => {
    const populated: UiState = {
      ...readyState,
      sessionId: "s1",
      draft: "look",
    };
    const pending = reduce(populated, {
      kind: "submitStarted",
      requestId: "submit-1",
      mode: "queue",
    });
    const edited = reduce(pending, { kind: "draftChanged", text: "later" });
    const accepted = reduce(edited, {
      kind: "submitResult",
      requestId: "submit-1",
      result: { ok: true },
    });
    expect(accepted.submitPending).toBe(false);
    expect(accepted.draft).toBe("later");

    const retried = reduce(populated, {
      kind: "submitStarted",
      requestId: "submit-2",
      mode: "queue",
    });
    const failed = reduce(retried, {
      kind: "submitResult",
      requestId: "submit-2",
      result: { ok: false, detail: "model has no image input" },
    });
    expect(failed.submitPending).toBe(false);
    expect(failed.draft).toBe("look");
    expect(failed.error).toBe("model has no image input");
    expect(failed.status).toBe("idle");
    const next = reduce(
      { ...failed, draft: "retry" },
      { kind: "submitStarted", requestId: "submit-3", mode: "queue" },
    );
    expect(next.error).toBeUndefined();
  });

  it("ignores out-of-order and unrelated submit results after a newer pending starts", () => {
    const populated: UiState = {
      ...readyState,
      sessionId: "s1",
      draft: "keep this",
    };
    const first = reduce(populated, {
      kind: "submitStarted",
      requestId: "submit-old",
      mode: "queue",
    });
    const newer = reduce(first, {
      kind: "submitStarted",
      requestId: "submit-new",
      mode: "steer",
    });
    const stale = reduce(newer, {
      kind: "submitResult",
      requestId: "submit-old",
      result: { ok: true },
    });
    const unrelated = reduce(stale, {
      kind: "submitResult",
      requestId: "submit-other",
      result: { ok: false, detail: "unrelated" },
    });
    expect(unrelated.submitPending).toBe(true);
    expect(unrelated.draft).toBe("keep this");
    expect(unrelated.pendingPromptSubmission?.requestId).toBe("submit-new");
    expect(unrelated.error).toBeUndefined();
  });

  it("retains later draft and chip edits when the accepted command starts", () => {
    const commandDraft: UiState = {
      ...readyState,
      sessionId: "s1",
      draft: "/goal write tests",
      chips: [{ id: "c1", kind: "image", image: PNG, label: "shot.png" }],
      commandClaim: {
        name: "goal",
        token: "/goal ",
        acceptsImages: true,
      },
    };
    const pending = reduce(commandDraft, {
      kind: "commandSubmitStarted",
      line: "/goal write tests",
    });
    const edited = reduce(
      reduce(pending, {
        kind: "draftChanged",
        text: "/goal write different tests",
      }),
      {
        kind: "imagesPicked",
        images: [{ mediaType: "image/png", data: "Ag==", name: "later.png" }],
      },
    );
    const accepted = reduce(
      edited,
      eventMsg("command/run", {
        commandId: "cmd-1",
        name: "goal",
        args: " write tests",
        source: { kind: "user" },
      }),
    );
    expect(accepted.draft).toBe("/goal write different tests");
    expect(accepted.chips.map((chip) => chip.label)).toEqual([
      "shot.png",
      "later.png",
    ]);
    expect(accepted.submitPending).toBe(false);
    expect(
      (accepted as UiState & { pendingCommandSubmission?: unknown })
        .pendingCommandSubmission,
    ).toBeUndefined();
  });

  it("retains accepted command identity through an unrelated command/run", () => {
    const commandDraft: UiState = {
      ...readyState,
      sessionId: "s1",
      draft: "/goal write tests",
      chips: [{ id: "c1", kind: "image", image: PNG, label: "shot.png" }],
    };
    const pending = reduce(commandDraft, {
      kind: "commandSubmitStarted",
      line: "/goal write tests",
    });
    const unrelated = reduce(
      pending,
      eventMsg("command/run", {
        commandId: "cmd-2",
        name: "compact",
        source: { kind: "user" },
      }),
    );
    expect(unrelated.draft).toBe("/goal write tests");
    expect(unrelated.chips).toEqual(commandDraft.chips);
    expect(unrelated.submitPending).toBe(true);
    expect(
      (unrelated as UiState & { pendingCommandSubmission?: unknown })
        .pendingCommandSubmission,
    ).toEqual(
      (pending as UiState & { pendingCommandSubmission?: unknown })
        .pendingCommandSubmission,
    );
  });

  it("unlocks an args-redacted command/run by exact name and clears only an unchanged snapshot", () => {
    const commandDraft: UiState = {
      ...readyState,
      sessionId: "s1",
      draft: "/feedback the menu is slow",
      commandClaim: {
        name: "feedback",
        token: "/feedback ",
        acceptsImages: false,
      },
    };
    const pending = reduce(commandDraft, {
      kind: "commandSubmitStarted",
      line: "/feedback the menu is slow",
    });
    const accepted = reduce(
      pending,
      eventMsg("command/run", {
        commandId: "cmd-feedback",
        name: "feedback",
        source: { kind: "user" },
      }),
    );
    expect(accepted.timeline).toEqual([
      {
        kind: "command",
        commandId: "cmd-feedback",
        seq: 1,
        name: "feedback",
        args: null,
        status: "running",
      },
    ]);
    expect(accepted.draft).toBe("");
    expect(accepted.chips).toEqual([]);
    expect(accepted.submitPending).toBe(false);
    expect(accepted.pendingCommandSubmission).toBeUndefined();
    expect(accepted.commandClaim).toBeUndefined();

    const edited = reduce(pending, {
      kind: "draftChanged",
      text: "/feedback later thought",
    });
    const retained = reduce(
      edited,
      eventMsg("command/run", {
        commandId: "cmd-feedback",
        name: "feedback",
        source: { kind: "user" },
      }),
    );
    expect(retained.draft).toBe("/feedback later thought");
    expect(retained.submitPending).toBe(false);
    expect(retained.pendingCommandSubmission).toBeUndefined();
  });

  it("backstop-settles a pending command on command/done without clearing the draft", () => {
    const pending = reduce(
      {
        ...readyState,
        sessionId: "s1",
        draft: "/feedback the menu is slow",
      },
      {
        kind: "commandSubmitStarted",
        line: "/feedback the menu is slow",
      },
    );
    const done = reduce(
      pending,
      eventMsg("command/done", {
        commandId: "cmd-feedback",
        kind: "success",
      }),
    );
    expect(done.submitPending).toBe(false);
    expect(done.pendingCommandSubmission).toBeUndefined();
    expect(done.draft).toBe("/feedback the menu is slow");
    expect(done.status).toBe("idle");
  });

  it("settles pending command idle or error without unlocking ordinary prompt submits", () => {
    const commandPending = reduce(
      {
        ...readyState,
        sessionId: "s1",
        draft: "/feedback the menu is slow",
      },
      {
        kind: "commandSubmitStarted",
        line: "/feedback the menu is slow",
      },
    );
    const cancelled = reduce(commandPending, statusMsg("idle"));
    expect(cancelled.submitPending).toBe(false);
    expect(cancelled.pendingCommandSubmission).toBeUndefined();
    expect(cancelled.draft).toBe("/feedback the menu is slow");
    expect(cancelled.status).toBe("idle");

    const failed = reduce(
      commandPending,
      statusMsg("error", "handler exploded"),
    );
    expect(failed.submitPending).toBe(false);
    expect(failed.pendingCommandSubmission).toBeUndefined();
    expect(failed.draft).toBe("/feedback the menu is slow");
    expect(failed.error).toBe("handler exploded");
    expect(failed.status).toBe("error");

    const promptPending = reduce(
      { ...readyState, sessionId: "s1", draft: "hello" },
      { kind: "submitStarted", requestId: "submit-command", mode: "queue" },
    );
    expect(reduce(promptPending, statusMsg("idle")).submitPending).toBe(true);
    expect(
      reduce(promptPending, statusMsg("error", "unknown model")).submitPending,
    ).toBe(true);
  });

  it("clears an unchanged accepted command on its matching command/run", () => {
    const commandDraft: UiState = {
      ...readyState,
      sessionId: "s1",
      draft: "/goal write tests",
      chips: [{ id: "c1", kind: "image", image: PNG, label: "shot.png" }],
    };
    const pending = reduce(commandDraft, {
      kind: "commandSubmitStarted",
      line: "/goal write tests",
    });
    const accepted = reduce(
      pending,
      eventMsg("command/run", {
        commandId: "cmd-1",
        name: "goal",
        args: " write tests",
        source: { kind: "user" },
      }),
    );
    expect(accepted.draft).toBe("");
    expect(accepted.chips).toEqual([]);
    expect(accepted.submitPending).toBe(false);
    expect(
      (accepted as UiState & { pendingCommandSubmission?: unknown })
        .pendingCommandSubmission,
    ).toBeUndefined();
  });

  it("clears accepted command identity on rejection and session replacement", () => {
    const commandDraft: UiState = {
      ...readyState,
      sessionId: "s1",
      draft: "/goal write tests",
    };
    const start = (): UiState =>
      reduce(commandDraft, {
        kind: "commandSubmitStarted",
        line: "/goal write tests",
      });

    const rejected = reduce(start(), {
      kind: "status",
      state: "error",
      code: "command-rejected",
      detail: "unknown command",
    });
    expect(rejected.submitPending).toBe(false);
    expect(
      (rejected as UiState & { pendingCommandSubmission?: unknown })
        .pendingCommandSubmission,
    ).toBeUndefined();

    const replaced = reduce(start(), {
      kind: "session",
      sessionId: "s2",
      cwd: "/tmp",
      createdAt: 1,
    });
    expect(replaced.submitPending).toBe(false);
    expect(
      (replaced as UiState & { pendingCommandSubmission?: unknown })
        .pendingCommandSubmission,
    ).toBeUndefined();
  });

  it("unlocks a pending submit when the retained child disconnects", () => {
    const pending = reduce(
      { ...readyState, sessionId: "s1", draft: "look" },
      { kind: "submitStarted", requestId: "submit-disconnect", mode: "queue" },
    );
    const disconnected = reduce(pending, {
      kind: "hostDisconnected",
      detail: "dsh exited",
    });
    expect(disconnected.submitPending).toBe(false);
    expect(disconnected.draft).toBe("look");
  });

  it("does not clear a pending submit on foreign-session turn start", () => {
    const pending: UiState = {
      ...initialState,
      sessionId: "parent",
      draft: "keep",
      chips: [],
      submitPending: true,
    };
    const foreign = {
      kind: "event",
      sessionId: "child",
      event: { type: "turn/start", seq: 1, time: 1, data: {} },
    } satisfies OutboundMessage;
    expect(reduce(pending, foreign)).toBe(pending);
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

  it("serializes trimmed body, reference mentions, and images in rail order", () => {
    expect(
      serializeDraft({
        draft: "  review this  ",
        picker: undefined,
        chips: [
          {
            id: "c1",
            kind: "file",
            path: "src/a.ts",
            mention: "@src/a.ts",
            label: "a.ts",
          },
          { id: "c2", kind: "image", image: PNG, label: "shot.png" },
          {
            id: "c3",
            kind: "folder",
            path: "src/lib",
            mention: "@src/lib/",
            label: "lib",
          },
        ],
      }),
    ).toEqual({
      text: "review this @src/a.ts @src/lib/",
      images: [PNG],
    });
  });

  it("returns empty text for image-only drafts and omits empty image arrays", () => {
    expect(
      serializeDraft({
        draft: " ",
        picker: undefined,
        chips: [{ id: "c1", kind: "image", image: PNG, label: "shot.png" }],
      }),
    ).toEqual({ text: "", images: [PNG] });
    expect(
      serializeDraft({ draft: "", picker: undefined, chips: [] }),
    ).toEqual({ text: "" });
  });

  it("drops a partially typed trigger token when submit races the picker", () => {
    expect(
      serializeDraft({
        draft: 'read @"src/my f',
        chips: [
          {
            id: "c1",
            kind: "file",
            path: "src/a.ts",
            mention: "@src/a.ts",
            label: "a.ts",
          },
        ],
        picker: {
          kind: "attachment",
          requestId: "r1",
          query: "src/my f",
          quoted: true,
          tokenStart: 5,
          tokenEnd: 15,
          items: [],
          unavailable: false,
        },
      }),
    ).toEqual({ text: "read @src/a.ts" });
  });

  it("drops a lonely trigger token and can leave the body empty", () => {
    expect(
      serializeDraft({
        draft: "@",
        chips: [],
        picker: {
          kind: "attachment",
          requestId: "r1",
          query: "",
          quoted: false,
          tokenStart: 0,
          tokenEnd: 1,
          items: [],
          unavailable: false,
        },
      }),
    ).toEqual({ text: "" });

    expect(
      serializeDraft({
        draft: "review @",
        chips: [{ id: "c1", kind: "image", image: PNG, label: "shot.png" }],
        picker: {
          kind: "attachment",
          requestId: "r1",
          query: "",
          quoted: false,
          tokenStart: 7,
          tokenEnd: 8,
          items: [],
          unavailable: false,
        },
      }),
    ).toEqual({ text: "review", images: [PNG] });
  });

  it("serializes a valid command claim with normal mentions and encoded images", () => {
    expect(
      serializeCommand({
        draft: "/goal write tests",
        commandClaim: {
          name: "goal",
          token: "/goal ",
          hint: "<objective>",
          acceptsImages: true,
        },
        chips: [
          {
            id: "c1",
            kind: "folder",
            path: "src/lib",
            mention: "@src/lib/",
            label: "lib",
          },
          { id: "c2", kind: "image", image: PNG, label: "shot.png" },
          {
            id: "c3",
            kind: "file",
            path: "src/a.ts",
            mention: "@src/a.ts",
            label: "a.ts",
          },
        ],
      }),
    ).toEqual({
      line: "/goal write tests @src/lib/ @src/a.ts",
      images: [PNG],
    });
  });

  it("rejects absent or invalid command claims during serialization", () => {
    expect(
      serializeCommand({
        draft: "/goal write tests",
        commandClaim: undefined,
        chips: [],
      }),
    ).toBeUndefined();
    expect(
      serializeCommand({
        draft: " /goal write tests",
        commandClaim: {
          name: "goal",
          token: "/goal ",
          acceptsImages: false,
        },
        chips: [],
      }),
    ).toBeUndefined();
    expect(
      serializeCommand({
        draft: "/goalkeeper",
        commandClaim: {
          name: "goal",
          token: "/goal ",
          acceptsImages: false,
        },
        chips: [],
      }),
    ).toBeUndefined();
  });
});

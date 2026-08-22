import { describe, it, expect } from "vitest";
import type {
  EncodedImageAttachment,
  EventMessage,
  AskQuestionWire,
  OutboundMessage,
} from "@dsh-vscode/contract";
import {
  contextPercent,
  filterSessions,
  reduce,
  initialState,
  serializeDraft,
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
    expect(second.transcript).toEqual([
      { role: "assistant", text: "## Hello", streaming: true },
    ]);
  });

  it("ignores reasoning deltas and other chunk types", () => {
    const streamed = reduce(initialState, textDelta("answer"));
    const withReasoning = reduce(streamed, reasoningDelta("thinking"));
    expect(withReasoning).toBe(streamed);
    expect(
      reduce(initialState, eventMsg("assistant/chunk", { chunk: { type: "usage" } })),
    ).toBe(initialState);
  });

  it("finalizes the streamed entry from assistant/message instead of duplicating it", () => {
    const streamed = reduce(initialState, textDelta("Hell"));
    const done = reduce(streamed, assistantMessage("Hello"));
    expect(done.transcript).toEqual([
      { role: "assistant", text: "Hello", streaming: false },
    ]);
  });

  it("keeps streamed text when the assembled message carries none", () => {
    const streamed = reduce(initialState, textDelta("partial"));
    const toolOnly = reduce(streamed, assistantMessage());
    expect(toolOnly.transcript).toEqual([
      { role: "assistant", text: "partial", streaming: false },
    ]);
  });

  it("joins multiple text blocks of one assembled message", () => {
    const s = reduce(initialState, assistantMessage("first", "second"));
    expect(s.transcript[0]?.text).toBe("first\n\nsecond");
  });

  it("starts a new entry for each step of a multi-step turn", () => {
    const step1 = reduce(reduce(initialState, textDelta("looking")), assistantMessage("looking"));
    const step2 = reduce(reduce(step1, textDelta("done")), assistantMessage("done"));
    expect(step2.transcript.map((entry) => entry.text)).toEqual([
      "looking",
      "done",
    ]);
  });

  it("shows the person's own message and hides injected context messages", () => {
    const typed = reduce(initialState, userMessage("hi there"));
    expect(typed.transcript).toEqual([
      { role: "user", text: "hi there", streaming: false },
    ]);
    for (const kind of ["plugin", "session-reference", "subagent-report"]) {
      expect(reduce(typed, userMessage("injected", kind))).toBe(typed);
    }
  });

  it("closes a dangling streamed entry when the next turn starts", () => {
    const dangling = reduce(initialState, textDelta("cut off"));
    const next = reduce(dangling, eventMsg("turn/start", { turn: 2 }));
    expect(next.transcript).toEqual([
      { role: "assistant", text: "cut off", streaming: false },
    ]);
  });

  it("projects a resumed history into the same transcript", () => {
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
    expect(resumed.transcript).toEqual([
      { role: "user", text: "ask", streaming: false },
      { role: "assistant", text: "partial answer", streaming: false },
    ]);
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

  it("renders argument-only diffs that the host can apply", () => {
    const s = reduce(
      initialState,
      eventMsg("tool/result", {
        arguments: { path: "/x/a.ts", oldText: "a", newText: "b" },
      }),
    );
    expect(s.diffs).toEqual([
      { path: "/x/a.ts", oldText: "a", newText: "b" },
    ]);
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
    expect(s.transcript).toEqual([
      { role: "assistant", text: "previous turn", streaming: false },
    ]);
    expect(s.status).toBe("thinking");
  });

  it("replaces the transcript from resumed history", () => {
    const state = reduce(reduce(initialState, assistantMessage("old")), {
      kind: "history",
      sessionId: "resumed",
      events: [assistantMessage("restored").event],
    });
    expect(state.sessionId).toBe("resumed");
    expect(state.transcript).toEqual([
      { role: "assistant", text: "restored", streaming: false },
    ]);
  });

  it("clears per-session state when the session changes", () => {
    const populated: UiState = {
      ...initialState,
      sessionId: "old",
      transcript: [{ role: "assistant", text: "old", streaming: false }],
      diffs: [{ path: "/x", oldText: "a", newText: "b" }],
      approval: { askId: "a", questions: [QUESTION] },
    };
    const state = reduce(populated, {
      kind: "session",
      sessionId: "new",
      cwd: "/tmp",
      createdAt: 1,
    });
    expect(state.transcript).toEqual([]);
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
    expect(unavailable.picker?.unavailable).toBe(true);
    expect(unavailable.picker?.items).toEqual([]);
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

  it("retains draft on submit rejection and clears on current-session turn start", () => {
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
    const pending = reduce(populated, { kind: "submitStarted" });
    const rejected = reduce(pending, {
      kind: "status",
      state: "error",
      code: "submit-rejected",
      detail: "model has no image input",
    });
    expect(rejected.draft).toBe("look");
    expect(rejected.chips).toHaveLength(1);
    expect(rejected.submitPending).toBe(false);

    const accepted = reduce(pending, eventMsg("turn/start", {}));
    expect(accepted.draft).toBe("");
    expect(accepted.chips).toEqual([]);
    expect(accepted.submitPending).toBe(false);
  });

  it("keeps a submit pending through an unrelated error until turn start", () => {
    const populated: UiState = {
      ...readyState,
      sessionId: "s1",
      draft: "look",
    };
    const pending = reduce(populated, { kind: "submitStarted" });
    const unrelated = reduce(pending, statusMsg("error", "unknown model"));
    expect(unrelated.submitPending).toBe(true);
    expect(unrelated.draft).toBe("look");
    expect(unrelated.error).toBe("unknown model");

    const accepted = reduce(unrelated, eventMsg("turn/start", {}));
    expect(accepted.submitPending).toBe(false);
    expect(accepted.draft).toBe("");
  });

  it("unlocks a pending submit when the retained child disconnects", () => {
    const pending = reduce(
      { ...readyState, sessionId: "s1", draft: "look" },
      { kind: "submitStarted" },
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
});

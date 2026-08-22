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

const PNG: EncodedImageAttachment = {
  mediaType: "image/png",
  data: "AQ==",
  name: "shot.png",
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

  it("opens at an @ token and ignores stale search replies", () => {
    const opened = reduce(initialState, {
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
    const opened = reduce(initialState, {
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
    const opened = reduce(initialState, {
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
    const lonely = reduce(initialState, {
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
    const opened = reduce(initialState, {
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

    const folder = reduce(file, {
      kind: "folderPicked",
      path: "src/lib",
    });
    expect(folder.chips[1]).toMatchObject({
      kind: "folder",
      path: "src/lib",
      mention: "@src/lib/",
      label: "lib",
    });

    const spacedFolder = reduce(folder, {
      kind: "folderPicked",
      path: "my folder",
    });
    expect(spacedFolder.chips[2]).toMatchObject({
      path: "my folder",
      mention: '@"my folder/',
      label: "my folder",
    });
  });

  it("canonicalizes a picked reference from the tracked quote state", () => {
    const opened = reduce(initialState, {
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
    const opened = reduce(initialState, {
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
        chips: [{ id: "c1", kind: "image", image: PNG, label: "shot.png" }],
      }),
    ).toEqual({ text: "", images: [PNG] });
    expect(serializeDraft({ draft: "", chips: [] })).toEqual({ text: "" });
  });
});

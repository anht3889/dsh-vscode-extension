import { describe, it, expect } from "vitest";
import type { SessionEventWire } from "./events.js";
import { toolDiffsFromEvent } from "./diffs.js";

// Typed fixtures mirroring the real SessionEventWire shape (no `as any`).
// The bridge emits `{ type, seq, time, data: { ... } }` where `data` carries the
// verbatim tool record — for a tool/result it holds `message` and, for fs-edit
// results, a `data.meta = { path, oldText, newText }` contextual diff.

function resultEvent(
  type: string,
  data: Record<string, unknown>,
): SessionEventWire {
  return { type, seq: 1, time: 0, data };
}

function fsWriteMeta(meta: Record<string, unknown>): SessionEventWire {
  return resultEvent("tool/result", { message: {}, meta });
}

describe("toolDiffsFromEvent", () => {
  it("extracts a path+old/new diff from a fs-write tool/result meta", () => {
    const ev = fsWriteMeta({ path: "/x/a.ts", oldText: "a", newText: "b" });
    expect(toolDiffsFromEvent(ev)).toEqual([
      { path: "/x/a.ts", oldText: "a", newText: "b" },
    ]);
  });

  it("returns [] for non-diff events", () => {
    expect(toolDiffsFromEvent(resultEvent("turn/end", {}))).toEqual([]);
  });

  it("returns [] for tool/result without data.meta", () => {
    expect(
      toolDiffsFromEvent(resultEvent("tool/result", { message: {} })),
    ).toEqual([]);
  });

  it("returns [] when data is missing entirely", () => {
    const ev = {
      type: "tool/result",
      seq: 1,
      time: 0,
    } as unknown as SessionEventWire;
    expect(toolDiffsFromEvent(ev)).toEqual([]);
  });

  it("returns [] when meta is not a diff shape", () => {
    expect(
      toolDiffsFromEvent(fsWriteMeta({ command: "ls", exitCode: 0 })),
    ).toEqual([]);
  });

  it("reconstructs a diff from str-replace-editor arguments when meta is absent", () => {
    const ev = resultEvent("tool/result", {
      message: {},
      tool: { name: "str-replace-editor" },
      arguments: { path: "/x/b.ts", oldText: "x", newText: "y" },
    });
    expect(toolDiffsFromEvent(ev)).toEqual([
      { path: "/x/b.ts", oldText: "x", newText: "y" },
    ]);
  });

  it("extracts diffs from a DiffResultView", () => {
    expect(toolDiffsFromEvent({
      type: "tool/result",
      seq: 1,
      time: 0,
      data: { message: {} },
      view: {
        for: "result",
        view: {
          card: "diff",
          diffs: [{ path: "/a.ts", oldText: null, newText: "x" }],
        },
      },
    })).toEqual([{ path: "/a.ts", oldText: "", newText: "x" }]);
  });

  it("appends distinct presenter diffs after a legacy diff in source order", () => {
    expect(toolDiffsFromEvent({
      type: "tool/result",
      seq: 1,
      time: 0,
      data: {
        message: {},
        meta: { path: "/a.ts", oldText: "a", newText: "b" },
      },
      view: {
        for: "result",
        view: {
          card: "diff",
          diffs: [
            { path: "/b.ts", oldText: "c", newText: "d" },
            { path: "/c.ts", oldText: null, newText: "e" },
          ],
        },
      },
    })).toEqual([
      { path: "/a.ts", oldText: "a", newText: "b" },
      { path: "/b.ts", oldText: "c", newText: "d" },
      { path: "/c.ts", oldText: "", newText: "e" },
    ]);
  });

  it("does not duplicate a legacy diff repeated in the presenter view", () => {
    expect(toolDiffsFromEvent({
      type: "tool/result",
      seq: 1,
      time: 0,
      data: {
        message: {},
        arguments: { path: "/a.ts", oldText: "a", newText: "b" },
      },
      view: {
        for: "result",
        view: {
          card: "diff",
          diffs: [
            { path: "/a.ts", oldText: "a", newText: "b" },
            { path: "/b.ts", oldText: null, newText: "c" },
          ],
        },
      },
    })).toEqual([
      { path: "/a.ts", oldText: "a", newText: "b" },
      { path: "/b.ts", oldText: "", newText: "c" },
    ]);
  });

  it("collapses duplicates repeated inside the presenter view", () => {
    expect(toolDiffsFromEvent({
      type: "tool/result",
      seq: 1,
      time: 0,
      data: { message: {} },
      view: {
        for: "result",
        view: {
          card: "diff",
          diffs: [
            { path: "/a.ts", oldText: null, newText: "x" },
            { path: "/a.ts", oldText: "", newText: "x" },
          ],
        },
      },
    })).toEqual([{ path: "/a.ts", oldText: "", newText: "x" }]);
  });

  it("ignores a non-diff presenter card and a malformed view", () => {
    expect(toolDiffsFromEvent({
      type: "tool/result",
      seq: 1,
      time: 0,
      data: { message: {} },
      view: {
        for: "result",
        view: { card: "terminal", output: "ok", exitCode: 0 },
      },
    })).toEqual([]);
    expect(toolDiffsFromEvent({
      type: "tool/result",
      seq: 1,
      time: 0,
      data: { message: {} },
      view: {
        for: "result",
        view: { card: "diff", diffs: [{ path: 7, newText: "x" }] },
      } as unknown as SessionEventWire["view"],
    })).toEqual([]);
  });
});

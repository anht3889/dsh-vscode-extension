import { describe, it, expect } from "vitest";
import { resolve as resolvePath } from "node:path";
import { diffsFromEvent, resolveDiffPath } from "../src/applyEdits.js";
import type { SessionEventWire } from "@dsh-vscode/contract";

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

describe("diffsFromEvent", () => {
  it("extracts a path+old/new diff from a fs-write tool/result meta", () => {
    const ev = fsWriteMeta({ path: "/x/a.ts", oldText: "a", newText: "b" });
    expect(diffsFromEvent(ev)).toEqual([
      { path: "/x/a.ts", oldText: "a", newText: "b" },
    ]);
  });

  it("returns [] for non-diff events", () => {
    expect(diffsFromEvent(resultEvent("turn/end", {}))).toEqual([]);
  });

  it("returns [] for tool/result without data.meta", () => {
    expect(diffsFromEvent(resultEvent("tool/result", { message: {} }))).toEqual(
      [],
    );
  });

  it("returns [] when data is missing entirely", () => {
    const ev = { type: "tool/result", seq: 1, time: 0 } as unknown as SessionEventWire;
    expect(diffsFromEvent(ev)).toEqual([]);
  });

  it("returns [] when meta is not a diff shape", () => {
    expect(
      diffsFromEvent(fsWriteMeta({ command: "ls", exitCode: 0 })),
    ).toEqual([]);
  });

  it("reconstructs a diff from str-replace-editor arguments when meta is absent", () => {
    const ev = resultEvent("tool/result", {
      message: {},
      tool: { name: "str-replace-editor" },
      arguments: { path: "/x/b.ts", oldText: "x", newText: "y" },
    });
    expect(diffsFromEvent(ev)).toEqual([
      { path: "/x/b.ts", oldText: "x", newText: "y" },
    ]);
  });
});

describe("resolveDiffPath", () => {
  const root = "/Users/me/project";

  it("passes absolute paths through unchanged", () => {
    expect(resolveDiffPath("/x/a.ts", root)).toBe("/x/a.ts");
  });

  it("joins workspace-relative paths to the workspace root", () => {
    expect(resolveDiffPath("src/a.ts", root)).toBe("/Users/me/project/src/a.ts");
  });

  it("resolves relative paths against the process cwd when no root is given", () => {
    expect(resolveDiffPath("src/a.ts", undefined)).toBe(
      resolvePath("src/a.ts"),
    );
  });
});

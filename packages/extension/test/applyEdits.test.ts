import { describe, it, expect } from "vitest";
import { resolve as resolvePath } from "node:path";
import { resolveDiffPath } from "../src/applyEdits.js";

// Diff extraction itself lives in `@dsh-vscode/contract`
// (`packages/contract/src/diffs.test.ts`), shared with the webview timeline.

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

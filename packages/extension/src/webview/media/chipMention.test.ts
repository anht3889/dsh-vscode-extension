import { describe, expect, it } from "vitest";
import { formatChipMention } from "./chipMention.js";
import { formatFileMention } from "./fileMention.js";

describe("formatChipMention", () => {
  it("closes the quote the harness grammar leaves open on a directory", () => {
    expect(formatFileMention({ path: "my folder", kind: "directory" }, false)).toBe(
      '@"my folder/',
    );
    expect(formatChipMention({ path: "my folder", kind: "directory" }, false)).toBe(
      '@"my folder/"',
    );
  });

  it("closes a quote preserved from the trigger token", () => {
    expect(formatChipMention({ path: "src", kind: "directory" }, true)).toBe(
      '@"src/"',
    );
    expect(formatChipMention({ path: "src/a.ts", kind: "file" }, true)).toBe(
      '@"src/a.ts"',
    );
  });

  it("passes unquoted and already-closed mentions through unchanged", () => {
    expect(formatChipMention({ path: "src/a.ts", kind: "file" }, false)).toBe(
      "@src/a.ts",
    );
    expect(formatChipMention({ path: "src/lib", kind: "directory" }, false)).toBe(
      "@src/lib/",
    );
    expect(formatChipMention({ path: "my file.ts", kind: "file" }, false)).toBe(
      '@"my file.ts"',
    );
  });

  it("refuses paths the grammar cannot represent", () => {
    expect(
      formatChipMention({ path: "bad\nname", kind: "file" }, false),
    ).toBeUndefined();
    expect(
      formatChipMention({ path: 'quote"dir', kind: "directory" }, false),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { activeAtToken, formatFileMention } from "./fileMention.js";

describe("activeAtToken", () => {
  it("detects plain and quoted tokens only at a token boundary", () => {
    expect(activeAtToken("read @src/in", 12)).toEqual({
      prefix: "@src/in", query: "src/in", quoted: false,
    });
    expect(activeAtToken('read @"src/my f', 15)).toEqual({
      prefix: '@"src/my f', query: "src/my f", quoted: true,
    });
    expect(activeAtToken("a@b.com", 7)).toBeUndefined();
  });
});

describe("formatFileMention", () => {
  it("quotes whitespace, appends a directory slash, and rejects controls", () => {
    expect(formatFileMention({ path: "src/a.ts", kind: "file" }, false)).toBe("@src/a.ts");
    expect(formatFileMention({ path: "my file.ts", kind: "file" }, false)).toBe('@"my file.ts"');
    expect(formatFileMention({ path: "src", kind: "directory" }, false)).toBe("@src/");
    expect(formatFileMention({ path: "bad\nname", kind: "file" }, false)).toBeUndefined();
  });
});

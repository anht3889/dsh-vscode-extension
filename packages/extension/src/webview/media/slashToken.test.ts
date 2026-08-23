import { describe, expect, it } from "vitest";
import { activeSlashToken, replaceSlashToken } from "./slashToken.js";

describe("activeSlashToken pinned cases", () => {
  it("detects leading and inline slash tokens", () => {
    expect(activeSlashToken("/", 1)).toEqual({
      query: "", position: "leading", start: 0, end: 1,
    });
    expect(activeSlashToken("please /com", 11)).toEqual({
      query: "com", position: "inline", start: 7, end: 11,
    });
  });

  it("rejects word-adjacent, URL, drive, comment, and @-prefixed slashes", () => {
    expect(activeSlashToken("a/b", 3)).toBeUndefined();
    expect(activeSlashToken("https://host/x", 8)).toBeUndefined();
    expect(activeSlashToken("C:/work", 3)).toBeUndefined();
    expect(activeSlashToken("// comment", 2)).toBeUndefined();
    expect(activeSlashToken("@/path", 2)).toBeUndefined();
  });
});

describe("activeSlashToken boundaries and caret", () => {
  it("triggers after whitespace, newline, and punctuation", () => {
    expect(activeSlashToken("say /co", 7)).toMatchObject({ query: "co", position: "inline" });
    expect(activeSlashToken("line1\n/go", 9)).toMatchObject({ query: "go", position: "inline" });
    expect(activeSlashToken("see (/go", 8)).toMatchObject({ query: "go", position: "inline" });
  });

  it("treats whitespace-only prefix before the slash as leading", () => {
    expect(activeSlashToken("\n\n/goal", 6)).toMatchObject({ position: "leading" });
    expect(activeSlashToken("  \n /goal", 9)).toMatchObject({ position: "leading" });
  });

  it("treats a token after non-whitespace text as inline", () => {
    expect(activeSlashToken("第一行\n/goal", 7)).toMatchObject({ position: "inline" });
    expect(activeSlashToken("a /goal", 7)).toMatchObject({ position: "inline" });
  });

  it("stops the backward scan at whitespace", () => {
    expect(activeSlashToken("/goal x", 7)).toBeUndefined();
  });

  it("cuts the query at a mid-token caret", () => {
    expect(activeSlashToken("/goal", 3)).toEqual({
      query: "go", position: "leading", start: 0, end: 3,
    });
  });

  it("suppresses comment openers only within the active prefix", () => {
    expect(activeSlashToken("//goal", 1)).toEqual({
      query: "", position: "leading", start: 0, end: 1,
    });
    expect(activeSlashToken("// comment", 2)).toBeUndefined();
  });

  it("returns undefined at caret 0", () => {
    expect(activeSlashToken("/goal", 0)).toBeUndefined();
  });

  it("still triggers when a colon is not a scheme separator", () => {
    expect(activeSlashToken("note: /go", 9)).toMatchObject({ query: "go", position: "inline" });
    expect(activeSlashToken(":/go", 4)).toMatchObject({ query: "go", position: "inline" });
  });
});

describe("replaceSlashToken", () => {
  it("replaces the token span and places the caret after the replacement", () => {
    expect(replaceSlashToken("please /com", { start: 7, end: 11 }, "/compact")).toEqual({
      text: "please /compact",
      caret: 15,
    });
  });

  it("replaces a leading token", () => {
    expect(replaceSlashToken("/go", { start: 0, end: 3 }, "/goal")).toEqual({
      text: "/goal",
      caret: 5,
    });
  });
});

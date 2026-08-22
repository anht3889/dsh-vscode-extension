import { describe, expect, it } from "vitest";
import {
  encodeImageBytes,
  pickRelativeFolder,
  relativeFolderPath,
} from "../src/webview/attachments.js";

describe("relativeFolderPath", () => {
  it("normalizes descendants to posix paths and represents the cwd as dot", () => {
    expect(relativeFolderPath("/work/app", "/work/app")).toBe(".");
    expect(relativeFolderPath("/work/app", "/work/app/src/lib")).toBe("src/lib");
    expect(relativeFolderPath("/work/app", "/work/other")).toBeUndefined();
  });

  it("rejects paths that only share the cwd prefix", () => {
    expect(relativeFolderPath("/work/app", "/work/app2")).toBeUndefined();
  });
});

describe("pickRelativeFolder", () => {
  it("validates against the cwd current after the picker resolves", async () => {
    let cwd = "/work/old";

    const result = await pickRelativeFolder(
      async () => {
        cwd = "/work/new";
        return "/work/old/src";
      },
      () => cwd,
    );

    expect(result).toEqual({ kind: "outside" });
  });
});

describe("encodeImageBytes", () => {
  it("maps supported extensions, emits canonical base64, and strips paths", () => {
    expect(encodeImageBytes(Uint8Array.of(1), "/private/a.png")).toEqual({
      mediaType: "image/png",
      data: "AQ==",
      name: "a.png",
    });
    expect(encodeImageBytes(new Uint8Array(), "photo.jpeg").mediaType).toBe(
      "image/jpeg",
    );
    expect(encodeImageBytes(new Uint8Array(), "photo.jpg").mediaType).toBe(
      "image/jpeg",
    );
    expect(encodeImageBytes(new Uint8Array(), "photo.webp").mediaType).toBe(
      "image/webp",
    );
    expect(encodeImageBytes(new Uint8Array(), "photo.gif").mediaType).toBe(
      "image/gif",
    );
  });

  it("rejects svg and unknown extensions", () => {
    expect(() => encodeImageBytes(new Uint8Array(), "a.svg")).toThrow(
      "Unsupported image type",
    );
    expect(() => encodeImageBytes(new Uint8Array(), "a.bmp")).toThrow(
      "Unsupported image type",
    );
  });
});

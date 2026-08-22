import { describe, expect, it, vi } from "vitest";
import {
  encodeImageBytes,
  encodeImageSelection,
} from "../src/webview/attachments.js";

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

describe("encodeImageSelection", () => {
  it("encodes a multi-file selection in order with base names only", async () => {
    const readBytes = vi.fn(async ({ fsPath }: { fsPath: string }) =>
      fsPath.endsWith("b.gif") ? Uint8Array.of(2, 3) : Uint8Array.of(1),
    );

    await expect(
      encodeImageSelection(
        [{ fsPath: "/private/shots/a.png" }, { fsPath: "/private/shots/b.gif" }],
        readBytes,
      ),
    ).resolves.toEqual({
      images: [
        { mediaType: "image/png", data: "AQ==", name: "a.png" },
        { mediaType: "image/gif", data: "AgM=", name: "b.gif" },
      ],
      failed: [],
    });
    expect(readBytes).toHaveBeenCalledTimes(2);
  });

  it("retains successes and reports the base name of each failure", async () => {
    const result = await encodeImageSelection(
      [
        { fsPath: "/private/shots/unreadable.png" },
        { fsPath: "/private/shots/ok.webp" },
        { fsPath: "/private/shots/vector.svg" },
      ],
      async ({ fsPath }) => {
        if (fsPath.endsWith("unreadable.png")) throw new Error("EACCES");
        return Uint8Array.of(1);
      },
    );

    expect(result.images).toEqual([
      { mediaType: "image/webp", data: "AQ==", name: "ok.webp" },
    ]);
    expect(result.failed).toEqual(["unreadable.png", "vector.svg"]);
  });

  it("returns nothing for a cancelled or empty dialog without reading bytes", async () => {
    const readBytes = vi.fn(async () => Uint8Array.of(1));
    const empty = { images: [], failed: [] };

    await expect(encodeImageSelection(undefined, readBytes)).resolves.toEqual(
      empty,
    );
    await expect(encodeImageSelection([], readBytes)).resolves.toEqual(empty);
    expect(readBytes).not.toHaveBeenCalled();
  });
});

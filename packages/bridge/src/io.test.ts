import { describe, it, expect } from "vitest";
import { FrameCodec } from "./io.js";

describe("FrameCodec", () => {
  it("encodes one message per line and decodes it back", () => {
    const codec = new FrameCodec();
    const msg = { kind: "status", state: "idle" } as const;
    const line = codec.encode(msg);
    expect(line.endsWith("\n")).toBe(true);
    expect(codec.decode(line)).toEqual(msg);
  });
  it("returns null for malformed lines instead of throwing", () => {
    const codec = new FrameCodec();
    expect(codec.decode("{ not json")).toBeNull();
    expect(codec.decode("")).toBeNull();
  });
});

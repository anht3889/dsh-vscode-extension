import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { FrameCodec } from "./io.js";
import { createStdio } from "./io.js";
import type { InboundMessage } from "@dsh-vscode/contract";

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

describe("createStdio", () => {
  it("reassembles an inbound message split across chunks and dispatches it", async () => {
    const stdin = new PassThrough();
    stdin.setEncoding("utf8");
    const io = createStdio({ stdin } as any);
    const got: InboundMessage[] = [];
    io.onCommand((m) => got.push(m));
    stdin.write('{"kind":"submit","requestId":"submit-1","mode":"queue","text"');
    stdin.write(':"hi"}\n');
    await new Promise((r) => setImmediate(r));
    expect(got).toHaveLength(1);
    expect((got[0] as any).kind).toBe("submit");
    expect((got[0] as any).text).toBe("hi");
  });
  it("reports disconnect once when stdin ends, and to late subscribers", async () => {
    const stdin = new PassThrough();
    stdin.setEncoding("utf8");
    const io = createStdio({ stdin } as any);
    let early = 0;
    io.onDisconnect(() => { early += 1; });
    stdin.end();
    await new Promise((r) => setImmediate(r));
    expect(early).toBe(1);

    // `close` follows `end` on a destroyed stream; the transition stays terminal.
    let late = 0;
    io.onDisconnect(() => { late += 1; });
    expect(late).toBe(1);
    expect(early).toBe(1);
  });
  it("reports disconnect when stdin errors", async () => {
    const stdin = new PassThrough();
    stdin.setEncoding("utf8");
    const io = createStdio({ stdin } as any);
    let seen = 0;
    io.onDisconnect(() => { seen += 1; });
    stdin.emit("error", new Error("EPIPE"));
    await new Promise((r) => setImmediate(r));
    expect(seen).toBe(1);
  });
  it("ignores non-inbound JSON and malformed lines", async () => {
    const stdin = new PassThrough();
    stdin.setEncoding("utf8");
    const io = createStdio({ stdin } as any);
    const got: InboundMessage[] = [];
    io.onCommand((m) => got.push(m));
    stdin.write('{"kind":"hello","x":1}\n');
    stdin.write("{broken\n");
    await new Promise((r) => setImmediate(r));
    expect(got).toHaveLength(0);
  });
});

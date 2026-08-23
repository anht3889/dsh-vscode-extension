import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import { ProtocolClient } from "../src/protocolClient.js";
import type { OutboundMessage } from "@dsh-vscode/contract";

function makeIo() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  return { stdin, stdout };
}

describe("ProtocolClient", () => {
  it("send(cmd) writes exact ndjson to stdin", () => {
    const { stdin, stdout } = makeIo();
    const client = new ProtocolClient({ stdin, stdout });
    const writes: string[] = [];
    stdin.on("data", (chunk: Buffer) => writes.push(chunk.toString()));

    client.send({
      kind: "submit",
      requestId: "submit-1",
      mode: "queue",
      text: "hi",
    });

    expect(writes.join("")).toBe(
      '{"kind":"submit","requestId":"submit-1","mode":"queue","text":"hi"}\n',
    );
  });

  it("parses stdout ndjson and emits status + event messages", () => {
    const { stdin, stdout } = makeIo();
    const client = new ProtocolClient({ stdin, stdout });
    const received: OutboundMessage[] = [];
    client.onMessage((m) => received.push(m));

    stdout.write('{"kind":"status","state":"idle"}\n');
    stdout.write(
      '{"kind":"event","sessionId":"s1","event":{"type":"tool_use","seq":1,"time":0,"data":{}}}\n'
    );

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual({ kind: "status", state: "idle" });
    expect(received[1]).toEqual({
      kind: "event",
      sessionId: "s1",
      event: { type: "tool_use", seq: 1, time: 0, data: {} },
    });
  });

  it("skips malformed / non-JSON lines silently", () => {
    const { stdin, stdout } = makeIo();
    const client = new ProtocolClient({ stdin, stdout });
    const cb = vi.fn();
    client.onMessage(cb);

    stdout.write("not json\n");
    stdout.write("42\n");
    stdout.write("{oops}\n");
    stdout.write("\n"); // blank line

    expect(cb).not.toHaveBeenCalled();
  });

  it("close() ends stdin", () => {
    const { stdin, stdout } = makeIo();
    const client = new ProtocolClient({ stdin, stdout });

    client.close();

    expect(stdin.writableEnded).toBe(true);
  });
});

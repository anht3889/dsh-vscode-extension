import type { InboundMessage, OutboundMessage } from "@dsh-vscode/contract";
import { isInboundMessage } from "@dsh-vscode/contract";

export class FrameCodec {
  encode(msg: unknown): string { return JSON.stringify(msg) + "\n"; }
  decode(line: string): unknown | null {
    const s = line.trim();
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  }
}

export interface Io { send(msg: OutboundMessage): void; onCommand(cb: (msg: InboundMessage) => void): void; close(): void; }

export function createStdio(opts: { stdout?: NodeJS.WriteStream; stdin?: NodeJS.ReadStream } = {}): Io {
  const out = opts.stdout ?? process.stdout;
  const input = opts.stdin ?? process.stdin;
  const codec = new FrameCodec();
  const listeners: Array<(m: InboundMessage) => void> = [];
  let buf = "";
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      const m = codec.decode(line);
      if (m !== null && isInboundMessage(m)) for (const cb of listeners) cb(m);
    }
  });
  return {
    send(msg) { out.write(codec.encode(msg)); },
    onCommand(cb) { listeners.push(cb); },
    close() { },
  };
}

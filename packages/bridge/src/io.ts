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

export interface Io {
  send(msg: OutboundMessage): void;
  onCommand(cb: (msg: InboundMessage) => void): void;
  /**
   * Register a callback for stdin reaching EOF or becoming unreadable, which
   * means the editor that spawned this process is gone. No further command can
   * arrive, so the owner must exit rather than run on as an orphan. Fires at
   * most once; a callback registered after the fact is invoked immediately.
   */
  onDisconnect(cb: () => void): void;
  close(): void;
}

export function createStdio(opts: { stdout?: NodeJS.WriteStream; stdin?: NodeJS.ReadStream } = {}): Io {
  const out = opts.stdout ?? process.stdout;
  const input = opts.stdin ?? process.stdin;
  const codec = new FrameCodec();
  const listeners: Array<(m: InboundMessage) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  let disconnected = false;
  let buf = "";
  const disconnect = (): void => {
    if (disconnected) return;
    disconnected = true;
    for (const cb of disconnectListeners) cb();
  };
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
  // `end` covers a closed pipe, `close` a destroyed stream, and `error` a pipe
  // torn down under us (EPIPE when the editor is killed). All three mean no
  // further command can arrive, so they share one terminal transition.
  input.on("end", disconnect);
  input.on("close", disconnect);
  input.on("error", disconnect);
  return {
    send(msg) { out.write(codec.encode(msg)); },
    onCommand(cb) { listeners.push(cb); },
    onDisconnect(cb) {
      if (disconnected) { cb(); return; }
      disconnectListeners.push(cb);
    },
    close() { },
  };
}

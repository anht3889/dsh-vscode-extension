import { createInterface } from "node:readline";
import { isOutboundMessage } from "@dsh-vscode/contract";
import type { InboundMessage, OutboundMessage } from "@dsh-vscode/contract";

export interface ChildIo {
  stdout: NodeJS.ReadableStream;
  stdin: NodeJS.WritableStream;
}

export class ProtocolClient {
  private readonly child: ChildIo;
  private readonly listeners = new Set<(m: OutboundMessage) => void>();
  /** Messages that arrived before any listener subscribed — replayed on subscribe
   *  so late listeners (e.g. a handshake-then-test pattern) never miss events. */
  private readonly history: OutboundMessage[] = [];
  private buffering = true;

  constructor(child: ChildIo) {
    this.child = child;
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line: string) => {
      const s = line.trim();
      if (!s) return;
      let m: unknown;
      try {
        m = JSON.parse(s);
      } catch {
        return;
      }
      if (isOutboundMessage(m)) {
        if (this.buffering) this.history.push(m);
        for (const cb of this.listeners) cb(m);
      }
    });
  }

  send(cmd: InboundMessage): void {
    this.child.stdin.write(JSON.stringify(cmd) + "\n");
  }

  onMessage(
    cb: (m: OutboundMessage) => void,
    options: { consumeHistory?: boolean } = {},
  ): () => void {
    // Replay every message that arrived before this listener subscribed.
    for (const m of this.history) cb(m);
    if (options.consumeHistory !== false) {
      this.history.length = 0;
      this.buffering = false;
    }
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  close(): void {
    this.child.stdin.end();
  }
}

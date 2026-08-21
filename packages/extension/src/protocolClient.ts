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
        for (const cb of this.listeners) cb(m);
      }
    });
  }

  send(cmd: InboundMessage): void {
    this.child.stdin.write(JSON.stringify(cmd) + "\n");
  }

  onMessage(cb: (m: OutboundMessage) => void): void {
    this.listeners.add(cb);
  }

  close(): void {
    this.child.stdin.end();
  }
}

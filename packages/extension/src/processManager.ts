import { spawn, type ChildProcess } from "node:child_process";
import { ProtocolClient } from "./protocolClient.js";

export interface ProcessManagerOptions {
  resolveBinary(): string;
  argsFor(): string[];
  /** Optional sink for the child's stderr (line-buffered, UTF-8). */
  onStderr?(text: string): void;
  /** Optional notification when a managed child exits (code + signal). */
  onExit?(folder: string, code: number | null, signal: NodeJS.Signals | null): void;
  /** Optional notification when a child fails to spawn (e.g. ENOENT on the binary). */
  onError?(folder: string, error: Error): void;
  /** Maximum ms to wait for the first stdout line (handshake). Default 5000. */
  handshakeTimeoutMs?: number;
}

interface RunningProcess {
  child: ChildProcess;
  client: ProtocolClient;
}

export class ProcessManager {
  private readonly options: ProcessManagerOptions;
  private readonly running = new Map<string, RunningProcess>();

  constructor(opts: ProcessManagerOptions) {
    this.options = opts;
  }

  /** Spawn the binary and wait for the first stdout line (the `hello` handshake).
   *  Rejects if the child errors before producing any output or if no line appears
   *  within the handshake window — any failure that leaves a submit silently
   *  writing into a dead pipe is converted to a visible rejection. */
  async start(
    folder: string
  ): Promise<{ client: ProtocolClient; child: ChildProcess; stop(): void }> {
    const binary = this.options.resolveBinary();
    const args = this.options.argsFor();

    const child = spawn(binary, args, {
      cwd: folder,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    const stdout = child.stdout;
    const stdin = child.stdin;
    if (!stdout || !stdin) {
      throw new Error("ProcessManager: child stdio streams unavailable");
    }

    // Surface the child's stderr via the optional sink (line-buffered) instead of
    // silently discarding it (a crashing `dsh` writes its error here).
    const stderr = child.stderr;
    if (stderr && this.options.onStderr) {
      let buf = "";
      stderr.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        let newline = buf.indexOf("\n");
        while (newline >= 0) {
          const line = buf.slice(0, newline);
          buf = buf.slice(newline + 1);
          if (line.length > 0) this.options.onStderr!(line);
          newline = buf.indexOf("\n");
        }
      });
    }

    const client = new ProtocolClient({ stdout, stdin });

    // Wait until the client sees the `hello` handshake (via its own stdout
    // readline, avoiding a race with a separate readline on the same stream).
    // A spawn ENOENT, profile-not-found crash, or silent no-op boot all reject
    // the Promise — which the caller surfaces as a visible error.
    const handshakeMs = this.options.handshakeTimeoutMs ?? 5000;
    let unsubscribe = (): void => {};
    const ready = new Promise<void>((resolve, reject) => {
      let settled = false;

      unsubscribe = client.onMessage((m) => {
        if (settled) return;
        if (m.kind === "hello") {
          settled = true;
          resolve();
        }
      }, { consumeHistory: false });
      if (settled) unsubscribe();

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        this.options.onError?.(folder, err);
        reject(err);
      });

      child.on("exit", (code, signal) => {
        if (settled) return;
        settled = true;
        const why =
          code !== null && code !== 0
            ? `dsh exited with code ${code} before handshake`
            : signal
              ? `dsh terminated by ${signal} before handshake`
              : "dsh exited before handshake";
        const err = new Error(why);
        this.options.onError?.(folder, err);
        reject(err);
      });

      setTimeout(() => {
        if (settled) return;
        settled = true;
        const err = new Error(`no handshake from ${binary} after ${handshakeMs}ms`);
        this.options.onError?.(folder, err);
        child.kill("SIGTERM");
        reject(err);
      }, handshakeMs);
    });

    // Block until the handshake arrives or the child fails.
    try {
      await ready;
    } finally {
      unsubscribe();
    }
    this.running.set(folder, { child, client });

    // After handshake: a later exit (post-boot crash) is still surfaced.
    child.on("exit", (code, signal) => {
      if (this.running.get(folder)?.child === child) {
        this.running.delete(folder);
        this.options.onExit?.(folder, code, signal);
      }
    });

    return {
      client,
      child,
      stop: () => {
        this.running.delete(folder);
        this.options.onExit?.(folder, null, null);
        try { client.send({ kind: "exit" }); } catch { /* ignore */ }
        child.kill("SIGTERM");
      },
    };
  }

  hasRunning(folder: string): boolean {
    return this.running.has(folder);
  }

  getChild(folder: string): ChildProcess | undefined {
    return this.running.get(folder)?.child;
  }

  async stop(folder: string): Promise<void> {
    const running = this.running.get(folder);
    if (!running) {
      return;
    }
    this.running.delete(folder);

    const { child, client } = running;

    // If the process already exited, there is nothing to await.
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    try {
      client.send({ kind: "exit" });
    } catch {
      // ignore write failures; the process may already be gone
    }

    const exited = new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      child.once("exit", () => resolve());
    });

    child.kill("SIGTERM");
    await Promise.race([exited, delayMs(2000)]);
    // Escalate if the process ignored SIGTERM and is somehow still alive.
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }

  async stopAll(): Promise<void> {
    const folders = Array.from(this.running.keys());
    await Promise.all(folders.map((f) => this.stop(f)));
  }
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

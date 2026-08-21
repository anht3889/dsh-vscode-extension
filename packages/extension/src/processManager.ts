import { spawn, type ChildProcess } from "node:child_process";
import { ProtocolClient } from "./protocolClient.js";

export interface ProcessManagerOptions {
  resolveBinary(): string;
  argsFor(): string[];
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

  async start(
    folder: string
  ): Promise<{ client: ProtocolClient; stop(): Promise<void> }> {
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

    const client = new ProtocolClient({ stdout, stdin });
    this.running.set(folder, { child, client });

    return {
      client,
      stop: () => this.stop(folder),
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

import { describe, it, expect, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { ProcessManager } from "../src/processManager.js";
import type { OutboundMessage } from "@dsh-vscode/contract";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fakeDsh = path.join(__dirname, "fakeDsh.mjs");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pm-"));
let folderCounter = 0;
function tmpFolder(): string {
  folderCounter += 1;
  const dir = path.join(tmpRoot, `folder-${folderCounter}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeManager() {
  return new ProcessManager({
    resolveBinary: () => "node",
    argsFor: () => [fakeDsh],
  });
}

function waitForMessage(
  client: { onMessage(cb: (m: OutboundMessage) => void): void },
  predicate: (m: OutboundMessage) => boolean,
  timeoutMs = 5000
): Promise<OutboundMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for message")),
      timeoutMs
    );
    client.onMessage((m) => {
      if (predicate(m)) {
        clearTimeout(timer);
        resolve(m);
      }
    });
  });
}

describe("ProcessManager", () => {
  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("start() spawns the dsh child and the client emits a hello message", async () => {
    const pm = makeManager();
    const { client, stop } = await pm.start(tmpFolder());

    try {
      const hello = await waitForMessage(client, (m) => m.kind === "hello");
      expect(hello).toMatchObject({ kind: "hello", version: 1, dshVersion: "fake" });
      expect((hello as { cwd: string }).cwd).toBeTruthy();
    } finally {
      await stop();
    }
  });

  it("hasRunning(folder) is true after start and false after stop", async () => {
    const pm = makeManager();
    const folder = tmpFolder();

    await pm.start(folder);
    expect(pm.hasRunning(folder)).toBe(true);

    await pm.stop(folder);
    expect(pm.hasRunning(folder)).toBe(false);
  });

  it("stop() terminates the child; a second stop is a no-op", async () => {
    const pm = makeManager();
    const folder = tmpFolder();

    await pm.start(folder);
    const child = pm.getChild(folder)!;
    expect(pm.hasRunning(folder)).toBe(true);

    await pm.stop(folder);
    expect(pm.hasRunning(folder)).toBe(false);
    expect(pm.getChild(folder)).toBeUndefined();
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);

    // second stop must not throw
    await pm.stop(folder);
    expect(pm.hasRunning(folder)).toBe(false);
  });

  it("stop() stops only the given folder's process", async () => {
    const pm = makeManager();
    const a = tmpFolder();
    const b = tmpFolder();

    await pm.start(a);
    await pm.start(b);
    expect(pm.hasRunning(a)).toBe(true);
    expect(pm.hasRunning(b)).toBe(true);

    await pm.stop(a);
    expect(pm.hasRunning(a)).toBe(false);
    expect(pm.hasRunning(b)).toBe(true);

    await pm.stop(b);
  });

  it("stopAll() stops multiple folders", async () => {
    const pm = makeManager();
    const folders = [tmpFolder(), tmpFolder(), tmpFolder()];

    for (const f of folders) {
      await pm.start(f);
    }
    for (const f of folders) {
      expect(pm.hasRunning(f)).toBe(true);
    }

    await pm.stopAll();
    for (const f of folders) {
      expect(pm.hasRunning(f)).toBe(false);
    }
  });
});

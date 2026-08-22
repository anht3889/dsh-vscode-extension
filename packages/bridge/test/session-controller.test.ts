import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startMockLlmServer,
  type MockLlmServer,
} from "@deepseek-ai/dsh-llm-mock-server";
import type { OutboundMessage } from "@dsh-vscode/contract";
import type { Io } from "../src/io.js";
import { createRunner } from "../src/runner.js";
import { bootTree, type BootOptions } from "./boot.js";

let mock: MockLlmServer;
let persistenceRoot: string;

function capture(messages: OutboundMessage[]): Io {
  return {
    send(message) {
      messages.push(message);
    },
    onCommand() {},
    close() {},
  };
}

function options(overrides: Partial<BootOptions> = {}): BootOptions {
  return {
    baseURL: mock.baseURL,
    provider: "deepseek-official",
    model: "mock-model",
    persistenceRoot,
    ...overrides,
  };
}

describe("session controller", () => {
  beforeAll(async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    persistenceRoot = await mkdtemp(join(tmpdir(), "dsh-vscode-sessions-"));
    mock = await startMockLlmServer({
      sequence: ["success"],
      repeatLast: true,
      successText: "hello from the mock",
    });
  });

  afterAll(async () => {
    await mock.close();
    await rm(persistenceRoot, { recursive: true, force: true });
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("lists the live workspace session with durable history available", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(await bootTree(options()), capture(messages));

    runner.submit("workspace list title");
    await waitFor(
      () =>
        messages.some(
          (message) => message.kind === "status" && message.state === "idle",
        ),
      60_000,
    );
    runner.listSessions();

    await waitFor(() => messages.some((message) => message.kind === "sessions"));
    const list = messages.find((message) => message.kind === "sessions");
    expect(list?.kind).toBe("sessions");
    if (list?.kind === "sessions") {
      expect(list.available).toBe(true);
      expect(list.items).toHaveLength(1);
      expect(list.items[0]?.cwd).toBe(process.cwd());
      expect(list.items[0]?.title).toBe("workspace list title");
      expect(list.items[0]?.updatedAt).toBeGreaterThanOrEqual(
        list.items[0]?.createdAt ?? Number.POSITIVE_INFINITY,
      );
    }
  });

  it("falls back to the live session when durable history is unavailable", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(
      await bootTree(options({ persistenceRoot: undefined })),
      capture(messages),
    );

    runner.listSessions();

    await waitFor(() => messages.some((message) => message.kind === "sessions"));
    const list = messages.find((message) => message.kind === "sessions");
    expect(list?.kind).toBe("sessions");
    if (list?.kind === "sessions") {
      expect(list.available).toBe(false);
      expect(list.items).toHaveLength(1);
    }
  });

  it("creates a different session and emits its empty history", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(await bootTree(options()), capture(messages));
    const firstReady = messages.find((message) => message.kind === "ready");

    runner.newSession();

    await waitFor(
      () => messages.filter((message) => message.kind === "session").length >= 2,
    );
    const latestSession = messages
      .filter((message) => message.kind === "session")
      .at(-1);
    expect(latestSession?.kind).toBe("session");
    if (latestSession?.kind === "session") {
      expect(latestSession.sessionId).not.toBe(
        firstReady?.kind === "ready" ? firstReady.sessionId : "",
      );
      await waitFor(() =>
        messages.some(
          (message) =>
            message.kind === "history" &&
            message.sessionId === latestSession.sessionId,
        ),
      );
      const history = messages.find(
        (message) =>
          message.kind === "history" &&
          message.sessionId === latestSession.sessionId,
      );
      expect(history?.kind === "history" ? history.events : undefined).toEqual([]);
    }
  });

  it("resumes a flushed persisted session and emits its history", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(await bootTree(options()), capture(messages));
    const ready = messages.find((message) => message.kind === "ready");
    if (ready?.kind !== "ready") throw new Error("runner did not become ready");

    runner.submit("remember this");
    await waitFor(
      () =>
        messages.some(
          (message) => message.kind === "status" && message.state === "idle",
        ),
      60_000,
    );
    const oldId = ready.sessionId;

    runner.newSession();
    await waitFor(
      () => messages.filter((message) => message.kind === "session").length >= 2,
    );
    runner.resume(oldId);

    await waitFor(
      () =>
        messages.some(
          (message) =>
            message.kind === "history" && message.sessionId === oldId,
        ),
      60_000,
    );
    const history = messages.find(
      (message) => message.kind === "history" && message.sessionId === oldId,
    );
    expect(history?.kind === "history" && history.events.length).toBeGreaterThan(0);
  }, 120_000);

  it("rejects a missing session without replacing the current session", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(await bootTree(options()), capture(messages));
    const before = messages.find((message) => message.kind === "ready");
    if (before?.kind !== "ready") throw new Error("runner did not become ready");

    runner.resume("missing-id");

    await waitFor(() =>
      messages.some(
        (message) => message.kind === "status" && message.state === "error",
      ),
    );
    runner.submit("still live");
    await waitFor(
      () =>
        messages.some(
          (message) =>
            message.kind === "event" &&
            message.sessionId === before.sessionId &&
            message.event.type === "turn/end",
        ),
      60_000,
    );
    const latestReady = messages
      .filter((message) => message.kind === "ready")
      .at(-1);
    expect(latestReady?.kind === "ready" ? latestReady.sessionId : "").toBe(
      before.sessionId,
    );
  }, 120_000);

  it("rejects a persisted session from another cwd without replacing the current session", async () => {
    const originalCwd = process.cwd();
    const foreignCwd = await mkdtemp(join(tmpdir(), "dsh-vscode-foreign-"));
    const messages: OutboundMessage[] = [];
    try {
      process.chdir(foreignCwd);
      const runner = await createRunner(await bootTree(options()), capture(messages));
      const foreignReady = messages.find((message) => message.kind === "ready");
      if (foreignReady?.kind !== "ready") {
        throw new Error("runner did not become ready");
      }
      runner.submit("foreign workspace history");
      await waitFor(
        () =>
          messages.some(
            (message) => message.kind === "status" && message.state === "idle",
          ),
        60_000,
      );

      process.chdir(originalCwd);
      runner.newSession();
      await waitFor(
        () => messages.filter((message) => message.kind === "ready").length >= 2,
      );
      const currentReady = messages
        .filter((message) => message.kind === "ready")
        .at(-1);
      if (currentReady?.kind !== "ready") {
        throw new Error("new session did not become ready");
      }

      runner.resume(foreignReady.sessionId);
      await waitFor(() =>
        messages.some(
          (message) =>
            message.kind === "status" &&
            message.state === "error" &&
            message.detail?.includes("cwd mismatch") === true,
        ),
      );
      runner.submit("current workspace remains live");
      await waitFor(
        () =>
          messages.some(
            (message) =>
              message.kind === "event" &&
              message.sessionId === currentReady.sessionId &&
              message.event.type === "turn/end",
          ),
        60_000,
      );
    } finally {
      process.chdir(originalCwd);
      await rm(foreignCwd, { recursive: true, force: true });
    }
  }, 120_000);
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("waitFor timed out");
}

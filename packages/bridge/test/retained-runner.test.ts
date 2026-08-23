import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startMockLlmServer } from "@deepseek-ai/dsh-llm-mock-server";
import type { MockLlmServer } from "@deepseek-ai/dsh-llm-mock-server";
import type { EventMessage, OutboundMessage } from "@dsh-vscode/contract";
import { PROTOCOL_VERSION } from "@dsh-vscode/contract";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import type { Io } from "../src/io.js";
import { bootTree } from "./boot.js";
import { createRunner } from "../src/runner.js";

let mock: MockLlmServer;

// A minimal in-memory Io that records every outbound message.
function capture(
  messages: OutboundMessage[],
  disconnectListeners?: Array<() => void>,
): Io {
  return {
    send(msg) {
      messages.push(msg);
    },
    onCommand() {},
    onDisconnect(listener) {
      disconnectListeners?.push(listener);
    },
    close() {},
  };
}

function turnEnds(messages: OutboundMessage[]): EventMessage[] {
  return messages.filter(
    (m): m is EventMessage => m.kind === "event" && m.event.type === "turn/end",
  );
}

describe("createRunner (retained)", () => {
  beforeAll(async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    mock = await startMockLlmServer({
      sequence: ["success"],
      repeatLast: true,
      successText: "hello from the mock",
    });
  });

  afterAll(async () => {
    await mock.close();
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("emits hello, session, then ready in order", async () => {
    const messages: OutboundMessage[] = [];
    const io = capture(messages);
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });

    await createRunner(ctx, io);

    expect(messages.length).toBeGreaterThan(0);
    const first = messages[0];
    expect(first.kind).toBe("hello");
    if (first.kind === "hello") {
      expect(first.version).toBe(PROTOCOL_VERSION);
      expect(first.dshVersion).toBe("0.1.0");
      expect(first.cwd).toBe(process.cwd());
    }

    const lifecycle = messages.filter(
      (message) =>
        message.kind === "hello" ||
        message.kind === "session" ||
        message.kind === "ready",
    );
    expect(lifecycle.map((message) => message.kind)).toEqual([
      "hello",
      "session",
      "ready",
    ]);
    const ready = lifecycle.at(-1);
    expect(ready).toBeDefined();
    if (ready?.kind === "ready") {
      expect(ready.sessionId).toEqual(expect.any(String));
      expect(ready.permissions.current).toBe("workspace-write");
      expect(ready.models.current.model).toBe("mock-model");
    }
  }, 60_000);

  it("submits twice through one agent, producing two distinct turn/end events", async () => {
    const messages: OutboundMessage[] = [];
    const io = capture(messages);
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });

    const runner = await createRunner(ctx, io);

    // First submit: one full turn.
    runner.submit("first question", { requestId: "test-submit-1", mode: "queue" });
    await waitFor(() => turnEnds(messages).length >= 1, 60_000);
    expect(turnEnds(messages).length).toBe(1);

    // Second submit on the SAME agent/session: a second, distinct turn.
    runner.submit("second question", { requestId: "test-submit-2", mode: "queue" });
    await waitFor(() => turnEnds(messages).length >= 2, 60_000);
    expect(turnEnds(messages).length).toBe(2);

    // Both turns must carry monotonically increasing turn numbers and share one session.
    const [first, second] = turnEnds(messages);
    const sessionId = first.event.data.turn ? first.sessionId : second.sessionId;
    expect(first.sessionId).toBe(second.sessionId);
    expect(second.event.data.turn).toBeGreaterThan(first.event.data.turn);
    expect(sessionId).toBeTypeOf("string");
  }, 120_000);

  it("admits queue through the next-turn inbox", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });
    const runner = await createRunner(ctx, capture(messages));

    runner.submit("queue this", { requestId: "queue-admission", mode: "queue" });
    await waitFor(
      () => messages.some(
        (message) =>
          message.kind === "submitResult" &&
          message.requestId === "queue-admission" &&
          message.result.ok,
      ),
      60_000,
    );

    expect(messages).toContainEqual(expect.objectContaining({
      kind: "event",
      event: expect.objectContaining({
        type: "agent/inbox/spliced",
        data: expect.objectContaining({ target: "next-turn" }),
      }),
    }));
  }, 60_000);

  it("cancel() aborts the active turn", async () => {
    // A dedicated slow mock keeps the turn mid-stream long enough to cancel.
    const slow = await startMockLlmServer({
      sequence: ["slow_success"],
      repeatLast: true,
      successText: "streaming slowly so we can cancel",
      chunkSize: 2,
      chunkDelayMs: 500,
    });
    try {
      const messages: OutboundMessage[] = [];
      const io = capture(messages);
      const ctx = await bootTree({
        baseURL: slow.baseURL,
        provider: "deepseek-official",
        model: "mock-model",
      });

      const runner = await createRunner(ctx, io);
      runner.submit("a question that will be cancelled", { requestId: "test-submit-3", mode: "queue" });
      await waitFor(() => messages.some((m) => m.kind === "event" && m.event.type === "turn/start"), 60_000);

      runner.cancel();

      await waitFor(() => turnEnds(messages).length >= 1, 60_000);
      const ends = turnEnds(messages);
      expect(ends.length).toBeGreaterThanOrEqual(1);
      // The (latest) completed end must reflect an abort, not a normal completion.
      const last = ends[ends.length - 1];
      expect(last.event.data.reason.kind).toBe("aborted");
    } finally {
      await slow.close();
    }
  }, 120_000);

  it("admits busy steer before the active turn completes", async () => {
    const slow = await startMockLlmServer({
      sequence: ["slow_success"],
      repeatLast: true,
      successText: "streaming slowly enough to steer",
      chunkSize: 2,
      chunkDelayMs: 300,
    });
    try {
      const messages: OutboundMessage[] = [];
      const ctx = await bootTree({
        baseURL: slow.baseURL,
        provider: "deepseek-official",
        model: "mock-model",
      });
      const runner = await createRunner(ctx, capture(messages));
      runner.submit("begin", { requestId: "queue-1", mode: "queue" });
      await waitFor(
        () => messages.some(
          (message) => message.kind === "event" && message.event.type === "turn/start",
        ),
        60_000,
      );
      runner.submit("steer now", { requestId: "steer-1", mode: "steer" });
      await waitFor(
        () => messages.some(
          (message) =>
            message.kind === "submitResult" &&
            message.requestId === "steer-1" &&
            message.result.ok,
        ),
        60_000,
      );
      const steerResult = messages.findIndex(
        (message) =>
          message.kind === "submitResult" && message.requestId === "steer-1",
      );
      const firstTurnEnd = messages.findIndex(
        (message) =>
          message.kind === "event" && message.event.type === "turn/end",
      );
      expect(steerResult).toBeGreaterThanOrEqual(0);
      expect(firstTurnEnd === -1 || steerResult < firstTurnEnd).toBe(true);
      expect(messages).toContainEqual(expect.objectContaining({
        kind: "event",
        event: expect.objectContaining({
          type: "agent/inbox/spliced",
          data: expect.objectContaining({ target: "next-step" }),
        }),
      }));
    } finally {
      await slow.close();
    }
  }, 120_000);

  it("recovers after a rejected turn: emits status:error, then accepts a new submit", async () => {
    const messages: OutboundMessage[] = [];
    const io = capture(messages);
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });

    const runner = await createRunner(ctx, io);

    // Register a one-shot throwing session/flush listener so the FIRST submit's
    // `sessions.flush(agent.session)` rejects, mirroring a failing persistence plugin.
    let flushCalls = 0;
    ctx.on("session/flush", () => {
      flushCalls += 1;
      if (flushCalls === 1) {
        throw new Error("flush exploded");
      }
    });

    runner.submit("a question whose flush will fail", { requestId: "test-submit-4", mode: "queue" });
    await waitFor(
      () => messages.some((m) => m.kind === "status" && m.state === "error"),
      60_000,
    );
    const errorStatus = messages.find(
      (m) => m.kind === "status" && m.state === "error",
    );
    expect(errorStatus).toBeDefined();
    expect((errorStatus as { detail?: string }).detail).toContain(
      "flush exploded",
    );

    // Recovery: a second submit on the SAME runner must still produce a fresh turn/end.
    runner.submit("a follow-up after recovery", { requestId: "test-submit-5", mode: "queue" });
    await waitFor(() => turnEnds(messages).length >= 1, 60_000);
    expect(turnEnds(messages).length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("keeps one settings coordinator across live session replacement", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });
    const runner = await createRunner(ctx, capture(messages));

    runner.getSection("before", "general");
    await waitFor(
      () => messages.some(
        (message) =>
          message.kind === "settingsSection" &&
          message.requestId === "before",
      ),
      60_000,
    );
    runner.newSession();
    await waitFor(
      () => messages.filter((message) => message.kind === "ready").length === 2,
      60_000,
    );
    runner.getSection("after", "general");
    await waitFor(
      () => messages.some(
        (message) =>
          message.kind === "settingsSection" &&
          message.requestId === "after",
      ),
      60_000,
    );

    ctx.emit(
      "settings/document-updated",
      settingsNamespace("locale"),
      2,
    );
    expect(
      messages.filter(
        (message) =>
          message.kind === "settingsInvalidated" &&
          message.reason === "document",
      ),
    ).toHaveLength(1);
  }, 120_000);

  it("refreshes the composer catalog after model topology invalidation", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });
    await createRunner(ctx, capture(messages));

    ctx.emit("llm/adapters-updated");
    await waitFor(
      () => messages.some((message) => message.kind === "catalog"),
      60_000,
    );

    const invalidationIndex = messages.findIndex(
      (message) =>
        message.kind === "settingsInvalidated" &&
        message.reason === "models",
    );
    const catalogIndex = messages.findIndex((message) => message.kind === "catalog");
    expect(invalidationIndex).toBeGreaterThanOrEqual(0);
    expect(catalogIndex).toBeGreaterThan(invalidationIndex);
  }, 60_000);

  it("suppresses an in-flight settings catalog refresh after disconnect", async () => {
    const messages: OutboundMessage[] = [];
    const disconnectListeners: Array<() => void> = [];
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });
    await createRunner(ctx, capture(messages, disconnectListeners));
    const llm = ctx.get("llm");
    if (llm === undefined) throw new Error("llm was not mounted");
    const pending = deferred<Awaited<ReturnType<typeof llm.listModels>>>();
    let started = false;
    llm.listModels = () => {
      started = true;
      return pending.promise;
    };
    messages.length = 0;

    ctx.emit("llm/adapters-updated");
    await waitFor(() => started, 60_000);
    expect(messages).toContainEqual({
      kind: "settingsInvalidated",
      sections: ["models"],
      reason: "models",
    });
    for (const disconnect of disconnectListeners) disconnect();
    pending.resolve([]);
    await new Promise((resolve) => setImmediate(resolve));

    expect(messages.some((message) => message.kind === "catalog")).toBe(false);
  }, 60_000);

  it("suppresses an in-flight settings mutation after bridge disconnect", async () => {
    const messages: OutboundMessage[] = [];
    const disconnectListeners: Array<() => void> = [];
    const pending = deferred<void>();
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });
    const settings = ctx.get("settings");
    if (settings === undefined) throw new Error("settings were not mounted");
    settings.mutate = () => pending.promise;
    const runner = await createRunner(
      ctx,
      capture(messages, disconnectListeners),
    );

    runner.mutate({
      kind: "mutateSettings",
      requestId: "disconnect-mutation",
      namespace: "locale",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["preference"], value: "zh" }],
    });
    for (const disconnect of disconnectListeners) disconnect();
    pending.resolve(undefined);
    await new Promise((resolve) => setImmediate(resolve));

    expect(messages.some(
      (message) =>
        message.kind === "settingsMutation" &&
        message.requestId === "disconnect-mutation",
    )).toBe(false);
  }, 60_000);

  it("suppresses an in-flight settings mutation during context teardown", async () => {
    const messages: OutboundMessage[] = [];
    const pending = deferred<void>();
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });
    const settings = ctx.get("settings");
    if (settings === undefined) throw new Error("settings were not mounted");
    settings.mutate = () => pending.promise;
    const runner = await createRunner(ctx, capture(messages));

    runner.mutate({
      kind: "mutateSettings",
      requestId: "teardown-mutation",
      namespace: "locale",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["preference"], value: "zh" }],
    });
    const teardown = ctx.fiber.dispose();
    await new Promise((resolve) => setImmediate(resolve));
    pending.resolve(undefined);
    await teardown;
    await new Promise((resolve) => setImmediate(resolve));

    expect(messages.some(
      (message) =>
        message.kind === "settingsMutation" &&
        message.requestId === "teardown-mutation",
    )).toBe(false);
  }, 60_000);
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timed out");
}

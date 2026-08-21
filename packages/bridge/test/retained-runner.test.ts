import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startMockLlmServer } from "@deepseek-ai/dsh-llm-mock-server";
import type { MockLlmServer } from "@deepseek-ai/dsh-llm-mock-server";
import type { OutboundMessage } from "@dsh-vscode/contract";
import type { Io } from "../src/io.js";
import { bootTree } from "./boot.js";
import { createRunner } from "../src/runner.js";

let mock: MockLlmServer;

// A minimal in-memory Io that records every outbound message.
function capture(messages: OutboundMessage[]): Io {
  return {
    send(msg) {
      messages.push(msg);
    },
    onCommand() {},
    close() {},
  };
}

function turnEnds(messages: OutboundMessage[]): OutboundMessage[] {
  return messages.filter(
    (m) => m.kind === "event" && m.event.type === "turn/end",
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
    runner.submit("first question");
    await waitFor(() => turnEnds(messages).length >= 1, 60_000);
    expect(turnEnds(messages).length).toBe(1);

    // Second submit on the SAME agent/session: a second, distinct turn.
    runner.submit("second question");
    await waitFor(() => turnEnds(messages).length >= 2, 60_000);
    expect(turnEnds(messages).length).toBe(2);

    // Both turns must carry monotonically increasing turn numbers and share one session.
    const [first, second] = turnEnds(messages);
    const sessionId = first.event.data.turn ? first.sessionId : second.sessionId;
    expect(first.sessionId).toBe(second.sessionId);
    expect(second.event.data.turn).toBeGreaterThan(first.event.data.turn);
    expect(sessionId).toBeTypeOf("string");
  }, 120_000);

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
      runner.submit("a question that will be cancelled");
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
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timed out");
}

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startMockLlmServer } from "@deepseek-ai/dsh-llm-mock-server";
import type { MockLlmServer } from "@deepseek-ai/dsh-llm-mock-server";
import type { OutboundMessage } from "@dsh-vscode/contract";
import type { Io } from "../src/io.js";
import { bootTree } from "./boot.js";
import { runVscode, toWire } from "../src/runner.js";

let mock: MockLlmServer;

// A minimal in-memory Io that records every outbound message so the test can
// assert on what the runner actually relayed — no process IO, no exit.
function capture(messages: OutboundMessage[]): Io {
  return {
    send(msg) {
      messages.push(msg);
    },
    onCommand() {},
    close() {},
  };
}

/**
 * Drive `runVscode` against the mock LLM server and return every outbound
 * message the runner emitted.
 */
async function driveRun(task: string): Promise<OutboundMessage[]> {
  const messages: OutboundMessage[] = [];
  const io = capture(messages);
  const ctx = await bootTree({
    baseURL: mock.baseURL,
    provider: "deepseek-official",
    model: "mock-model",
  });
  await runVscode(ctx, io, task);
  return messages;
}

describe("runVscode", () => {
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

  it("emits session events and ends with an idle status", async () => {
    const messages = await driveRun("say hello");

    // The runner must relay `session/event` firehose out as `event` messages.
    const eventMessages = messages.filter((m) => m.kind === "event");
    expect(eventMessages.length).toBeGreaterThan(0);

    // At least one relayed event must be the turn that just completed.
    const turnEnd = eventMessages.find(
      (m) => m.kind === "event" && m.event.type === "turn/end",
    );
    expect(turnEnd).toBeDefined();
    if (turnEnd && turnEnd.kind === "event") {
      expect(turnEnd.event.seq).toBeTypeOf("number");
      expect(turnEnd.event.time).toBeTypeOf("number");
      expect(turnEnd.event.data).toBeTypeOf("object");
      expect(typeof turnEnd.sessionId).toBe("string");
      expect(turnEnd.event.data.reason.kind).toBe("completed");
      expect(typeof turnEnd.event.data.turn).toBe("number");
    }

    // And the runner must finish by reporting idle — not exit the process.
    const statuses = messages.filter((m) => m.kind === "status");
    expect(statuses.length).toBeGreaterThan(0);
    const idle = statuses.at(-1);
    expect(idle && idle.kind === "status" && idle.state).toBe("idle");
  }, 60_000);
});

describe("toWire", () => {
  it("round-trips type / seq / time / data", async () => {
    const { toWire } = await import("../src/runner.js");

    const data = {
      turn: 3,
      reason: { kind: "completed" as const },
    };
    const wire = toWire({
      type: "turn/end",
      seq: 42,
      time: 1_700_000_000_000,
      data,
    });

    expect(wire.type).toBe("turn/end");
    expect(wire.seq).toBe(42);
    expect(wire.time).toBe(1_700_000_000_000);
    expect(wire.data).toEqual(data);
  });
});

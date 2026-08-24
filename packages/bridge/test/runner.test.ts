import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { CallId, createToolResultMessage } from "@deepseek-ai/dsh-llm";
import { startMockLlmServer } from "@deepseek-ai/dsh-llm-mock-server";
import type { MockLlmServer } from "@deepseek-ai/dsh-llm-mock-server";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import { defineContentToolFixture } from "@deepseek-ai/dsh-tools";
import type { OutboundMessage } from "@dsh-vscode/contract";
import type { Io } from "../src/io.js";
import { bootTree } from "./boot.js";
import {
  createRunner,
  runVscode,
  toWire,
  viewFor,
  wireEvent,
} from "../src/runner.js";

let mock: MockLlmServer;

// A minimal in-memory Io that records every outbound message so the test can
// assert on what the runner actually relayed — no process IO, no exit.
function capture(messages: OutboundMessage[]): Io {
  return {
    send(msg) {
      messages.push(msg);
    },
    onCommand() {},
    onDisconnect() {},
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

type ToolCallEvent = Extract<SessionEvent, { type: "tool/call" }>;
type ToolResultEvent = Extract<SessionEvent, { type: "tool/result" }>;

function toolCallEvent(
  seq: number,
  callId: string,
  raw = "{\"command\":\"echo hi\"}",
): ToolCallEvent {
  return {
    type: "tool/call",
    seq,
    time: seq,
    data: {
      turn: 1,
      step: 1,
      callId: CallId(callId),
      name: "bash",
      arguments: raw,
    },
  };
}

function toolResultEvent(seq: number, callId: string): ToolResultEvent {
  return {
    type: "tool/result",
    seq,
    time: seq,
    data: {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId(callId),
        content: [],
        isError: false,
      }),
    },
  };
}

function installBashPresenter(ctx: Context): void {
  const tools = ctx.get("tools");
  if (tools === undefined) throw new Error("tools were not mounted");
  tools.register(
    defineContentToolFixture({
      name: "bash",
      description: "Run a command",
      parameters: { command: { type: "string", required: true } },
      async execute() {
        return [];
      },
      presentCall: (args) => ({
        card: "terminal",
        title: args.command,
      }),
      presentResult: (args) => ({
        card: "terminal",
        output: `completed: ${args.command}`,
        exitCode: 0,
      }),
    }),
  );
}

function emittedEvents(
  messages: readonly OutboundMessage[],
  start: number,
): Extract<OutboundMessage, { kind: "event" }>[] {
  return messages.slice(start).filter(
    (message): message is Extract<OutboundMessage, { kind: "event" }> =>
      message.kind === "event",
  );
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

  it("releases accumulated arguments once a call's result is relayed", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });
    installBashPresenter(ctx);
    try {
      await runVscode(ctx, capture(messages), "say hello");
      const session = ctx.get("sessions")?.list()[0];
      if (session === undefined) throw new Error("session was not created");
      const start = messages.length;

      ctx.emit("session/event", session, toolCallEvent(110, "settled"));
      ctx.emit("session/event", session, toolResultEvent(111, "settled"));
      // Nothing appended the call to the session log, so a repeat result has no
      // remaining pairing once the settled call has been released.
      ctx.emit("session/event", session, toolResultEvent(112, "settled"));

      const events = emittedEvents(messages, start);
      expect(events[1]?.event.view).toEqual({
        for: "result",
        view: {
          card: "terminal",
          output: "completed: echo hi",
          exitCode: 0,
        },
      });
      expect(events[2]?.event.view).toBeUndefined();
    } finally {
      await ctx.fiber.dispose();
    }
  }, 60_000);

  it("enriches live tool events from accumulated arguments and clears them at turn end", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });
    installBashPresenter(ctx);
    try {
      await runVscode(ctx, capture(messages), "say hello");
      const session = ctx.get("sessions")?.list()[0];
      if (session === undefined) throw new Error("session was not created");
      const start = messages.length;

      ctx.emit("session/event", session, toolCallEvent(100, "live-run"));
      ctx.emit("session/event", session, toolResultEvent(101, "live-run"));
      ctx.emit("session/event", session, {
        type: "turn/end",
        seq: 102,
        time: 102,
        data: { turn: 1, reason: { kind: "completed" } },
      });
      ctx.emit("session/event", session, toolResultEvent(103, "live-run"));

      const events = emittedEvents(messages, start);
      expect(events[0]?.event.view).toEqual({
        for: "call",
        view: { card: "terminal", title: "echo hi" },
      });
      expect(events[1]?.event.view).toEqual({
        for: "result",
        view: {
          card: "terminal",
          output: "completed: echo hi",
          exitCode: 0,
        },
      });
      expect(events[3]?.event.view).toBeUndefined();
    } finally {
      await ctx.fiber.dispose();
    }
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

describe("viewFor", () => {
  const registry = {
    get(name: string) {
      if (name !== "bash") return undefined;
      return {
        presentCall: (args: unknown) => ({ card: "terminal" as const, title: "echo hi", description: "Say hi" }),
        presentResult: (_args: unknown, result: { content: unknown }) => ({
          card: "terminal" as const,
          output: JSON.stringify(result.content),
          exitCode: 0,
        }),
      };
    },
  };
  const tools = () => registry;

  it("attaches a call view", () => {
    expect(viewFor(tools, toolCallEvent(1, "c1"), () => undefined)).toEqual({
      for: "call",
      view: { card: "terminal", title: "echo hi", description: "Say hi" },
    });
  });

  it("attaches a result view when the call can be paired", () => {
    expect(viewFor(tools, toolResultEvent(2, "c1"), () => ({
      name: "bash",
      args: { command: "echo hi" },
    }))).toEqual({
      for: "result",
      view: { card: "terminal", output: "[]", exitCode: 0 },
    });
  });

  it("passes the tool-result block's payload to the presenter", () => {
    const event = toolResultEvent(2, "c1");
    const withPayload: typeof event = {
      ...event,
      data: {
        ...event.data,
        message: createToolResultMessage({
          callId: CallId("c1"),
          content: [{ type: "text", text: "hi\n" }],
          isError: false,
        }),
      },
    };
    expect(viewFor(tools, withPayload, () => ({
      name: "bash",
      args: { command: "echo hi" },
    }))).toEqual({
      for: "result",
      view: {
        card: "terminal",
        output: JSON.stringify([{ type: "text", text: "hi\n" }]),
        exitCode: 0,
      },
    });
  });

  it("does not look up presenters for an event that cannot carry a view", () => {
    let lookups = 0;
    const counted = () => {
      lookups += 1;
      return registry;
    };
    expect(
      viewFor(counted, {
        type: "turn/end",
        seq: 1,
        time: 0,
        data: { turn: 1, reason: { kind: "completed" } },
      }, () => undefined),
    ).toBeUndefined();
    expect(lookups).toBe(0);
  });

  it("omits view when tools is missing, pairing fails, JSON is bad, or the presenter throws", () => {
    expect(viewFor(() => undefined, toolCallEvent(1, "c1", "{"), () => undefined)).toBeUndefined();
    expect(viewFor(tools, toolResultEvent(2, "missing"), () => undefined)).toBeUndefined();
    const boom = () => ({ get: () => ({ presentCall: () => { throw new Error("nope"); } }) });
    expect(viewFor(boom, toolCallEvent(1, "c1", "{}"), () => undefined)).toBeUndefined();
  });
});

it("wireEvent adds view only when viewFor returns one", () => {
  const event: Extract<SessionEvent, { type: "turn/end" }> = {
    type: "turn/end",
    seq: 1,
    time: 0,
    data: { turn: 1, reason: { kind: "completed" } },
  };
  expect(wireEvent(event, () => undefined, () => undefined).view).toBeUndefined();
});

it("enriches retained live events and reconstructs history arguments by backscan", async () => {
  const messages: OutboundMessage[] = [];
  const ctx = await bootTree({
    baseURL: mock.baseURL,
    provider: "deepseek-official",
    model: "mock-model",
  });
  installBashPresenter(ctx);
  try {
    const runner = await createRunner(ctx, capture(messages));
    const session = ctx.get("sessions")?.list()[0];
    if (session === undefined) throw new Error("session was not created");
    const liveStart = messages.length;

    ctx.emit("session/event", session, toolCallEvent(200, "live-retained"));
    ctx.emit("session/event", session, toolResultEvent(201, "live-retained"));

    const liveEvents = emittedEvents(messages, liveStart);
    expect(liveEvents[0]?.event.view).toEqual({
      for: "call",
      view: { card: "terminal", title: "echo hi" },
    });
    expect(liveEvents[1]?.event.view).toEqual({
      for: "result",
      view: {
        card: "terminal",
        output: "completed: echo hi",
        exitCode: 0,
      },
    });

    session.append("turn/start", { turn: 1 });
    session.append("step/start", { turn: 1, step: 1 });
    const call = session.append("tool/call", {
      turn: 1,
      step: 1,
      callId: CallId("history"),
      name: "bash",
      arguments: "{\"command\":\"from history\"}",
    });
    session.append(
      "tool/result",
      {
        turn: 1,
        step: 1,
        message: createToolResultMessage({
          callId: CallId("history"),
          content: [],
          isError: false,
        }),
      },
      { surfaceOp: "append", sourceEventSeqs: [call.seq] },
    );
    session.append("step/end", { turn: 1, step: 1 });
    session.append("turn/end", {
      turn: 1,
      reason: { kind: "completed" },
    });

    const historyStart = messages.length;
    runner.resume(session.id);
    await waitFor(
      () => messages.slice(historyStart).some((message) => message.kind === "history"),
      5_000,
    );
    const history = messages.slice(historyStart).find(
      (message) => message.kind === "history",
    );
    expect(history?.kind).toBe("history");
    if (history?.kind === "history") {
      const result = history.events.find(
        (event) =>
          event.type === "tool/result" &&
          event.data.message.source.callId === "history",
      );
      expect(result?.view).toEqual({
        for: "result",
        view: {
          card: "terminal",
          output: "completed: from history",
          exitCode: 0,
        },
      });
    }
  } finally {
    await ctx.fiber.dispose();
  }
}, 60_000);

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("waitFor timed out");
}

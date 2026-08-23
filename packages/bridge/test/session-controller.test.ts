import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  AttachmentId,
  type AttachmentStore,
  type ImageAttachmentRef,
  type SaveImageAttachment,
} from "@deepseek-ai/dsh-attachment";
import CommandRuntime, {
  type CommandInvocation,
} from "@deepseek-ai/dsh-commands";
import type { LlmResolvedModelInfo } from "@deepseek-ai/dsh-llm";
import {
  startMockLlmServer,
  type MockLlmServer,
} from "@deepseek-ai/dsh-llm-mock-server";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { OutboundMessage } from "@dsh-vscode/contract";
import type { Io } from "../src/io.js";
import { createRunner } from "../src/runner.js";
import { bootTree, type BootOptions } from "./boot.js";

let mock: MockLlmServer;
let persistenceRoot: string;
let contexts: Context[];

const IMAGE_REF: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${"1".repeat(64)}`),
  mediaType: "image/png",
  bytes: 1,
  width: 1,
  height: 1,
  name: "a.png",
};

const IMAGE_LIMITS = {
  maxImageBytes: 10,
  maxImagesPerMessage: 2,
  maxMessageImageBytes: 20,
  maxImagePixels: 100,
  maxImageDimension: 10,
  mediaTypes: ["image/png"] as const,
};

function capture(
  messages: OutboundMessage[],
  disconnectListeners?: Array<() => void>,
): Io {
  return {
    send(message) {
      messages.push(message);
    },
    onCommand() {},
    onDisconnect(listener) {
      disconnectListeners?.push(listener);
    },
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

async function boot(overrides: Partial<BootOptions> = {}): Promise<Context> {
  const ctx = await bootTree(options(overrides));
  contexts.push(ctx);
  return ctx;
}

async function imageBoot(
  saveImages: (
    inputs: readonly SaveImageAttachment[],
  ) => Promise<readonly ImageAttachmentRef[]>,
  modelInfo: Partial<LlmResolvedModelInfo> = {
    inputModalities: ["text", "image"],
  },
): Promise<Context> {
  const ctx = await boot();
  ctx.provide("attachments", {
    imageLimits: IMAGE_LIMITS,
    saveImages,
  } as unknown as AttachmentStore);
  const llm = ctx.get("llm");
  if (llm === undefined) throw new Error("llm was not mounted");
  const resolveModelInfo = llm.resolveModelInfo.bind(llm);
  llm.resolveModelInfo = async (...args) => ({
    ...(await resolveModelInfo(...args)),
    ...modelInfo,
  });
  return ctx;
}

function userMessages(
  session: Session,
): Extract<SessionEvent, { type: "user/message" }>[] {
  return session.events.filter(
    (event): event is Extract<SessionEvent, { type: "user/message" }> =>
      event.type === "user/message",
  );
}

function deferredImageSave(): {
  saveImages: (
    inputs: readonly SaveImageAttachment[],
  ) => Promise<readonly ImageAttachmentRef[]>;
  started: Promise<void>;
  release: () => void;
} {
  let markStarted: () => void = () => {};
  let release: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async saveImages() {
      markStarted();
      await blocked;
      return [IMAGE_REF];
    },
    started,
    release,
  };
}

async function installHoldingCommand(ctx: Context): Promise<{
  started: Promise<void>;
  signal: () => AbortSignal | undefined;
}> {
  await ctx.plugin(CommandRuntime);
  const commands = ctx.get("commands");
  if (commands === undefined) throw new Error("commands were not mounted");
  let activeSignal: AbortSignal | undefined;
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  commands.register({
    name: "hold",
    description: "Wait until cancellation",
    handler: ({ signal }) => {
      activeSignal = signal;
      markStarted();
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    },
  });
  return { started, signal: () => activeSignal };
}

describe("session controller", () => {
  beforeAll(async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    mock = await startMockLlmServer({
      sequence: ["success"],
      repeatLast: true,
      successText: "hello from the mock",
    });
  });

  beforeEach(async () => {
    persistenceRoot = await mkdtemp(join(tmpdir(), "dsh-vscode-sessions-"));
    contexts = [];
  });

  afterEach(async () => {
    for (const ctx of contexts.reverse()) {
      await ctx.fiber.dispose();
    }
    await rm(persistenceRoot, { recursive: true, force: true });
  });

  afterAll(async () => {
    await mock.close();
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("lists the live workspace session with durable history available", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(await boot(), capture(messages));

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

  it("lists multiple workspace sessions and excludes a foreign cwd", async () => {
    const originalCwd = process.cwd();
    const foreignCwd = await mkdtemp(join(tmpdir(), "dsh-vscode-foreign-"));
    const foreignMessages: OutboundMessage[] = [];
    try {
      process.chdir(foreignCwd);
      const foreign = await createRunner(
        await boot(),
        capture(foreignMessages),
      );
      foreign.submit("foreign chat");
      await waitFor(
        () =>
          foreignMessages.some(
            (message) => message.kind === "status" && message.state === "idle",
          ),
        60_000,
      );
    } finally {
      process.chdir(originalCwd);
    }

    const messages: OutboundMessage[] = [];
    const runner = await createRunner(await boot(), capture(messages));
    runner.submit("first local chat");
    await waitFor(
      () =>
        messages.some(
          (message) => message.kind === "status" && message.state === "idle",
        ),
      60_000,
    );
    runner.newSession();
    await waitFor(
      () => messages.filter((message) => message.kind === "session").length >= 2,
    );
    runner.submit("second local chat");
    await waitFor(
      () =>
        messages.filter(
          (message) => message.kind === "status" && message.state === "idle",
        ).length >= 2,
      60_000,
    );
    runner.listSessions();

    await waitFor(() => messages.some((message) => message.kind === "sessions"));
    const list = messages.filter((message) => message.kind === "sessions").at(-1);
    expect(list?.kind).toBe("sessions");
    if (list?.kind === "sessions") {
      expect(list.items).toHaveLength(2);
      expect(list.items.every((item) => item.cwd === originalCwd)).toBe(true);
      expect(list.items.map((item) => item.title)).toEqual(
        expect.arrayContaining(["first local chat", "second local chat"]),
      );
    }
    await rm(foreignCwd, { recursive: true, force: true });
  }, 120_000);

  it("falls back to the live session when durable history is unavailable", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(
      await boot({ persistenceRoot: undefined }),
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

  it("falls back to the live session when durable listing rejects", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await boot();
    const runner = await createRunner(ctx, capture(messages));
    const persistence = ctx.get("sessionPersistence");
    if (persistence === undefined) throw new Error("persistence was not mounted");
    persistence.list = async () => {
      throw new Error("list exploded");
    };

    runner.listSessions();

    await waitFor(() => messages.some((message) => message.kind === "sessions"));
    const list = messages.find((message) => message.kind === "sessions");
    expect(list?.kind).toBe("sessions");
    if (list?.kind === "sessions") {
      expect(list.available).toBe(false);
      expect(list.items).toHaveLength(1);
    }
  });

  it("executes a real slash command with DSH-owned lifecycle events", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await boot();
    await ctx.plugin(CommandRuntime);
    const commands = ctx.get("commands");
    if (commands === undefined) throw new Error("commands were not mounted");
    commands.register({
      name: "compact",
      description: "Compact context",
      handler: () => ({ kind: "success" }),
    });
    const runner = await createRunner(ctx, capture(messages));
    const session = ctx.get("agents")?.roots()[0]?.session;
    if (session === undefined) throw new Error("live session was not mounted");

    runner.executeSlashCommand("/compact");

    await waitFor(() =>
      messages.some(
        (message) => message.kind === "status" && message.state === "idle",
      ),
    );
    const eventTypes = session.events.map((event) => event.type);
    expect(eventTypes).toContain("command/run");
    expect(eventTypes).toContain("command/done");
    expect(eventTypes.indexOf("command/run")).toBeLessThan(
      eventTypes.indexOf("command/done"),
    );
    expect(eventTypes).not.toContain("user/message");
  });

  it("reports a real command handler failure without command-rejected", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await boot();
    await ctx.plugin(CommandRuntime);
    const commands = ctx.get("commands");
    if (commands === undefined) throw new Error("commands were not mounted");
    commands.register({
      name: "fail",
      description: "Fail after dispatch",
      handler: () => {
        throw new Error("command handler failed");
      },
    });
    const runner = await createRunner(ctx, capture(messages));

    runner.executeSlashCommand("/fail");

    await waitFor(() =>
      messages.some(
        (message) =>
          message.kind === "status" &&
          message.state === "error" &&
          message.detail === "command handler failed",
      ),
    );
    const status = messages.find(
      (message) =>
        message.kind === "status" &&
        message.state === "error" &&
        message.detail === "command handler failed",
    );
    expect(status?.kind === "status" ? status.code : "missing").toBeUndefined();
    const eventTypes = messages
      .filter((message) => message.kind === "event")
      .map((message) => message.event.type);
    expect(eventTypes).toEqual(
      expect.arrayContaining(["command/run", "command/done"]),
    );
  });

  it("delivers admitted command images through DSH's handler envelope", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await imageBoot(async () => [IMAGE_REF]);
    await ctx.plugin(CommandRuntime);
    const commands = ctx.get("commands");
    if (commands === undefined) throw new Error("commands were not mounted");
    let invocation: CommandInvocation | undefined;
    commands.register({
      name: "goal",
      description: "Set the goal",
      input: { hint: "<objective>", images: true },
      handler: (received) => {
        invocation = received;
        return { kind: "success" };
      },
    });
    const runner = await createRunner(ctx, capture(messages));

    runner.executeSlashCommand("/goal inspect", [
      { mediaType: "image/png", data: "AQ==", name: "a.png" },
    ]);

    await waitFor(() => invocation !== undefined);
    expect(invocation?.rawInput).toBe(" inspect");
    expect(invocation?.attachments).toEqual([
      { type: "image", attachment: IMAGE_REF },
    ]);
  });

  it("new session aborts an active slash command without stale rejection", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await boot();
    const holding = await installHoldingCommand(ctx);
    const runner = await createRunner(ctx, capture(messages));

    runner.executeSlashCommand("/hold");
    await holding.started;
    runner.newSession();

    await waitFor(
      () => messages.filter((message) => message.kind === "ready").length === 2,
    );
    expect(holding.signal()?.aborted).toBe(true);
    expect(
      messages.some(
        (message) =>
          message.kind === "status" && message.code === "command-rejected",
      ),
    ).toBe(false);
  });

  it("cancel emits idle only after DSH logs command completion", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await boot();
    const holding = await installHoldingCommand(ctx);
    const runner = await createRunner(ctx, capture(messages));

    runner.executeSlashCommand("/hold");
    await holding.started;
    runner.cancel();

    expect(holding.signal()?.aborted).toBe(true);
    await waitFor(() =>
      messages.some(
        (message) => message.kind === "status" && message.state === "idle",
      ),
    );
    const doneIndex = messages.findIndex(
      (message) =>
        message.kind === "event" && message.event.type === "command/done",
    );
    const idleIndex = messages.findIndex(
      (message) => message.kind === "status" && message.state === "idle",
    );
    expect(doneIndex).toBeGreaterThanOrEqual(0);
    expect(idleIndex).toBeGreaterThan(doneIndex);
    expect(
      messages.some(
        (message) =>
          message.kind === "status" && message.code === "command-rejected",
      ),
    ).toBe(false);
  });

  it("blocks outgoing command execution as soon as replacement is requested", async () => {
    const messages: OutboundMessage[] = [];
    const deferred = deferredImageSave();
    const ctx = await imageBoot(deferred.saveImages);
    const holding = await installHoldingCommand(ctx);
    const commands = ctx.get("commands");
    if (commands === undefined) throw new Error("commands were not mounted");
    let quickRan = false;
    commands.register({
      name: "quick",
      description: "Record execution",
      handler: () => {
        quickRan = true;
        return { kind: "success" };
      },
    });
    const runner = await createRunner(ctx, capture(messages));

    runner.submit("block replacement", {
      images: [{ mediaType: "image/png", data: "AQ==" }],
    });
    await deferred.started;
    runner.executeSlashCommand("/hold");
    await holding.started;
    runner.newSession();
    await waitFor(() =>
      messages.some(
        (message) =>
          message.kind === "event" && message.event.type === "command/done",
      ),
    );

    runner.executeSlashCommand("/quick");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(quickRan).toBe(false);
    expect(
      messages.some(
        (message) =>
          message.kind === "status" && message.code === "command-rejected",
      ),
    ).toBe(false);
    deferred.release();
    await waitFor(
      () => messages.filter((message) => message.kind === "ready").length === 2,
    );
  });

  it("resume aborts an active slash command before replacement", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await boot();
    const holding = await installHoldingCommand(ctx);
    const runner = await createRunner(ctx, capture(messages));
    const first = messages.find((message) => message.kind === "ready");
    if (first?.kind !== "ready") throw new Error("runner did not become ready");
    runner.newSession();
    await waitFor(
      () => messages.filter((message) => message.kind === "ready").length === 2,
    );

    runner.executeSlashCommand("/hold");
    await holding.started;
    runner.resume(first.sessionId);

    expect(holding.signal()?.aborted).toBe(true);
  });

  it("resumes the requested old session after a queued new session", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(await boot(), capture(messages));
    const first = messages.find((message) => message.kind === "ready");
    if (first?.kind !== "ready") throw new Error("runner did not become ready");
    runner.submit("persist queued resume target");
    await waitFor(() =>
      messages.some(
        (message) => message.kind === "status" && message.state === "idle",
      ),
    );

    runner.newSession();
    runner.resume(first.sessionId);

    await waitFor(
      () => messages.filter((message) => message.kind === "ready").length === 3,
    );
    const readyIds = messages
      .filter((message) => message.kind === "ready")
      .map((message) => message.sessionId);
    expect(readyIds.at(-1)).toBe(first.sessionId);
    expect(readyIds.at(-2)).not.toBe(first.sessionId);
  });

  it("restores command execution when cross-session resume fails", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await boot();
    await ctx.plugin(CommandRuntime);
    const commands = ctx.get("commands");
    if (commands === undefined) throw new Error("commands were not mounted");
    let ran = false;
    commands.register({
      name: "quick",
      description: "Record execution",
      handler: () => {
        ran = true;
        return { kind: "success" };
      },
    });
    const runner = await createRunner(ctx, capture(messages));

    runner.resume("missing-id");
    await waitFor(() =>
      messages.some(
        (message) => message.kind === "status" && message.state === "error",
      ),
    );
    runner.executeSlashCommand("/quick");

    await waitFor(() => ran);
    expect(ran).toBe(true);
  });

  it("disconnect aborts an active slash command", async () => {
    const disconnectListeners: Array<() => void> = [];
    const ctx = await boot();
    const holding = await installHoldingCommand(ctx);
    const runner = await createRunner(
      ctx,
      capture([], disconnectListeners),
    );

    runner.executeSlashCommand("/hold");
    await holding.started;
    for (const disconnect of disconnectListeners) disconnect();

    expect(holding.signal()?.aborted).toBe(true);
  });

  it("context disposal aborts an active slash command", async () => {
    const ctx = await boot();
    const holding = await installHoldingCommand(ctx);
    const runner = await createRunner(ctx, capture([]));

    runner.executeSlashCommand("/hold");
    await holding.started;
    await ctx.fiber.dispose();

    expect(holding.signal()?.aborted).toBe(true);
  });

  it("creates a different session and emits its empty history", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(await boot(), capture(messages));
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
    const latestReady = messages
      .filter((message) => message.kind === "ready")
      .at(-1);
    expect(
      latestReady?.kind === "ready"
        ? latestReady.permissions.current
        : undefined,
    ).toBe("workspace-write");
  });

  it("drains cancellation before flushing and disposing the old session", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await boot();
    const runner = await createRunner(ctx, capture(messages));
    const agent = ctx.get("agents")?.roots()[0];
    if (agent === undefined) throw new Error("live agent was not mounted");
    const originalCancel = agent.cancel.bind(agent);
    const originalWhenIdle = agent.whenIdle.bind(agent);
    let cancelObserved = false;
    let drainObserved = false;
    agent.cancel = (cause) => {
      cancelObserved = true;
      return originalCancel(cause);
    };
    agent.whenIdle = async () => {
      await originalWhenIdle();
      if (cancelObserved) drainObserved = true;
    };
    ctx.on("session/flush", (session) => {
      if (
        session.id === agent.session.id &&
        cancelObserved &&
        !drainObserved
      ) {
        throw new Error("old session flushed before cancellation drained");
      }
    });

    runner.newSession();

    await waitFor(
      () =>
        messages.filter((message) => message.kind === "ready").length >= 2 ||
        messages.some(
          (message) => message.kind === "status" && message.state === "error",
        ),
    );
    expect(
      messages.filter((message) => message.kind === "ready"),
    ).toHaveLength(2);
  });

  it("keeps the replacement live when old-handle disposal rejects", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await boot();
    const agents = ctx.get("agents");
    if (agents === undefined) throw new Error("agent registry was not mounted");
    const originalCreate = agents.create.bind(agents);
    let wrapNextHandle = true;
    agents.create = async (createOptions) => {
      const handle = await originalCreate(createOptions);
      if (wrapNextHandle) {
        wrapNextHandle = false;
        const originalDispose = handle.dispose.bind(handle);
        handle.dispose = async () => {
          await originalDispose();
          throw new Error("dispose exploded after teardown");
        };
      }
      return handle;
    };
    const runner = await createRunner(ctx, capture(messages));
    const initialReady = messages.find((message) => message.kind === "ready");
    if (initialReady?.kind !== "ready") {
      throw new Error("runner did not become ready");
    }

    runner.newSession();

    await waitFor(
      () =>
        messages.filter((message) => message.kind === "ready").length >= 2 &&
        messages.some(
          (message) =>
            message.kind === "status" &&
            message.state === "error" &&
            message.detail?.includes("dispose exploded") === true,
        ),
    );
    const replacementReady = messages
      .filter((message) => message.kind === "ready")
      .at(-1);
    if (replacementReady?.kind !== "ready") {
      throw new Error("replacement did not become ready");
    }
    expect(replacementReady.sessionId).not.toBe(initialReady.sessionId);

    runner.submit("replacement remains usable");
    await waitFor(
      () =>
        messages.some(
          (message) =>
            message.kind === "event" &&
            message.sessionId === replacementReady.sessionId &&
            message.event.type === "turn/end",
        ),
      60_000,
    );
  }, 120_000);

  it("resumes a flushed persisted session and emits its history", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(await boot(), capture(messages));
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

  it("re-emits the current session without replacing it", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(await boot(), capture(messages));
    const ready = messages.find((message) => message.kind === "ready");
    if (ready?.kind !== "ready") throw new Error("runner did not become ready");
    runner.submit("current history");
    await waitFor(
      () =>
        messages.some(
          (message) => message.kind === "status" && message.state === "idle",
        ),
      60_000,
    );
    const lifecycleStart = messages.length;

    runner.resume(ready.sessionId);

    await waitFor(
      () =>
        messages
          .slice(lifecycleStart)
          .filter((message) => message.kind === "ready").length === 1,
    );
    expect(
      messages
        .slice(lifecycleStart)
        .filter(
          (message) =>
            message.kind === "session" ||
            message.kind === "history" ||
            message.kind === "ready",
        )
        .map((message) => message.kind),
    ).toEqual(["session", "history", "ready"]);
    expect(
      messages
        .slice(lifecycleStart)
        .some(
          (message) => message.kind === "status" && message.state === "error",
        ),
    ).toBe(false);
  });

  it("rejects a missing session without replacing the current session", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(await boot(), capture(messages));
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

  it("updates the selected model and emits a catalog snapshot", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(await boot(), capture(messages));

    runner.selectModel("deepseek-official", "mock-model");

    await waitFor(() => messages.some((message) => message.kind === "catalog"));
    const catalog = messages.filter((message) => message.kind === "catalog").at(-1);
    expect(catalog?.kind).toBe("catalog");
    if (catalog?.kind === "catalog") {
      expect(catalog.current).toEqual({
        provider: "deepseek-official",
        model: "mock-model",
      });
      expect(catalog.models[0]?.contextWindow).toBe(128_000);
    }
  });

  it("keeps the selected model when an unknown model is rejected", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(await boot(), capture(messages));

    runner.selectModel("missing-provider", "missing-model");

    await waitFor(() =>
      messages.some(
        (message) => message.kind === "status" && message.state === "error",
      ),
    );
    const catalog = messages.filter((message) => message.kind === "catalog").at(-1);
    expect(catalog?.kind === "catalog" ? catalog.current : undefined).toEqual({
      provider: "deepseek-official",
      model: "mock-model",
    });

    runner.submit("still uses the configured model");
    await waitFor(
      () =>
        messages.some(
          (message) =>
            message.kind === "event" && message.event.type === "turn/end",
        ),
      60_000,
    );
  }, 120_000);

  it("reports unavailable permission presets and re-emits the current selection", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(await boot(), capture(messages));

    runner.selectPermission("read-only");

    await waitFor(() =>
      messages.some(
        (message) =>
          message.kind === "status" &&
          message.state === "error" &&
          message.detail?.includes("permission presets are not mounted") === true,
      ),
    );
    const permissions = messages
      .filter((message) => message.kind === "permissions")
      .at(-1);
    expect(permissions?.kind === "permissions" ? permissions.current : undefined).toBe(
      "workspace-write",
    );
  });

  it("keeps the user turn when submit picker preflight fails", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(await boot(), capture(messages));

    runner.submit("do not drop this", {
      provider: "missing-provider",
      model: "missing-model",
    });

    await waitFor(
      () =>
        messages.some(
          (message) =>
            message.kind === "event" && message.event.type === "turn/end",
        ),
      60_000,
    );
    expect(
      messages.some(
        (message) => message.kind === "status" && message.state === "error",
      ),
    ).toBe(true);
  }, 120_000);

  it("creates one mixed user message from text and admitted images", async () => {
    const messages: OutboundMessage[] = [];
    const saveImages = vi.fn(async () => [IMAGE_REF]);
    const ctx = await imageBoot(saveImages);
    const runner = await createRunner(ctx, capture(messages));
    const session = ctx.get("agents")?.roots()[0]?.session;
    if (session === undefined) throw new Error("live session was not mounted");

    runner.submit("look", {
      images: [{ mediaType: "image/png", data: "AQ==", name: "a.png" }],
    });

    await waitFor(() => userMessages(session).length === 1);
    expect(userMessages(session)[0]?.data.content).toEqual([
      { type: "text", text: "look" },
      { type: "image", attachment: IMAGE_REF },
    ]);
  });

  it("creates an image-only user message without an empty text block", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await imageBoot(async () => [IMAGE_REF]);
    const runner = await createRunner(ctx, capture(messages));
    const session = ctx.get("agents")?.roots()[0]?.session;
    if (session === undefined) throw new Error("live session was not mounted");

    runner.submit(" \n ", {
      images: [{ mediaType: "image/png", data: "AQ==" }],
    });

    await waitFor(() => userMessages(session).length === 1);
    expect(userMessages(session)[0]?.data.content).toEqual([
      { type: "image", attachment: IMAGE_REF },
    ]);
  });

  it("rejects the submit when image admission fails", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await imageBoot(async () => {
      throw new Error("image exceeds configured limit");
    });
    const runner = await createRunner(ctx, capture(messages));
    const agent = ctx.get("agents")?.roots()[0];
    if (agent === undefined) throw new Error("live agent was not mounted");
    const followup = vi.spyOn(agent, "followup");

    runner.submit("keep me", {
      images: [{ mediaType: "image/png", data: "AQ==" }],
    });

    await waitFor(() =>
      messages.some(
        (message) =>
          message.kind === "status" && message.code === "submit-rejected",
      ),
    );
    expect(followup).not.toHaveBeenCalled();
  });

  it("cancel aborts deferred admission without starting a turn", async () => {
    const messages: OutboundMessage[] = [];
    const deferred = deferredImageSave();
    const ctx = await imageBoot(deferred.saveImages);
    const runner = await createRunner(ctx, capture(messages));
    const agent = ctx.get("agents")?.roots()[0];
    if (agent === undefined) throw new Error("live agent was not mounted");
    const followup = vi.spyOn(agent, "followup");

    runner.submit("cancel this", {
      images: [{ mediaType: "image/png", data: "AQ==" }],
    });
    await deferred.started;
    runner.cancel();
    deferred.release();

    await waitFor(() =>
      messages.some(
        (message) =>
          message.kind === "status" && message.code === "submit-rejected",
      ),
    );
    expect(followup).not.toHaveBeenCalled();
    expect(
      agent.session.events.some((event) => event.type === "turn/start"),
    ).toBe(false);
  });

  it("new session aborts deferred admission before queued replacement", async () => {
    const messages: OutboundMessage[] = [];
    const deferred = deferredImageSave();
    const ctx = await imageBoot(deferred.saveImages);
    const runner = await createRunner(ctx, capture(messages));
    const agent = ctx.get("agents")?.roots()[0];
    if (agent === undefined) throw new Error("live agent was not mounted");
    const followup = vi.spyOn(agent, "followup");

    runner.submit("replace this session", {
      images: [{ mediaType: "image/png", data: "AQ==" }],
    });
    await deferred.started;
    runner.newSession();
    deferred.release();

    await waitFor(
      () => messages.filter((message) => message.kind === "ready").length === 2,
    );
    expect(
      messages.some(
        (message) =>
          message.kind === "status" && message.code === "submit-rejected",
      ),
    ).toBe(true);
    expect(followup).not.toHaveBeenCalled();
    expect(
      agent.session.events.some((event) => event.type === "turn/start"),
    ).toBe(false);
  });

  it("resume aborts deferred admission before queued replacement", async () => {
    const messages: OutboundMessage[] = [];
    const deferred = deferredImageSave();
    const ctx = await imageBoot(deferred.saveImages);
    const runner = await createRunner(ctx, capture(messages));
    const firstReady = messages.find((message) => message.kind === "ready");
    if (firstReady?.kind !== "ready") {
      throw new Error("runner did not become ready");
    }
    runner.submit("persist resume target");
    await waitFor(() =>
      messages.some(
        (message) => message.kind === "status" && message.state === "idle",
      ),
    );
    runner.newSession();
    await waitFor(
      () => messages.filter((message) => message.kind === "ready").length === 2,
    );
    const agent = ctx.get("agents")?.roots()[0];
    if (agent === undefined) throw new Error("replacement agent was not mounted");
    const followup = vi.spyOn(agent, "followup");

    runner.submit("resume away from this", {
      images: [{ mediaType: "image/png", data: "AQ==" }],
    });
    await deferred.started;
    runner.resume(firstReady.sessionId);
    deferred.release();

    await waitFor(
      () => messages.filter((message) => message.kind === "ready").length === 3,
    );
    expect(
      messages.some(
        (message) =>
          message.kind === "status" && message.code === "submit-rejected",
      ),
    ).toBe(true);
    expect(followup).not.toHaveBeenCalled();
    expect(
      agent.session.events.some((event) => event.type === "turn/start"),
    ).toBe(false);
  });

  it("disconnect aborts deferred admission without starting a turn", async () => {
    const messages: OutboundMessage[] = [];
    const disconnectListeners: Array<() => void> = [];
    const deferred = deferredImageSave();
    const ctx = await imageBoot(deferred.saveImages);
    const runner = await createRunner(
      ctx,
      capture(messages, disconnectListeners),
    );
    const agent = ctx.get("agents")?.roots()[0];
    if (agent === undefined) throw new Error("live agent was not mounted");
    const followup = vi.spyOn(agent, "followup");

    runner.submit("disconnect this", {
      images: [{ mediaType: "image/png", data: "AQ==" }],
    });
    await deferred.started;
    for (const disconnect of disconnectListeners) disconnect();
    deferred.release();

    await waitFor(() =>
      messages.some(
        (message) =>
          message.kind === "status" && message.code === "submit-rejected",
      ),
    );
    expect(followup).not.toHaveBeenCalled();
    expect(
      agent.session.events.some((event) => event.type === "turn/start"),
    ).toBe(false);
  });

  it("emits next-request context after a completed turn", async () => {
    const messages: OutboundMessage[] = [];
    const runner = await createRunner(await boot(), capture(messages));

    runner.submit("measure this turn", {
      provider: "deepseek-official",
      model: "mock-model",
    });

    await waitFor(
      () =>
        messages.some(
          (message) => message.kind === "status" && message.state === "idle",
        ),
      60_000,
    );
    const context = messages.filter((message) => message.kind === "context").at(-1);
    expect(context?.kind).toBe("context");
    if (context?.kind === "context") {
      expect(context.window).toBe(128_000);
      expect(context.used).toBeGreaterThanOrEqual(0);
    }
  }, 120_000);

  it("rejects a persisted session from another cwd without replacing the current session", async () => {
    const originalCwd = process.cwd();
    const foreignCwd = await mkdtemp(join(tmpdir(), "dsh-vscode-foreign-"));
    const messages: OutboundMessage[] = [];
    try {
      process.chdir(foreignCwd);
      const runner = await createRunner(await boot(), capture(messages));
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

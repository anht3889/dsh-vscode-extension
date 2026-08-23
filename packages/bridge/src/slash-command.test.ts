import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import {
  AttachmentId,
  type AttachmentStore,
  type ImageAttachmentRef,
} from "@deepseek-ai/dsh-attachment";
import type {
  CommandDescriptor,
  CommandExecution,
} from "@deepseek-ai/dsh-commands";
import type { OutboundMessage } from "@dsh-vscode/contract";
import { describe, expect, it, vi } from "vitest";
import { createSlashCommandExecutor } from "./slash-command.js";

const IMAGE = {
  mediaType: "image/png" as const,
  data: "AQ==",
  name: "a.png",
};

const IMAGE_REF: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${"1".repeat(64)}`),
  mediaType: "image/png",
  bytes: 1,
  width: 1,
  height: 1,
  name: "a.png",
};

const AGENT = {
  options: { provider: "test-provider", model: "test-model" },
  session: {
    header: { cwd: "/workspace" },
    requestHeader: () => undefined,
  },
} as unknown as Agent;

interface CommandService {
  list(agent: Agent): readonly CommandDescriptor[];
  execute(
    agent: Agent,
    line: string,
    images: readonly typeof IMAGE[],
    signal: AbortSignal,
  ): Promise<CommandExecution | undefined>;
}

interface Services {
  commands?: CommandService;
  attachments?: AttachmentStore;
  llm?: {
    resolveModelInfo(
      provider: string,
      model: string,
      signal?: AbortSignal,
    ): Promise<{ inputModalities: readonly ("text" | "image")[] }>;
  };
}

function context(services: Services): Context {
  return {
    get(name: keyof Services) {
      return services[name];
    },
  } as unknown as Context;
}

function commands(
  descriptors: readonly CommandDescriptor[],
  execute: CommandService["execute"] = async () => ({
    commandId: "cmd-test-1" as never,
    result: { kind: "success" },
  }),
): CommandService {
  return {
    list: vi.fn(() => descriptors),
    execute: vi.fn(execute),
  };
}

function messages(send: ReturnType<typeof vi.fn>): OutboundMessage[] {
  return send.mock.calls.map(([message]) => message as OutboundMessage);
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createSlashCommandExecutor", () => {
  it("executes a listed bare command against the current agent", async () => {
    const service = commands([
      { name: "compact", description: "Compact context" },
    ]);
    const send = vi.fn();
    const executor = createSlashCommandExecutor(
      context({ commands: service }),
      () => AGENT,
      send,
    );

    executor.execute("  /compact  ");
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    expect(service.list).toHaveBeenCalledWith(AGENT);
    expect(service.execute).toHaveBeenCalledWith(
      AGENT,
      "/compact",
      [],
      expect.any(AbortSignal),
    );
    expect(messages(send)).toEqual([{ kind: "status", state: "idle" }]);
  });

  it("preserves the complete trimmed input command line", async () => {
    const service = commands([
      {
        name: "goal",
        description: "Set the goal",
        input: { hint: "<objective>" },
      },
    ]);
    const executor = createSlashCommandExecutor(
      context({ commands: service }),
      () => AGENT,
      vi.fn(),
    );

    executor.execute(" \n/goal ship it\t ");
    await vi.waitFor(() => expect(service.execute).toHaveBeenCalledOnce());

    expect(service.execute).toHaveBeenCalledWith(
      AGENT,
      "/goal ship it",
      [],
      expect.any(AbortSignal),
    );
  });

  it("rejects an unknown lowercase command name before execution", async () => {
    const service = commands([
      { name: "compact", description: "Compact context" },
    ]);
    const send = vi.fn();
    const executor = createSlashCommandExecutor(
      context({ commands: service }),
      () => AGENT,
      send,
    );

    executor.execute("/missing");
    await settled();

    expect(service.execute).not.toHaveBeenCalled();
    expect(messages(send)).toEqual([
      {
        kind: "status",
        state: "error",
        code: "command-rejected",
        detail: 'unknown slash command "/missing"',
      },
    ]);
  });

  it("rejects execution when the command service is unavailable", async () => {
    const send = vi.fn();
    const executor = createSlashCommandExecutor(
      context({}),
      () => AGENT,
      send,
    );

    executor.execute("/compact");
    await settled();

    expect(messages(send)).toEqual([
      {
        kind: "status",
        state: "error",
        code: "command-rejected",
        detail: "commands are not mounted",
      },
    ]);
  });

  it("preflights images and forwards the dependency-free encoded envelope", async () => {
    const service = commands([
      {
        name: "goal",
        description: "Set the goal",
        input: { hint: "<objective>", images: true },
      },
    ]);
    const saveImages = vi.fn(async () => [IMAGE_REF]);
    const executor = createSlashCommandExecutor(
      context({
        commands: service,
        attachments: {
          imageLimits: {
            maxImageBytes: 10,
            maxImagesPerMessage: 2,
            maxMessageImageBytes: 20,
            maxImagePixels: 100,
            maxImageDimension: 10,
            mediaTypes: ["image/png"],
          },
          saveImages,
        } as unknown as AttachmentStore,
        llm: {
          async resolveModelInfo() {
            return { inputModalities: ["text", "image"] };
          },
        },
      }),
      () => AGENT,
      vi.fn(),
    );

    executor.execute("/goal inspect", [IMAGE]);
    await vi.waitFor(() => expect(service.execute).toHaveBeenCalledOnce());

    expect(saveImages).toHaveBeenCalledOnce();
    expect(service.execute).toHaveBeenCalledWith(
      AGENT,
      "/goal inspect",
      [IMAGE],
      expect.any(AbortSignal),
    );
  });

  it("rejects images for a command that does not declare image input", async () => {
    const service = commands([
      {
        name: "goal",
        description: "Set the goal",
        input: { hint: "<objective>" },
      },
    ]);
    const send = vi.fn();
    const executor = createSlashCommandExecutor(
      context({ commands: service }),
      () => AGENT,
      send,
    );

    executor.execute("/goal inspect", [IMAGE]);
    await settled();

    expect(service.execute).not.toHaveBeenCalled();
    expect(messages(send)[0]).toMatchObject({
      kind: "status",
      state: "error",
      code: "command-rejected",
      detail: "/goal does not accept image attachments",
    });
  });

  it("rejects malformed images before command execution", async () => {
    const service = commands([
      {
        name: "goal",
        description: "Set the goal",
        input: { hint: "<objective>", images: true },
      },
    ]);
    const send = vi.fn();
    const executor = createSlashCommandExecutor(
      context({ commands: service }),
      () => AGENT,
      send,
    );

    executor.execute("/goal inspect", [{ ...IMAGE, data: "not-base64" }]);
    await settled();

    expect(service.execute).not.toHaveBeenCalled();
    expect(messages(send)[0]).toMatchObject({
      kind: "status",
      state: "error",
      code: "command-rejected",
      detail: "image data must be canonical base64",
    });
  });

  it("rejects a second command while one execution is active", async () => {
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = commands(
      [
        { name: "compact", description: "Compact context" },
        { name: "status", description: "Show status" },
      ],
      async () => {
        await blocked;
        return {
          commandId: "cmd-test-1" as never,
          result: { kind: "success" },
        };
      },
    );
    const send = vi.fn();
    const executor = createSlashCommandExecutor(
      context({ commands: service }),
      () => AGENT,
      send,
    );

    executor.execute("/compact");
    await vi.waitFor(() => expect(service.execute).toHaveBeenCalledOnce());
    executor.execute("/status");
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    expect(messages(send)[0]).toMatchObject({
      kind: "status",
      state: "error",
      code: "command-rejected",
    });
    expect(service.execute).toHaveBeenCalledOnce();
    release();
  });

  it("cancel emits idle without command-rejected after execution settles", async () => {
    let signal: AbortSignal | undefined;
    const send = vi.fn();
    const service = commands(
      [{ name: "compact", description: "Compact context" }],
      async (_agent, _line, _images, activeSignal) => {
        signal = activeSignal;
        await new Promise<void>((_resolve, reject) => {
          activeSignal.addEventListener(
            "abort",
            () => reject(activeSignal.reason),
            { once: true },
          );
        });
        return undefined;
      },
    );
    const executor = createSlashCommandExecutor(
      context({ commands: service }),
      () => AGENT,
      send,
    );

    executor.execute("/compact");
    await vi.waitFor(() => expect(signal).toBeDefined());
    executor.cancel();

    expect(signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(messages(send)).toEqual([{ kind: "status", state: "idle" }]);
  });

  it("reports a DSH runtime rejection without command-rejected", async () => {
    const service = commands(
      [{ name: "compact", description: "Compact context" }],
      async () => {
        throw new Error("handler exploded");
      },
    );
    const send = vi.fn();
    const executor = createSlashCommandExecutor(
      context({ commands: service }),
      () => AGENT,
      send,
    );

    executor.execute("/compact");
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    expect(messages(send)).toEqual([
      { kind: "status", state: "error", detail: "handler exploded" },
    ]);
  });

  it("reports a DSH error result without command-rejected", async () => {
    const service = commands(
      [{ name: "compact", description: "Compact context" }],
      async () => ({
        commandId: "cmd-test-1" as never,
        result: { kind: "error", text: "cannot compact now" },
      }),
    );
    const send = vi.fn();
    const executor = createSlashCommandExecutor(
      context({ commands: service }),
      () => AGENT,
      send,
    );

    executor.execute("/compact");
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    expect(messages(send)).toEqual([
      { kind: "status", state: "error", detail: "cannot compact now" },
    ]);
  });

  it("rejects a command removed after listing", async () => {
    const service = commands(
      [{ name: "compact", description: "Compact context" }],
      async () => undefined,
    );
    const send = vi.fn();
    const executor = createSlashCommandExecutor(
      context({ commands: service }),
      () => AGENT,
      send,
    );

    executor.execute("/compact");
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    expect(messages(send)).toEqual([
      {
        kind: "status",
        state: "error",
        code: "command-rejected",
        detail: 'slash command "/compact" is no longer available',
      },
    ]);
  });

  it("rejects malformed command grammar before execution", async () => {
    const service = commands([
      { name: "compact", description: "Compact context" },
    ]);
    const send = vi.fn();
    const executor = createSlashCommandExecutor(
      context({ commands: service }),
      () => AGENT,
      send,
    );

    executor.execute("/Compact");
    await settled();

    expect(service.execute).not.toHaveBeenCalled();
    expect(messages(send)).toEqual([
      {
        kind: "status",
        state: "error",
        code: "command-rejected",
        detail: 'invalid slash command "/Compact"',
      },
    ]);
  });

  it("execute after dispose is a silent no-run and no-send", async () => {
    const service = commands([
      { name: "compact", description: "Compact context" },
    ]);
    const send = vi.fn();
    const executor = createSlashCommandExecutor(
      context({ commands: service }),
      () => AGENT,
      send,
    );

    executor.dispose();
    executor.execute("/compact");
    await settled();

    expect(service.execute).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("dispose aborts and suppresses settlement from the retired executor", async () => {
    let signal: AbortSignal | undefined;
    const service = commands(
      [{ name: "compact", description: "Compact context" }],
      async (_agent, _line, _images, activeSignal) => {
        signal = activeSignal;
        await new Promise<void>((_resolve, reject) => {
          activeSignal.addEventListener(
            "abort",
            () => reject(activeSignal.reason),
            { once: true },
          );
        });
        return undefined;
      },
    );
    const send = vi.fn();
    const executor = createSlashCommandExecutor(
      context({ commands: service }),
      () => AGENT,
      send,
    );

    executor.execute("/compact");
    await vi.waitFor(() => expect(signal).toBeDefined());
    executor.dispose();
    await settled();

    expect(signal?.aborted).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});

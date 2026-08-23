import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { CommandRuntime } from "@deepseek-ai/dsh-commands";
import type { EncodedImageAttachment } from "@dsh-vscode/contract";
import type { OutboundMessage } from "@dsh-vscode/contract";
import { admitImages } from "./image-admission.js";

/** Owns at most one slash-command admission and execution. */
export interface SlashCommandExecutor {
  /** Validate, admit, and execute one complete slash-command line. */
  execute(
    line: string,
    images?: readonly EncodedImageAttachment[],
  ): void;
  /** Abort the active admission or command handler. */
  cancel(): void;
  /** Abort active work and suppress settlement from this retired executor. */
  dispose(): void;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Create the bridge command executor for the current retained Agent.
 *
 * The installed command runtime accepts encoded image envelopes and performs
 * its own authoritative conversion to handler image blocks. The bridge first
 * uses its shared admission path so malformed, unavailable, or model-ineligible
 * images reject before DSH opens a command lifecycle.
 *
 * @param ctx - bridge context carrying optional command and image services.
 * @param currentAgent - resolves the current live Agent when execution starts.
 * @param send - emits command status messages to the extension.
 * @returns a single-flight cancellable command executor.
 */
export function createSlashCommandExecutor(
  ctx: Context,
  currentAgent: () => Agent,
  send: (message: OutboundMessage) => void,
): SlashCommandExecutor {
  let active: AbortController | undefined;
  let disposed = false;

  const reject = (error: unknown): void => {
    send({
      kind: "status",
      state: "error",
      code: "command-rejected",
      detail: detail(error),
    });
  };

  const fail = (error: unknown): void => {
    send({
      kind: "status",
      state: "error",
      detail: detail(error),
    });
  };

  const execute = (
    line: string,
    images: readonly EncodedImageAttachment[] = [],
  ): void => {
    if (disposed) return;
    if (active !== undefined) {
      reject(new Error("another slash command is already running"));
      return;
    }

    const controller = new AbortController();
    active = controller;
    void (async () => {
      const normalized = line.trim();
      let commands: CommandRuntime;
      let name: string;
      let agent: Agent;
      try {
        const commandService = ctx.get("commands");
        if (commandService === undefined) {
          throw new Error("commands are not mounted");
        }
        commands = commandService;

        const match = /^\/([a-z][a-z0-9_-]*)(?:\s|$)/.exec(normalized);
        const parsedName = match?.[1];
        if (parsedName === undefined) {
          throw new Error(`invalid slash command "${normalized}"`);
        }
        name = parsedName;

        agent = currentAgent();
        const descriptor = commands
          .list(agent)
          .find((item) => item.name === name);
        if (descriptor === undefined) {
          throw new Error(`unknown slash command "/${name}"`);
        }
        if (images.length > 0) {
          if (descriptor.input?.images !== true) {
            throw new Error(`/${name} does not accept image attachments`);
          }
          await admitImages(ctx, agent, images, controller.signal);
        }
        controller.signal.throwIfAborted();
      } catch (error) {
        if (active === controller && !disposed) {
          if (controller.signal.aborted) {
            send({ kind: "status", state: "idle" });
          } else {
            reject(error);
          }
        }
        return;
      }

      let execution: Awaited<ReturnType<typeof commands.execute>>;
      try {
        execution = await commands.execute(
          agent,
          normalized,
          images,
          controller.signal,
        );
      } catch (error) {
        if (active === controller && !disposed) {
          if (controller.signal.aborted) {
            send({ kind: "status", state: "idle" });
          } else {
            fail(error);
          }
        }
        return;
      }
      if (active !== controller || disposed) return;
      if (execution === undefined) {
        reject(new Error(`slash command "/${name}" is no longer available`));
        return;
      }
      if (execution.result.kind === "error") {
        fail(new Error(execution.result.text));
        return;
      }
      send({ kind: "status", state: "idle" });
    })()
      .finally(() => {
        if (active === controller) active = undefined;
      });
  };

  const cancel = (): void => {
    active?.abort(new Error("slash command cancelled"));
  };

  const dispose = (): void => {
    disposed = true;
    const retired = active;
    active = undefined;
    retired?.abort(new Error("slash command executor disposed"));
  };

  return { execute, cancel, dispose };
}

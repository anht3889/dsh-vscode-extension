import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import { createStdio } from "./io.js";
import { createRunner } from "./runner.js";
import { createUserQuestionProvider } from "./user-questions.js";
import { dispatchCommand } from "./commands.js";

export const name = "vscode-runner";

/**
 * Core services required before the retained runner can be created and the
 * command loop can start. `appExit` is the launcher-provided exit request; the
 * plugin reads it at exit time (it is NOT required to create the runner).
 */
export const inject = [
  "agents",
  "agentDefaultModel",
  "sessions",
  "userQuestions",
  "appExit",
] as const;

export const Config = z.object({});

/**
 * Mount the bridge: create the stdio `Io`, register the user-questions provider,
 * build the retained runner, and drive inbound commands through the dispatcher.
 *
 * Process exit is owned here (via `ctx.appExit`); the retained runner itself
 * merely returns and never exits. The `io.send` error path mirrors plan line 703:
 * report an `error` status and request exit — gated on `appExit` being present
 * so unit tests that mount without a launcher do not hard-exit the process.
 */
export function apply(ctx: Context, _config: unknown): void {
  const io = createStdio();

  const provider = createUserQuestionProvider(io);
  ctx.userQuestions.registerProvider(provider);

  // The editor closing stdin is the only signal that its extension host is gone.
  // Without it the process outlives every editor that ever spawned it.
  io.onDisconnect(() => requestExit(ctx, 0));

  createRunner(ctx, io)
    .then((runner) => {
      io.onCommand((msg) => dispatchCommand(ctx, msg, { runner, provider }));
    })
    .catch((e: unknown) => {
      const detail = e instanceof Error ? e.message : String(e);
      io.send({ kind: "status", state: "error", detail });
      requestExit(ctx, 1);
    });
}

/** Request process exit through the launcher, tolerating its absence so unit
 *  tests that mount without one do not hard-exit the test runner. */
function requestExit(ctx: Context, code: number): void {
  const exit = ctx.get("appExit") as ((code: number) => void) | undefined;
  if (exit !== undefined) exit(code);
}

import type { Context } from "@deepseek-ai/cordis";
import type { AskUserQuestionAnswer } from "@deepseek-ai/dsh-user-questions";
import type { AskAnswerWire, InboundMessage } from "@dsh-vscode/contract";
import type { RetainedRunner } from "./runner.js";
import type { ResolvableUserQuestionProvider } from "./user-questions.js";

/** The front-controller hooks `dispatchCommand` routes inbound messages onto. */
export interface CommandHooks {
  /** The retained runner's submit/cancel surface. */
  runner: RetainedRunner;
  /** The user-questions provider that settles a pending ask by id. */
  provider: ResolvableUserQuestionProvider;
}

/**
 * `AskAnswerWire` (`{ answers: { id; selected: string[]; custom? }[] }`) is
 * byte-identical to the provider's `AskUserQuestionAnswer`; the mapping is a
 * structural passthrough. It is re-declared here (rather than cast) so the
 * dispatcher stays honest about what it forwards.
 */
function wireToAnswer(wire: AskAnswerWire): AskUserQuestionAnswer {
  return {
    answers: wire.answers.map((a) => ({
      id: a.id,
      selected: a.selected,
      ...(a.custom !== undefined ? { custom: a.custom } : {}),
    })),
  };
}

/**
 * Map one inbound extension command onto the runner and the user-questions
 * provider.
 *
 * - `submit` → `runner.submit(text)` (queues a follow-up turn on the retained agent).
 * - `cancel` → `runner.cancel()` (user-initiated abort of the active turn).
 * - `answer` → `provider.resolve(askId, wireToAnswer(answered))`.
 * - `exit`   → no-op here: runner disposal/session finalization and the actual
 *              process exit are owned by the plugin `apply` seam, which reads
 *              `ctx.appExit` and never hard-exits under test.
 * - `resume` → documented no-op seam: the retained runner always starts fresh;
 *              session reload from a persisted `sessionId` is out of scope for
 *              Task 5 and would be added as a runner capability here.
 */
export function dispatchCommand(
  ctx: Context,
  msg: InboundMessage,
  hooks: CommandHooks,
): void {
  switch (msg.kind) {
    case "submit":
      hooks.runner.submit(msg.text);
      return;
    case "cancel":
      hooks.runner.cancel();
      return;
    case "answer":
      hooks.provider.resolve(msg.askId, wireToAnswer(msg.answered));
      return;
    case "exit":
    case "resume":
      // See doc comment: exit is owned by `apply`; resume is a seam.
      return;
    default: {
      const _exhaustive: never = msg;
      void _exhaustive;
      return;
    }
  }
}

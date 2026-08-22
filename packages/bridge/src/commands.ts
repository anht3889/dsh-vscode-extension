import type { Context } from "@deepseek-ai/cordis";
import type { AskUserQuestionAnswer } from "@deepseek-ai/dsh-user-questions";
import type { AskAnswerWire, InboundMessage } from "@dsh-vscode/contract";
import type { SessionController } from "./runner.js";
import type { ResolvableUserQuestionProvider } from "./user-questions.js";

/** The front-controller hooks `dispatchCommand` routes inbound messages onto. */
export interface CommandHooks {
  /** Session command surface the dispatcher forwards protocol v3 messages onto. */
  runner: SessionController;
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
 * - `submit` → `runner.submit(text, opts)` (queues a follow-up turn on the retained agent).
 * - `cancel` → `runner.cancel()` (user-initiated abort of the active turn).
 * - `answer` → `provider.resolve(askId, wireToAnswer(answered))`.
 * - session lifecycle commands → the matching {@link SessionController} method.
 * - `exit`   → no-op here: runner disposal/session finalization and the actual
 *              process exit are owned by the plugin `apply` seam, which reads
 *              `ctx.appExit` and never hard-exits under test.
 */
export function dispatchCommand(
  ctx: Context,
  msg: InboundMessage,
  hooks: CommandHooks,
): void {
  switch (msg.kind) {
    case "submit":
      hooks.runner.submit(msg.text, {
        ...(msg.provider !== undefined ? { provider: msg.provider } : {}),
        ...(msg.model !== undefined ? { model: msg.model } : {}),
        ...(msg.permission !== undefined ? { permission: msg.permission } : {}),
        ...(msg.images !== undefined ? { images: msg.images } : {}),
      });
      return;
    case "cancel":
      hooks.runner.cancel();
      return;
    case "answer":
      hooks.provider.resolve(msg.askId, wireToAnswer(msg.answered));
      return;
    case "listSessions":
      hooks.runner.listSessions();
      return;
    case "newSession":
      hooks.runner.newSession();
      return;
    case "resume":
      hooks.runner.resume(msg.sessionId);
      return;
    case "selectModel":
      hooks.runner.selectModel(msg.provider, msg.model);
      return;
    case "selectPermission":
      hooks.runner.selectPermission(msg.preset);
      return;
    case "listFileReferences":
      hooks.runner.listFileReferences(msg.query, msg.requestId);
      return;
    case "exit":
      return;
    default: {
      const _exhaustive: never = msg;
      void _exhaustive;
    }
  }
}

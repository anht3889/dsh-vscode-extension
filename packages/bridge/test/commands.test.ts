import { describe, it, expect, vi } from "vitest";
import type { AskAnswerWire, InboundMessage } from "@dsh-vscode/contract";
import { dispatchCommand } from "../src/commands.js";
import type { CommandHooks } from "../src/commands.js";

// The command dispatcher maps inbound extension messages onto a small set of
// front-controller hooks: the retained runner's submit/cancel and the
// user-questions provider's resolve. `ctx` is passed through for the exit
// seam but is deliberately inert for the pure-mapping cases below.
function hooks() {
  return {
    runner: {
      submit: vi.fn<(text: string) => void>(),
      cancel: vi.fn<() => void>(),
    },
    provider: {
      resolve: vi.fn<(askId: string, answered: unknown) => void>(),
    },
  } as unknown as CommandHooks;
}

const inertCtx = { get: vi.fn<() => undefined>(() => undefined) } as never;

describe("dispatchCommand", () => {
  it("maps a submit command to runner.submit(text)", () => {
    const h = hooks();
    const msg: InboundMessage = { kind: "submit", text: "hi" };
    dispatchCommand(inertCtx, msg, h);
    expect(h.runner.submit).toHaveBeenCalledWith("hi");
    expect(h.runner.cancel).not.toHaveBeenCalled();
    expect(h.provider.resolve).not.toHaveBeenCalled();
  });

  it("maps a cancel command to runner.cancel()", () => {
    const h = hooks();
    const msg: InboundMessage = { kind: "cancel", cause: "user" };
    dispatchCommand(inertCtx, msg, h);
    expect(h.runner.cancel).toHaveBeenCalledOnce();
    expect(h.runner.submit).not.toHaveBeenCalled();
  });

  it("maps an answer command to provider.resolve(askId, answered) passthrough", () => {
    const h = hooks();
    const answered: AskAnswerWire = {
      answers: [{ id: "q1", selected: ["yes"], custom: "other" }],
    };
    const msg: InboundMessage = { kind: "answer", askId: "ask-1", answered };
    dispatchCommand(inertCtx, msg, h);
    // Wire AskAnswerWire is byte-identical to AskUserQuestionAnswer, so the
    // mapping is a passthrough: the provider receives the same answers array.
    expect(h.provider.resolve).toHaveBeenCalledWith("ask-1", answered);
  });
});

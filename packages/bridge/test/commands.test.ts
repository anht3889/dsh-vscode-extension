import { describe, it, expect, vi } from "vitest";
import type { AskAnswerWire, InboundMessage } from "@dsh-vscode/contract";
import type {
  AskUserQuestionAnswer,
  AskUserQuestionRequest,
} from "@deepseek-ai/dsh-user-questions";
import { dispatchCommand } from "../src/commands.js";

// The command dispatcher maps inbound extension messages onto a small set of
// front-controller hooks: the retained runner's submit/cancel and the
// user-questions provider's resolve. `ctx` is passed through for the exit
// seam but is deliberately inert for the pure-mapping cases below. The hooks are
// mocks; their inferred `Mock` types are structurally assignable to `CommandHooks`.
function hooks() {
  return {
    runner: {
      submit: vi.fn(),
      cancel: vi.fn(),
      listSessions: vi.fn(),
      newSession: vi.fn(),
      resume: vi.fn(),
      selectModel: vi.fn(),
      selectPermission: vi.fn(),
      listFileReferences: vi.fn(),
      listSlashItems: vi.fn(),
      executeSlashCommand: vi.fn(),
    },
    provider: {
      ask: vi.fn<(request: AskUserQuestionRequest) => Promise<AskUserQuestionAnswer>>(),
      resolve: vi.fn<(askId: string, answered: AskUserQuestionAnswer) => void>(),
    },
  };
}

const inertCtx = { get: vi.fn<() => undefined>(() => undefined) } as never;

describe("dispatchCommand", () => {
  it("maps a submit command to runner.submit(text)", () => {
    const h = hooks();
    const msg: InboundMessage = { kind: "submit", text: "hi" };
    dispatchCommand(inertCtx, msg, h);
    expect(h.runner.submit).toHaveBeenCalledWith("hi", {});
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

  it("omits `custom` from the mapped answer when the wire answer carries none", () => {
    const h = hooks();
    const answered: AskAnswerWire = {
      answers: [{ id: "q1", selected: ["yes"] }],
    };
    const msg: InboundMessage = { kind: "answer", askId: "ask-1", answered };
    dispatchCommand(inertCtx, msg, h);

    // The provider must receive the mapped answer WITHOUT a stray `custom: undefined` key.
    const resolved = h.provider.resolve.mock.calls[0]![1];
    expect(resolved).toEqual({ answers: [{ id: "q1", selected: ["yes"] }] });
    expect("custom" in resolved.answers[0]).toBe(false);
  });

  it("maps listSessions / newSession / resume / selectModel / selectPermission", () => {
    const h = hooks();
    dispatchCommand(inertCtx, { kind: "listSessions" }, h);
    dispatchCommand(inertCtx, { kind: "newSession" }, h);
    dispatchCommand(inertCtx, { kind: "resume", sessionId: "s1" }, h);
    dispatchCommand(inertCtx, { kind: "selectModel", provider: "p", model: "m" }, h);
    dispatchCommand(inertCtx, { kind: "selectPermission", preset: "read-only" }, h);
    expect(h.runner.listSessions).toHaveBeenCalledOnce();
    expect(h.runner.newSession).toHaveBeenCalledOnce();
    expect(h.runner.resume).toHaveBeenCalledWith("s1");
    expect(h.runner.selectModel).toHaveBeenCalledWith("p", "m");
    expect(h.runner.selectPermission).toHaveBeenCalledWith("read-only");
  });

  it("maps listFileReferences to the runner", () => {
    const h = hooks();

    dispatchCommand(
      inertCtx,
      {
        kind: "listFileReferences",
        query: "src",
        requestId: "r1",
      },
      h,
    );

    expect(h.runner.listFileReferences).toHaveBeenCalledWith("src", "r1");
  });

  it("maps listSlashItems to the runner", () => {
    const h = hooks();

    dispatchCommand(
      inertCtx,
      { kind: "listSlashItems", requestId: "slash-1" },
      h,
    );

    expect(h.runner.listSlashItems).toHaveBeenCalledWith("slash-1");
  });

  it("maps executeSlashCommand to the runner executor", () => {
    const h = hooks();
    const images = [{ mediaType: "image/png" as const, data: "AQ==" }];

    dispatchCommand(
      inertCtx,
      { kind: "executeSlashCommand", line: "/goal ship", images },
      h,
    );

    expect(h.runner.executeSlashCommand).toHaveBeenCalledWith(
      "/goal ship",
      images,
    );
  });

  it("forwards optional submit picker fields", () => {
    const h = hooks();
    dispatchCommand(
      inertCtx,
      {
        kind: "submit",
        text: "hi",
        provider: "p",
        model: "m",
        permission: "read-only",
        images: [{ mediaType: "image/png", data: "AQ==", name: "a.png" }],
      },
      h,
    );
    expect(h.runner.submit).toHaveBeenCalledWith("hi", {
      provider: "p",
      model: "m",
      permission: "read-only",
      images: [{ mediaType: "image/png", data: "AQ==", name: "a.png" }],
    });
  });
});

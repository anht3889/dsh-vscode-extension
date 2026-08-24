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
      getCapabilities: vi.fn(),
      capabilities: vi.fn(() => []),
      getSection: vi.fn(),
      getMcpServer: vi.fn(),
      getMcpLogs: vi.fn(),
      runMcpOperation: vi.fn(),
      mutate: vi.fn(),
      setWebSearchConfig: vi.fn(),
      setCredential: vi.fn(),
      unsetCredential: vi.fn(),
      copyPreset: vi.fn(),
      deletePreset: vi.fn(),
      readPreset: vi.fn(),
      resolvePath: vi.fn(),
      dispose: vi.fn(),
    },
    provider: {
      ask: vi.fn<(request: AskUserQuestionRequest) => Promise<AskUserQuestionAnswer>>(),
      resolve: vi.fn<(askId: string, answered: AskUserQuestionAnswer) => void>(),
    },
  };
}

const inertCtx = { get: vi.fn<() => undefined>(() => undefined) } as never;

describe("dispatchCommand", () => {
  it("maps correlated queue intent to runner.submit", () => {
    const h = hooks();
    const msg: InboundMessage = {
      kind: "submit",
      requestId: "submit-1",
      mode: "queue",
      text: "hi",
    };
    dispatchCommand(inertCtx, msg, h);
    expect(h.runner.submit).toHaveBeenCalledWith("hi", {
      requestId: "submit-1",
      mode: "queue",
    });
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
        requestId: "submit-2",
        mode: "steer",
        text: "hi",
        provider: "p",
        model: "m",
        permission: "read-only",
        images: [{ mediaType: "image/png", data: "AQ==", name: "a.png" }],
      },
      h,
    );
    expect(h.runner.submit).toHaveBeenCalledWith("hi", {
      requestId: "submit-2",
      mode: "steer",
      provider: "p",
      model: "m",
      permission: "read-only",
      images: [{ mediaType: "image/png", data: "AQ==", name: "a.png" }],
    });
  });

  it("forwards every settings command to the retained coordinator surface", () => {
    const h = hooks();
    const mutation: InboundMessage = {
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "locale",
      expectedRevision: 1,
      ops: [{ op: "set", path: ["preference"], value: "zh" }],
    };
    const setCredential = {
      kind: "setCredential",
      requestId: "c1",
      ref: "DEEPSEEK_API_KEY",
      value: "fixture-secret",
    } as const;
    const unsetCredential = {
      kind: "unsetCredential",
      requestId: "c2",
      ref: "DEEPSEEK_API_KEY",
    } as const;
    const copyPreset = {
      kind: "copyAgentPreset",
      requestId: "p1",
      fromPresetId: "standard",
      presetId: "mine",
      name: "My Preset",
    } as const;
    const deletePreset = {
      kind: "deleteAgentPreset",
      requestId: "p2",
      presetId: "mine",
    } as const;
    const readPreset = {
      kind: "readAgentPreset",
      requestId: "p3",
      presetId: "standard",
    } as const;
    const resolvePath = {
      kind: "resolveSettingsPath",
      requestId: "path1",
      target: { kind: "settings-document", prepare: true },
    } as const;

    dispatchCommand(inertCtx, {
      kind: "getSettingsCapabilities",
      requestId: "c1",
    }, h);
    dispatchCommand(inertCtx, {
      kind: "getSettingsSection",
      requestId: "s1",
      section: "general",
    }, h);
    dispatchCommand(inertCtx, mutation, h);
    dispatchCommand(inertCtx, setCredential, h);
    dispatchCommand(inertCtx, unsetCredential, h);
    dispatchCommand(inertCtx, copyPreset, h);
    dispatchCommand(inertCtx, deletePreset, h);
    dispatchCommand(inertCtx, readPreset, h);
    dispatchCommand(inertCtx, resolvePath, h);

    expect(h.runner.getCapabilities).toHaveBeenCalledWith("c1");
    expect(h.runner.getSection).toHaveBeenCalledWith("s1", "general");
    expect(h.runner.mutate).toHaveBeenCalledWith(mutation);
    expect(h.runner.setCredential).toHaveBeenCalledWith(setCredential);
    expect(h.runner.unsetCredential).toHaveBeenCalledWith(unsetCredential);
    expect(h.runner.copyPreset).toHaveBeenCalledWith(copyPreset);
    expect(h.runner.deletePreset).toHaveBeenCalledWith(deletePreset);
    expect(h.runner.readPreset).toHaveBeenCalledWith(readPreset);
    expect(h.runner.resolvePath).toHaveBeenCalledWith(resolvePath);
  });

  it("routes a Web Search save to the retained coordinator", () => {
    const h = hooks();
    const message: Extract<InboundMessage, { kind: "setWebSearchConfig" }> = {
      kind: "setWebSearchConfig",
      requestId: "web-search-save",
      catalog: {
        engine: "tavily",
        engines: [{ engine: "tavily", baseURL: "https://tavily.example" }],
      },
      secrets: [{ ref: "TAVILY_API_KEY", value: "fixture-secret" }],
    };

    dispatchCommand(inertCtx, message, h);

    expect(h.runner.setWebSearchConfig).toHaveBeenCalledWith(message);
  });

  it("routes MCP detail and logs reads to the retained coordinator", () => {
    const h = hooks();
    const detail: Extract<InboundMessage, { kind: "getMcpServer" }> = {
      kind: "getMcpServer",
      requestId: "detail",
      serverId: "server-1",
    };
    const logs: Extract<InboundMessage, { kind: "getMcpLogs" }> = {
      kind: "getMcpLogs",
      requestId: "logs",
      serverId: "server-1",
      after: 4,
    };

    dispatchCommand(inertCtx, detail, h);
    dispatchCommand(inertCtx, logs, h);

    expect(h.runner.getMcpServer).toHaveBeenCalledWith(detail);
    expect(h.runner.getMcpLogs).toHaveBeenCalledWith(logs);
  });

  it("routes an MCP operation to the retained coordinator", () => {
    const h = hooks();
    const message: Extract<InboundMessage, { kind: "runMcpOperation" }> = {
      kind: "runMcpOperation",
      requestId: "connect",
      operation: { kind: "connectServer", serverId: "server-1" },
    };

    dispatchCommand(inertCtx, message, h);

    expect(h.runner.runMcpOperation).toHaveBeenCalledWith(message);
  });
});

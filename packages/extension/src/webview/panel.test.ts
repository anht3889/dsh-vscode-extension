import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InboundMessage,
  McpServerDetailWire,
  OutboundMessage,
} from "@dsh-vscode/contract";

const { showWarningMessage, workspace, openExternal } = vi.hoisted(() => ({
  showWarningMessage: vi.fn(),
  openExternal: vi.fn(async () => true),
  workspace: {
    workspaceFolders: [] as Array<{ uri: { fsPath: string } }>,
  },
}));
vi.mock("vscode", () => ({
  window: {
    showWarningMessage,
    createTextEditorDecorationType: () => ({ dispose: vi.fn() }),
    visibleTextEditors: [],
  },
  ThemeColor: class {},
  OverviewRulerLane: { Right: 1 },
  env: { openExternal },
  Uri: {
    parse: (value: string) => ({ toString: () => value }),
    file: (path: string) => ({ toString: () => path }),
    joinPath: () => ({ toString: () => "asset" }),
  },
  Range: class {},
  workspace,
}));

import { DshChatProvider } from "./panel.js";
import { McpController } from "./media/settings/sections/mcp/McpController.js";
import { PartialExtensionSettingsWriteError } from "../settingsHost.js";

const relayedDetail: McpServerDetailWire = {
  server: {
    id: "relayed",
    serverName: "Relayed",
    enabled: true,
    transport: "stdio",
    command: "mcp",
    args: [],
    env: [],
    cwd: "",
    auth: { kind: "headers", headerNames: ["Authorization"] },
    toolCallTimeoutMs: 30_000,
    reconnect: {
      enabled: true,
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      maxAttempts: 5,
    },
    createdAt: "created",
    updatedAt: "updated",
  },
  status: { state: "disconnected" },
  tools: [],
  secrets: {
    kind: "known",
    secrets: [{ name: "Authorization", configured: false }],
  },
};

describe("settings Full Access host confirmation", () => {
  beforeEach(() => {
    showWarningMessage.mockReset();
    workspace.workspaceFolders = [];
  });

  it("returns cancellation without forwarding a settings mutation", async () => {
    showWarningMessage.mockResolvedValue(undefined);
    const postMessage = vi.fn();
    const client = { send: vi.fn() };
    const provider = new DshChatProvider({} as never, {} as never);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
      running: { client, child: {}, stop: vi.fn() },
    });

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: { kind: "confirmSettingsFullAccess", requestId: "confirm-1" },
    });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsFullAccessConfirmation",
      requestId: "confirm-1",
      confirmed: false,
    }));
    expect(showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("new sessions"),
      { modal: true },
      "Enable Full Access",
    );
    expect(client.send).not.toHaveBeenCalled();
  });
});

function child(): EventEmitter {
  return new EventEmitter();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

interface TestRunning {
  client: {
    send: ReturnType<typeof vi.fn>;
    onMessage: ReturnType<typeof vi.fn>;
  };
  child: EventEmitter;
  stop: ReturnType<typeof vi.fn>;
}

function settingsHost() {
  return {
    read: vi.fn(() => ({
      binaryPath: "",
      handshakeTimeoutMs: 30_000,
    })),
    write: vi.fn(async () => {}),
    openExtensionSettings: vi.fn(async () => {}),
    openTrustedPath: vi.fn(async () => {}),
  };
}

function deliver(provider: DshChatProvider, message: OutboundMessage): void {
  (
    provider as unknown as {
      handleOutbound(message: OutboundMessage, generation?: number): void;
    }
  ).handleOutbound(message);
}

describe("extension settings host routing", () => {
  it("correlates read and changed write results without claiming a live restart", async () => {
    const host = settingsHost();
    const postMessage = vi.fn();
    const provider = new DshChatProvider({} as never, {} as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
    });

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: { kind: "getExtensionSettings", requestId: "read-1" },
    });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "read-1",
      action: "read",
      result: {
        ok: true,
        settings: { binaryPath: "", handshakeTimeoutMs: 30_000 },
      },
    }));

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: {
        kind: "updateExtensionSettings",
        requestId: "write-1",
        binaryPath: "/next/dsh",
        handshakeTimeoutMs: 45_000,
      },
    });
    await vi.waitFor(() => expect(host.write).toHaveBeenCalledWith({
      binaryPath: "/next/dsh",
      handshakeTimeoutMs: 45_000,
    }));
    expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "write-1",
      action: "write",
      result: {
        ok: true,
        settings: {
          binaryPath: "/next/dsh",
          handshakeTimeoutMs: 45_000,
        },
        restartRequired: true,
      },
    });
  });

  it("omits restartRequired and host updates for an unchanged write", async () => {
    const host = settingsHost();
    const postMessage = vi.fn();
    const provider = new DshChatProvider({} as never, {} as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
    });

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: {
        kind: "updateExtensionSettings",
        requestId: "unchanged",
        binaryPath: "",
        handshakeTimeoutMs: 30_000,
      },
    });

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
    const result = postMessage.mock.calls[0]?.[0];
    expect(result).toEqual({
      kind: "settingsHostResult",
      requestId: "unchanged",
      action: "write",
      result: {
        ok: true,
        settings: { binaryPath: "", handshakeTimeoutMs: 30_000 },
      },
    });
    expect(result.result).not.toHaveProperty("restartRequired");
  });

  it("omits restartRequired for a timeout-only write", async () => {
    const host = settingsHost();
    const postMessage = vi.fn();
    const provider = new DshChatProvider({} as never, {} as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
    });

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: {
        kind: "updateExtensionSettings",
        requestId: "timeout-only",
        binaryPath: "",
        handshakeTimeoutMs: 45_000,
      },
    });

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
    const result = postMessage.mock.calls[0]?.[0];
    expect(result).toEqual({
      kind: "settingsHostResult",
      requestId: "timeout-only",
      action: "write",
      result: {
        ok: true,
        settings: { binaryPath: "", handshakeTimeoutMs: 45_000 },
      },
    });
    expect(result.result).not.toHaveProperty("restartRequired");
    expect(host.write).toHaveBeenCalledWith({
      binaryPath: "",
      handshakeTimeoutMs: 45_000,
    });
  });

  it("rejects malformed updateExtensionSettings payloads before writing", async () => {
    const host = settingsHost();
    const postMessage = vi.fn();
    const provider = new DshChatProvider({} as never, {} as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
    });

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: {
        kind: "updateExtensionSettings",
        requestId: "bad-write",
        binaryPath: 12,
        handshakeTimeoutMs: "slow",
      } as never,
    });

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
    expect(host.write).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "bad-write",
      action: "write",
      result: {
        ok: false,
        detail: "Extension settings require a string binary path and integer timeout",
      },
    });
  });

  it("returns actual settings after a rollback failure", async () => {
    const host = settingsHost();
    const partial = new PartialExtensionSettingsWriteError(
      "partially written",
      {
        binaryPath: "/next/dsh",
        handshakeTimeoutMs: 30_000,
      },
    );
    host.write.mockRejectedValue(partial);
    const postMessage = vi.fn();
    const provider = new DshChatProvider({} as never, {} as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
    });

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: {
        kind: "updateExtensionSettings",
        requestId: "partial",
        binaryPath: "/next/dsh",
        handshakeTimeoutMs: 50_000,
      },
    });

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "partial",
      action: "write",
      result: {
        ok: false,
        detail: "partially written",
        settings: {
          binaryPath: "/next/dsh",
          handshakeTimeoutMs: 30_000,
        },
      },
    }));
  });

  it("opens only the correlated bridge path for the expected target", async () => {
    const host = settingsHost();
    const postMessage = vi.fn();
    const send = vi.fn();
    const provider = new DshChatProvider({} as never, {} as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
      running: { client: { send }, child: child(), stop: vi.fn() },
    });

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: { kind: "openSettingsDocument", requestId: "action-1" },
    });
    const request = send.mock.calls[0]?.[0] as {
      kind: string;
      requestId: string;
      target: { kind: string; prepare: boolean };
    };
    expect(request).toMatchObject({
      kind: "resolveSettingsPath",
      target: { kind: "settings-document", prepare: true },
    });

    deliver(provider, {
      kind: "settingsPath",
      requestId: request.requestId,
      result: {
        ok: true,
        path: "/tmp/settings.yaml",
        target: "settings-document",
      },
    });
    await vi.waitFor(() => expect(host.openTrustedPath).toHaveBeenCalledWith(
      "/tmp/settings.yaml",
      "open",
    ));
    expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "action-1",
      action: "openSettingsDocument",
      result: { ok: true },
    });
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "settingsPath" }),
    );
  });

  it("rejects mismatched, duplicate, and arbitrary path responses", async () => {
    const host = settingsHost();
    const postMessage = vi.fn();
    const send = vi.fn();
    const provider = new DshChatProvider({} as never, {} as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
      running: { client: { send }, child: child(), stop: vi.fn() },
    });

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: { kind: "revealDshHome", requestId: "action-2", path: "/evil" },
    });
    const requestId = send.mock.calls[0]?.[0]?.requestId as string;
    deliver(provider, {
      kind: "settingsPath",
      requestId,
      result: {
        ok: true,
        path: "/tmp/settings.yaml",
        target: "settings-document",
      },
    });
    deliver(provider, {
      kind: "settingsPath",
      requestId,
      result: {
        ok: true,
        path: "/tmp/.dsh",
        target: "dsh-home",
      },
    });

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "action-2",
      action: "revealDshHome",
      result: { ok: false, detail: "Resolved settings target did not match" },
    }));
    expect(host.openTrustedPath).not.toHaveBeenCalled();
  });

  it("supports preset targets and rejects relative bridge paths", async () => {
    const host = settingsHost();
    const postMessage = vi.fn();
    const send = vi.fn();
    const provider = new DshChatProvider({} as never, {} as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
      running: { client: { send }, child: child(), stop: vi.fn(async () => {}) },
    });

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: {
        kind: "openAgentPreset",
        requestId: "preset-action",
        presetId: "standard",
      },
    });
    const request = send.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      kind: "resolveSettingsPath",
      target: { kind: "agent-preset", presetId: "standard" },
    });
    deliver(provider, {
      kind: "settingsPath",
      requestId: request.requestId,
      result: {
        ok: true,
        path: "relative/preset.yml",
        target: "agent-preset",
      },
    });

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "preset-action",
      action: "openAgentPreset",
      result: {
        ok: false,
        detail: "Resolved settings path was not absolute and local",
      },
    }));
    expect(host.openTrustedPath).not.toHaveBeenCalled();
  });

  it("settles openAgentPreset when presetId is missing or empty", async () => {
    const host = settingsHost();
    const postMessage = vi.fn();
    const send = vi.fn();
    const provider = new DshChatProvider({} as never, {} as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
      running: { client: { send }, child: child(), stop: vi.fn(async () => {}) },
    });

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: { kind: "openAgentPreset", requestId: "missing-preset" } as never,
    });
    provider.onUiCommand({
      type: "dsh/ui",
      cmd: {
        kind: "openAgentPreset",
        requestId: "empty-preset",
        presetId: "",
      },
    });

    expect(send).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "missing-preset",
      action: "openAgentPreset",
      result: { ok: false, detail: "Invalid settings path target" },
    });
    expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "empty-preset",
      action: "openAgentPreset",
      result: { ok: false, detail: "Invalid settings path target" },
    });
  });

  it("rejects an invalid preset id before creating a bridge request", async () => {
    const host = settingsHost();
    const postMessage = vi.fn();
    const send = vi.fn();
    const provider = new DshChatProvider({} as never, {} as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
      running: { client: { send }, child: child(), stop: vi.fn(async () => {}) },
    });

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: {
        kind: "openAgentPreset",
        requestId: "bad-preset",
        presetId: "../../arbitrary",
      },
    });

    expect(send).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "bad-preset",
      action: "openAgentPreset",
      result: { ok: false, detail: "Invalid settings path target" },
    });
  });

  it("rejects pending trusted paths on stop and ignores their late response", async () => {
    const host = settingsHost();
    const postMessage = vi.fn();
    const send = vi.fn();
    const provider = new DshChatProvider({} as never, {} as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
      running: {
        client: { send },
        child: child(),
        stop: vi.fn(async () => {}),
      },
    });
    provider.onUiCommand({
      type: "dsh/ui",
      cmd: { kind: "revealDshHome", requestId: "home-action" },
    });
    const requestId = send.mock.calls[0]?.[0]?.requestId;

    await provider.stop();
    expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "home-action",
      action: "revealDshHome",
      result: { ok: false, detail: "DSH stopped" },
    });
    deliver(provider, {
      kind: "settingsPath",
      requestId,
      result: {
        ok: true,
        path: "/tmp/.dsh",
        target: "dsh-home",
      },
    });
    expect(host.openTrustedPath).not.toHaveBeenCalled();
  });

  it("times out a trusted path request exactly once", async () => {
    vi.useFakeTimers();
    try {
      const host = settingsHost();
      const postMessage = vi.fn();
      const send = vi.fn();
      const provider = new DshChatProvider({} as never, {} as never, host);
      Object.assign(provider as object, {
        view: { webview: { postMessage } },
        running: {
          client: { send },
          child: child(),
          stop: vi.fn(async () => {}),
        },
      });
      provider.onUiCommand({
        type: "dsh/ui",
        cmd: { kind: "openSettingsDocument", requestId: "timeout-action" },
      });

      await vi.advanceTimersByTimeAsync(10_000);
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage).toHaveBeenCalledWith({
        kind: "settingsHostResult",
        requestId: "timeout-action",
        action: "openSettingsDocument",
        result: { ok: false, detail: "Timed out resolving settings path" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps trusted path requests and frees capacity after cleanup", async () => {
    const host = settingsHost();
    const postMessage = vi.fn();
    const send = vi.fn();
    const provider = new DshChatProvider({} as never, {} as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
      running: {
        client: { send },
        child: child(),
        stop: vi.fn(async () => {}),
      },
    });
    for (let index = 0; index < 16; index += 1) {
      provider.onUiCommand({
        type: "dsh/ui",
        cmd: {
          kind: "openSettingsDocument",
          requestId: `path-${index}`,
        },
      });
    }
    expect(send).toHaveBeenCalledTimes(16);

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: { kind: "revealDshHome", requestId: "overflow" },
    });
    expect(send).toHaveBeenCalledTimes(16);
    expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "overflow",
      action: "revealDshHome",
      result: {
        ok: false,
        detail: "Too many settings path requests are pending",
      },
    });

    const firstInternalId = send.mock.calls[0]?.[0]?.requestId;
    deliver(provider, {
      kind: "settingsPath",
      requestId: firstInternalId,
      result: {
        ok: false,
        error: { code: "settings-rejected", message: "not available" },
      },
    });
    provider.onUiCommand({
      type: "dsh/ui",
      cmd: { kind: "revealDshHome", requestId: "after-cleanup" },
    });
    expect(send).toHaveBeenCalledTimes(17);
    await provider.stop();
  });
});

describe("safe DSH restart", () => {
  it("stops the owned child, resumes the captured session, and ignores its late exit", async () => {
    const host = settingsHost();
    const oldChild = child();
    const nextChild = child();
    const oldStop = vi.fn(async () => {});
    const nextSend = vi.fn();
    const pm = {
      start: vi.fn(async () => ({
        client: { send: nextSend, onMessage: vi.fn() },
        child: nextChild,
        stop: vi.fn(async () => {}),
      })),
    };
    const postMessage = vi.fn();
    const provider = new DshChatProvider({} as never, pm as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
      running: {
        client: { send: vi.fn(), onMessage: vi.fn() },
        child: oldChild,
        stop: oldStop,
      },
      activeFolder: "/workspace",
      currentSessionId: "session-1",
      status: "idle",
    });

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: { kind: "restartDsh", requestId: "restart-1" },
    });

    await vi.waitFor(() => expect(nextSend).toHaveBeenCalledWith({
      kind: "resume",
      sessionId: "session-1",
    }));
    expect(oldStop).toHaveBeenCalledOnce();
    expect(pm.start).toHaveBeenCalledWith("/workspace");
    oldChild.emit("exit", null, "SIGTERM");
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "hostDisconnected" }),
    );
    expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "restart-1",
      action: "restart",
      result: { ok: true },
    });
  });

  it("recovers from disconnected state and reports restart failure without clearing session", async () => {
    const host = settingsHost();
    const pm = {
      start: vi.fn().mockRejectedValue(new Error("launch failed")),
    };
    const postMessage = vi.fn();
    const provider = new DshChatProvider({} as never, pm as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
      activeFolder: "/workspace",
      currentSessionId: "session-1",
      status: "error",
    });

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: { kind: "restartDsh", requestId: "restart-2" },
    });

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "restart-2",
      action: "restart",
      result: { ok: false, detail: "launch failed" },
    }));
    expect(pm.start).toHaveBeenCalledWith("/workspace");
    expect(
      (provider as unknown as { currentSessionId?: string }).currentSessionId,
    ).toBe("session-1");
  });

  it("rejects restart while bridge state is busy without parsing detail text", async () => {
    const host = settingsHost();
    const pm = { start: vi.fn() };
    const postMessage = vi.fn();
    const provider = new DshChatProvider({} as never, pm as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
      activeFolder: "/workspace",
      status: "thinking",
    });

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: { kind: "restartDsh", requestId: "restart-3" },
    });

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "restart-3",
      action: "restart",
      result: { ok: false, detail: "DSH is busy" },
    }));
    expect(pm.start).not.toHaveBeenCalled();
  });

  it("settles a restart exactly once when Stop supersedes its pending start", async () => {
    const host = settingsHost();
    const next = deferred<TestRunning>();
    const replacementStop = vi.fn(async () => {});
    const pm = { start: vi.fn(() => next.promise) };
    const postMessage = vi.fn();
    const provider = new DshChatProvider({} as never, pm as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
      running: {
        client: { send: vi.fn(), onMessage: vi.fn() },
        child: child(),
        stop: vi.fn(async () => {}),
      },
      activeFolder: "/workspace",
      currentSessionId: "session-1",
      status: "idle",
    });
    provider.onUiCommand({
      type: "dsh/ui",
      cmd: { kind: "restartDsh", requestId: "restart-stop" },
    });
    await vi.waitFor(() => expect(pm.start).toHaveBeenCalledOnce());

    await provider.stop();
    expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "restart-stop",
      action: "restart",
      result: {
        ok: false,
        detail: "DSH restart cancelled: stop requested",
      },
    });
    next.resolve({
      client: { send: vi.fn(), onMessage: vi.fn() },
      child: child(),
      stop: replacementStop,
    });
    await vi.waitFor(() => expect(replacementStop).toHaveBeenCalledOnce());
    expect(
      postMessage.mock.calls.filter(
        ([message]) => message.requestId === "restart-stop",
      ),
    ).toHaveLength(1);
  });

  it("settles a restart exactly once when disposal cancels it", async () => {
    const host = settingsHost();
    const next = deferred<TestRunning>();
    const replacementStop = vi.fn(async () => {});
    const pm = { start: vi.fn(() => next.promise) };
    const postMessage = vi.fn();
    const provider = new DshChatProvider({} as never, pm as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
      running: {
        client: { send: vi.fn(), onMessage: vi.fn() },
        child: child(),
        stop: vi.fn(async () => {}),
      },
      activeFolder: "/workspace",
      status: "idle",
    });
    provider.onUiCommand({
      type: "dsh/ui",
      cmd: { kind: "restartDsh", requestId: "restart-dispose" },
    });
    await vi.waitFor(() => expect(pm.start).toHaveBeenCalledOnce());

    provider.dispose();
    expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "restart-dispose",
      action: "restart",
      result: {
        ok: false,
        detail: "DSH restart cancelled: provider disposed",
      },
    });
    next.resolve({
      client: { send: vi.fn(), onMessage: vi.fn() },
      child: child(),
      stop: replacementStop,
    });
    await vi.waitFor(() => expect(replacementStop).toHaveBeenCalledOnce());
    expect(
      postMessage.mock.calls.filter(
        ([message]) => message.requestId === "restart-dispose",
      ),
    ).toHaveLength(1);
  });

  it("settles an old restart before a newer restart takes ownership", async () => {
    const host = settingsHost();
    const first = deferred<TestRunning>();
    const firstReplacementStop = vi.fn(async () => {});
    const secondSend = vi.fn();
    const pm = {
      start: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce({
          client: { send: secondSend, onMessage: vi.fn() },
          child: child(),
          stop: vi.fn(async () => {}),
        }),
    };
    const postMessage = vi.fn();
    const provider = new DshChatProvider({} as never, pm as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
      running: {
        client: { send: vi.fn(), onMessage: vi.fn() },
        child: child(),
        stop: vi.fn(async () => {}),
      },
      activeFolder: "/workspace",
      currentSessionId: "session-1",
      status: "idle",
    });
    provider.onUiCommand({
      type: "dsh/ui",
      cmd: { kind: "restartDsh", requestId: "restart-old" },
    });
    await vi.waitFor(() => expect(pm.start).toHaveBeenCalledOnce());

    provider.onUiCommand({
      type: "dsh/ui",
      cmd: { kind: "restartDsh", requestId: "restart-new" },
    });
    await vi.waitFor(() => expect(pm.start).toHaveBeenCalledTimes(2));
    expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "restart-old",
      action: "restart",
      result: {
        ok: false,
        detail: "DSH restart cancelled: superseded by another restart",
      },
    });
    expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "restart-new",
      action: "restart",
      result: { ok: true },
    });
    first.resolve({
      client: { send: vi.fn(), onMessage: vi.fn() },
      child: child(),
      stop: firstReplacementStop,
    });
    await vi.waitFor(() => expect(firstReplacementStop).toHaveBeenCalledOnce());
    expect(
      postMessage.mock.calls.filter(
        ([message]) => message.requestId === "restart-old",
      ),
    ).toHaveLength(1);
  });

  it("settles a restart before a folder change starts new ownership", async () => {
    const host = settingsHost();
    const first = deferred<TestRunning>();
    const firstReplacementStop = vi.fn(async () => {});
    const pm = {
      start: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce({
          client: { send: vi.fn(), onMessage: vi.fn() },
          child: child(),
          stop: vi.fn(async () => {}),
        }),
    };
    const postMessage = vi.fn();
    const provider = new DshChatProvider({} as never, pm as never, host);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
      running: {
        client: { send: vi.fn(), onMessage: vi.fn() },
        child: child(),
        stop: vi.fn(async () => {}),
      },
      activeFolder: "/old",
      status: "idle",
    });
    provider.onUiCommand({
      type: "dsh/ui",
      cmd: { kind: "restartDsh", requestId: "restart-folder" },
    });
    await vi.waitFor(() => expect(pm.start).toHaveBeenCalledWith("/old"));
    workspace.workspaceFolders = [{ uri: { fsPath: "/new" } }];

    await provider.startActiveFolder();
    expect(postMessage).toHaveBeenCalledWith({
      kind: "settingsHostResult",
      requestId: "restart-folder",
      action: "restart",
      result: {
        ok: false,
        detail: "DSH restart cancelled: workspace folder changed",
      },
    });
    expect(pm.start).toHaveBeenCalledWith("/new");
    first.resolve({
      client: { send: vi.fn(), onMessage: vi.fn() },
      child: child(),
      stop: firstReplacementStop,
    });
    await vi.waitFor(() => expect(firstReplacementStop).toHaveBeenCalledOnce());
    expect(
      postMessage.mock.calls.filter(
        ([message]) => message.requestId === "restart-folder",
      ),
    ).toHaveLength(1);
  });
});

describe("MCP settings command relay", () => {
  /**
   * The relay drops a command it cannot validate without replying, and every
   * MCP controller command is a pending slot only a reply clears. Routing the
   * commands the editor's own call sequence produces through the real
   * `onUiCommand` relay fails here rather than stranding the editor at runtime.
   */
  it("forwards every command the MCP editor produces to the bridge", () => {
    const sent: InboundMessage[] = [];
    let next = 0;
    const controller = new McpController(
      (command) => sent.push(structuredClone(command)),
      vi.fn(),
      () => `relay-${++next}`,
    );
    controller.updateView({
      section: "mcp",
      servers: [],
      secretStates: "available",
      oauth: {
        kind: "manual",
        reason: "no-callback-origin",
        discovery: "available",
        authorization: "unavailable",
      },
    });

    controller.openCreate();
    controller.saveEditor();
    controller.setEditorField("serverName", "Relayed");
    controller.saveEditor();
    controller.setEditorField("command", "mcp");
    controller.setEditorField("auth", {
      kind: "headers",
      headerNames: ["Authorization"],
    });
    controller.stageSecret("Authorization", "relayed-secret");
    controller.saveEditor({ Authorization: "relayed-secret" });
    controller.receiveOperation({
      kind: "mcpOperation",
      requestId: "relay-1",
      result: { ok: true, detail: relayedDetail },
    });
    controller.continueSecretSave({ Authorization: "relayed-secret" });
    controller.receiveOperation({
      kind: "mcpOperation",
      requestId: "relay-2",
      result: { ok: false, error: { code: "mcp-rejected", message: "store failed" } },
    });
    controller.retrySecrets({ Authorization: "relayed-secret" });
    controller.select("relayed");
    controller.poll();

    expect(sent.map((command) => command.kind)).toEqual([
      "runMcpOperation",
      "runMcpOperation",
      "runMcpOperation",
      "getMcpServer",
      "getMcpLogs",
    ]);

    const client = { send: vi.fn(), onMessage: vi.fn() };
    const provider = new DshChatProvider({} as never, {} as never);
    Object.assign(provider as object, {
      view: { webview: { postMessage: vi.fn() } },
      running: { client, child: child(), stop: vi.fn(async () => {}) },
    });
    for (const command of sent) {
      provider.onUiCommand({ type: "dsh/ui", cmd: command });
    }

    expect(client.send.mock.calls.map(([command]) => command)).toEqual(sent);

    client.send.mockClear();
    provider.onUiCommand({
      type: "dsh/ui",
      cmd: {
        kind: "runMcpOperation",
        requestId: "relay-dropped",
        operation: {
          kind: "upsertServer",
          server: {
            serverName: "",
            enabled: true,
            transport: "stdio",
            command: "",
            auth: { kind: "none" },
            toolCallTimeoutMs: 30_000,
            reconnect: {
              enabled: true,
              initialDelayMs: 1_000,
              maxDelayMs: 30_000,
              maxAttempts: 5,
            },
          },
        },
      } as never,
    });
    expect(client.send).not.toHaveBeenCalled();
  });
});

describe("MCP authorize URL host open", () => {
  beforeEach(() => {
    openExternal.mockReset();
    openExternal.mockResolvedValue(true);
  });

  it("opens a successful MCP authorize URL in the system browser before forwarding", () => {
    const postMessage = vi.fn();
    const provider = new DshChatProvider({} as never, {} as never);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
    });
    const message: OutboundMessage = {
      kind: "mcpOperation",
      requestId: "auth-1",
      result: {
        ok: true,
        authorizeUrl: "https://idp.example/authorize?client_id=issued",
      },
    };

    deliver(provider, message);

    expect(openExternal).toHaveBeenCalledWith(
      expect.objectContaining({ toString: expect.any(Function) }),
    );
    expect(openExternal.mock.calls[0]?.[0].toString()).toBe(
      "https://idp.example/authorize?client_id=issued",
    );
    expect(postMessage).toHaveBeenCalledWith(message);
    expect(openExternal.mock.invocationCallOrder[0]).toBeLessThan(
      postMessage.mock.invocationCallOrder[0]!,
    );
  });

  it("does not open the browser for an ordinary MCP upsert", () => {
    const postMessage = vi.fn();
    const provider = new DshChatProvider({} as never, {} as never);
    Object.assign(provider as object, {
      view: { webview: { postMessage } },
    });
    const message: OutboundMessage = {
      kind: "mcpOperation",
      requestId: "upsert-1",
      result: { ok: true, detail: relayedDetail },
    };

    deliver(provider, message);

    expect(openExternal).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(message);
  });
});

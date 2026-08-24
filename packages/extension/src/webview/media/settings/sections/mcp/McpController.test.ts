import { describe, expect, it, vi } from "vitest";
import type {
  McpLogsMessage,
  McpOAuthDiscoveryMessage,
  McpOperationMessage,
  McpServerDetailWire,
  McpServerMessage,
  McpSettingsView,
} from "@dsh-vscode/contract";
import { settingsText } from "../../localization/index.js";
import { McpController } from "./McpController.js";

const SERVER = {
  id: "alpha",
  serverName: "Alpha",
  enabled: true,
  transport: "stdio" as const,
  command: "alpha-mcp",
  args: ["--serve"],
  env: [{ name: "MODE", value: "test" }],
  cwd: "/tmp",
  auth: { kind: "headers" as const, headerNames: ["Authorization"] },
  disabledTools: ["disabled-tool"],
  toolCallTimeoutMs: 30_000,
  reconnect: {
    enabled: true,
    initialDelayMs: 1_000,
    maxDelayMs: 30_000,
    maxAttempts: 5,
  },
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
};

const SECOND_SERVER = {
  ...SERVER,
  id: "beta",
  serverName: "Beta",
  command: "beta-mcp",
};

const DETAIL: McpServerDetailWire = {
  server: SERVER,
  status: { state: "connected", toolCount: 2, connectedAt: "now" },
  tools: [
    { name: "enabled-tool", description: "Enabled", enabled: true },
    { name: "disabled-tool", description: "Disabled", enabled: false },
  ],
  secrets: {
    kind: "known",
    secrets: [{ name: "Authorization", configured: false }],
  },
};

const VIEW: McpSettingsView = {
  section: "mcp",
  servers: [
    {
      server: SERVER,
      status: DETAIL.status,
      toolCount: 2,
      disabledToolCount: 1,
    },
    {
      server: SECOND_SERVER,
      status: { state: "disconnected" },
      toolCount: 0,
      disabledToolCount: 0,
    },
  ],
  secretStates: "available",
  oauth: {
    kind: "manual",
    reason: "no-callback-origin",
    discovery: "available",
    authorization: "unavailable",
  },
};

const LOOPBACK_VIEW: McpSettingsView = {
  ...VIEW,
  oauth: {
    kind: "loopback",
    origin: "http://127.0.0.1:54321",
    discovery: "available",
    authorization: "available",
  },
};

function bench() {
  const sent: unknown[] = [];
  const refresh = vi.fn();
  let next = 0;
  const controller = new McpController(
    (command) => sent.push(structuredClone(command)),
    refresh,
    () => `mcp-${++next}`,
  );
  controller.updateView(VIEW);
  return { controller, sent, refresh };
}

function detailReply(
  requestId: string,
  detail: McpServerDetailWire = DETAIL,
): McpServerMessage {
  return {
    kind: "mcpServer",
    requestId,
    result: { ok: true, detail },
  };
}

function logsReply(
  requestId: string,
  next: number,
  message: string,
  serverId = "alpha",
): McpLogsMessage {
  return {
    kind: "mcpLogs",
    requestId,
    result: {
      ok: true,
      serverId,
      next,
      entries: [{ at: "now", level: "info", message }],
    },
  };
}

function operationSuccess(
  requestId: string,
  detail: McpServerDetailWire | undefined = DETAIL,
  authorizeUrl?: string,
): McpOperationMessage {
  return {
    kind: "mcpOperation",
    requestId,
    result: {
      ok: true,
      ...(detail === undefined ? {} : { detail }),
      ...(authorizeUrl === undefined ? {} : { authorizeUrl }),
    },
  };
}

function operationFailure(
  requestId: string,
  message = "operation failed",
): McpOperationMessage {
  return {
    kind: "mcpOperation",
    requestId,
    result: {
      ok: false,
      error: { code: "mcp-rejected", message },
    },
  };
}

function discoveryReply(
  requestId: string,
  overrides: Partial<{
    clientId: string;
    authorizeUrl: string;
    tokenUrl: string;
    scopes: string[];
    registered: boolean;
    clientSecretIssued: boolean;
  }> = {},
): McpOAuthDiscoveryMessage {
  return {
    kind: "mcpOAuthDiscovery",
    requestId,
    result: {
      ok: true,
      discovery: {
        clientId: "discovered-client",
        authorizeUrl: "https://auth.example/authorize",
        tokenUrl: "https://auth.example/token",
        scopes: ["docs:read"],
        registered: true,
        clientSecretIssued: false,
        ...overrides,
      },
    },
  };
}

/** Open a create draft configured as an OAuth-over-HTTP server. */
function oauthDraft(controller: McpController, url = "https://mcp.example/rpc"): void {
  controller.openCreate();
  controller.setEditorField("transport", "streamable-http");
  controller.setEditorField("url", url);
  controller.setEditorField("auth", {
    kind: "oauth",
    clientId: "",
    authorizeUrl: "",
    tokenUrl: "",
    scopes: [],
    redirectPath: "/callback",
  });
}

describe("McpController OAuth discovery", () => {
  it("requests discovery for the draft URL and fills the non-secret fields", () => {
    const { controller, sent } = bench();
    oauthDraft(controller);

    expect(controller.discoverOAuth()).toBe(true);
    expect(sent.at(-1)).toEqual({
      kind: "discoverMcpOAuth",
      requestId: "mcp-1",
      url: "https://mcp.example/rpc",
    });
    expect(controller.snapshot().discovering).toBe(true);

    expect(controller.receiveDiscovery(discoveryReply("mcp-1"))).toBe(true);
    expect(controller.snapshot().discovering).toBe(false);
    expect(controller.snapshot().editor?.auth).toEqual({
      kind: "oauth",
      clientId: "discovered-client",
      authorizeUrl: "https://auth.example/authorize",
      tokenUrl: "https://auth.example/token",
      scopes: ["docs:read"],
      redirectPath: "/callback",
    });
  });

  it("keeps a hand-entered client id when discovery registered none", () => {
    const { controller } = bench();
    oauthDraft(controller);
    controller.setEditorField("auth", {
      kind: "oauth",
      clientId: "hand-entered",
      authorizeUrl: "",
      tokenUrl: "",
      scopes: [],
      redirectPath: "/callback",
    });

    controller.discoverOAuth();
    controller.receiveDiscovery(
      discoveryReply("mcp-1", { clientId: "", registered: false }),
    );

    expect(controller.snapshot().editor?.auth).toMatchObject({
      clientId: "hand-entered",
      authorizeUrl: "https://auth.example/authorize",
    });
  });

  // A profile that serves no OAuth callback discovers endpoints but cannot
  // register a client, so the client id stays the operator's to supply. Filling
  // two of three fields silently would read as a partial failure.
  it("explains an empty client id when discovery registered nothing", () => {
    const { controller } = bench();
    oauthDraft(controller);
    controller.discoverOAuth();

    controller.receiveDiscovery(
      discoveryReply("mcp-1", { clientId: "", registered: false }),
    );

    expect(controller.snapshot().editor?.auth).toMatchObject({
      clientId: "",
      authorizeUrl: "https://auth.example/authorize",
      tokenUrl: "https://auth.example/token",
    });
    expect(controller.snapshot().discoveryNoticeKey)
      .toBe("mcpDiscoverNoClientId");
  });

  it("stays silent about the client id when the draft already carries one", () => {
    const { controller } = bench();
    oauthDraft(controller);
    controller.setEditorField("auth", {
      kind: "oauth",
      clientId: "hand-entered",
      authorizeUrl: "",
      tokenUrl: "",
      scopes: [],
      redirectPath: "/callback",
    });
    controller.discoverOAuth();

    controller.receiveDiscovery(
      discoveryReply("mcp-1", { clientId: "", registered: false }),
    );

    expect(controller.snapshot().discoveryNoticeKey).toBeUndefined();
  });

  it("reports a registration secret the operator must re-enter", () => {
    const { controller } = bench();
    oauthDraft(controller);
    controller.discoverOAuth();

    controller.receiveDiscovery(
      discoveryReply("mcp-1", { clientSecretIssued: true }),
    );

    expect(controller.snapshot().discoveryNoticeKey)
      .toBe("mcpDiscoverClientSecret");
  });

  it("refuses discovery without an HTTP URL and without OAuth auth", () => {
    const { controller, sent } = bench();
    oauthDraft(controller, "   ");

    expect(controller.discoverOAuth()).toBe(false);
    expect(controller.snapshot().discoveryErrorKey).toBe("mcpDiscoverNeedUrl");
    expect(sent).toEqual([]);

    controller.setEditorField("url", "https://mcp.example/rpc");
    controller.setEditorField("auth", { kind: "none" });
    expect(controller.discoverOAuth()).toBe(false);
    expect(sent).toEqual([]);
  });

  it("refuses discovery with no editor open or while disconnected", () => {
    const { controller, sent } = bench();
    expect(controller.discoverOAuth()).toBe(false);

    oauthDraft(controller);
    controller.disconnect();
    expect(controller.discoverOAuth()).toBe(false);
    expect(sent).toEqual([]);
  });

  it("surfaces a discovery failure without touching the draft", () => {
    const { controller } = bench();
    oauthDraft(controller);
    controller.discoverOAuth();

    expect(controller.receiveDiscovery({
      kind: "mcpOAuthDiscovery",
      requestId: "mcp-1",
      result: {
        ok: false,
        error: { code: "mcp-rejected", message: "no metadata published" },
      },
    })).toBe(true);

    expect(controller.snapshot()).toMatchObject({
      discovering: false,
      discoveryErrorKey: "mcpDiscoverFailed",
      discoveryErrorDetail: "no metadata published",
    });
    expect(controller.snapshot().editor?.auth).toMatchObject({
      authorizeUrl: "",
      tokenUrl: "",
    });
  });

  it("drops a reply for an unknown request, a closed editor, and an edited URL", () => {
    const { controller } = bench();
    oauthDraft(controller);
    controller.discoverOAuth();
    expect(controller.receiveDiscovery(discoveryReply("stale"))).toBe(false);

    controller.closeEditor();
    expect(controller.receiveDiscovery(discoveryReply("mcp-1"))).toBe(false);

    oauthDraft(controller);
    controller.discoverOAuth();
    controller.setEditorField("url", "https://other.example/rpc");
    expect(controller.snapshot().discovering).toBe(false);
    expect(controller.receiveDiscovery(discoveryReply("mcp-2"))).toBe(false);
    expect(controller.snapshot().editor?.auth).toMatchObject({
      authorizeUrl: "",
    });
  });

  it("refuses a second discovery while one is in flight", () => {
    const { controller, sent } = bench();
    oauthDraft(controller);

    expect(controller.discoverOAuth()).toBe(true);
    expect(controller.discoverOAuth()).toBe(false);
    expect(sent.filter((command) =>
      (command as { kind: string }).kind === "discoverMcpOAuth")).toHaveLength(1);
  });
});

describe("McpController OAuth authorization", () => {
  it("provisions from name and URL without complete OAuth fields", () => {
    const { controller, sent } = bench();
    controller.updateView(LOOPBACK_VIEW);
    oauthDraft(controller);
    controller.setEditorField("serverName", "glean");

    expect(controller.provisionOAuth()).toBe(true);
    expect(sent).toEqual([{
      kind: "runMcpOperation",
      requestId: "mcp-1",
      operation: {
        kind: "provisionOAuthServer",
        serverName: "glean",
        url: "https://mcp.example/rpc",
        enabled: true,
      },
    }]);
    expect(controller.snapshot()).toMatchObject({
      authorizing: true,
      pending: ["create"],
    });
    expect(controller.editorValid()).toBe(false);
  });

  it("refuses provision when authorization or discovery is unavailable", () => {
    const { controller, sent } = bench();
    oauthDraft(controller);
    controller.setEditorField("serverName", "glean");

    expect(controller.provisionOAuth()).toBe(false);
    controller.updateView({
      ...LOOPBACK_VIEW,
      oauth: { ...LOOPBACK_VIEW.oauth, discovery: "unavailable" },
    });
    expect(controller.provisionOAuth()).toBe(false);
    expect(sent).toEqual([]);
  });

  // Provisioning writes a new catalog record, so an existing server is
  // re-authorized through startOAuth rather than provisioned again.
  it("refuses provision for an edit draft", () => {
    const { controller, sent } = bench();
    controller.updateView(LOOPBACK_VIEW);
    controller.openEdit("alpha");
    controller.setEditorField("transport", "streamable-http");
    controller.setEditorField("url", "https://mcp.example/rpc");
    controller.setEditorField("auth", {
      kind: "oauth",
      clientId: "",
      authorizeUrl: "",
      tokenUrl: "",
      scopes: [],
      redirectPath: "/callback",
    });

    expect(controller.snapshot().editor?.mode).toBe("edit");
    expect(controller.provisionOAuth()).toBe(false);
    expect(sent).toEqual([]);
    expect(controller.snapshot().authorizing).toBe(false);
  });

  it("starts OAuth for a selected OAuth server", () => {
    const { controller, sent } = bench();
    const oauthDetail: McpServerDetailWire = {
      ...DETAIL,
      server: {
        ...DETAIL.server,
        auth: {
          kind: "oauth",
          clientId: "client",
          authorizeUrl: "https://idp.example/authorize",
          tokenUrl: "https://idp.example/token",
          scopes: [],
          redirectPath: "/callback",
        },
      },
    };
    controller.updateView({
      ...LOOPBACK_VIEW,
      servers: [{
        ...LOOPBACK_VIEW.servers[0]!,
        server: oauthDetail.server,
      }],
    });
    controller.select("alpha");
    controller.receiveDetail(detailReply("mcp-1", oauthDetail));

    expect(controller.startOAuth()).toBe(true);
    expect(sent.at(-1)).toMatchObject({
      kind: "runMcpOperation",
      operation: { kind: "startOAuth", serverId: "alpha" },
    });
    expect(controller.snapshot().authorizing).toBe(true);
  });

  it("waits after authorization launch and clears on failure or dismissal", () => {
    const { controller, sent } = bench();
    controller.updateView(LOOPBACK_VIEW);
    oauthDraft(controller);
    controller.setEditorField("serverName", "glean");
    controller.provisionOAuth();

    expect(controller.receiveOperation(operationSuccess(
      "mcp-1",
      DETAIL,
      "https://idp.example/authorize",
    ))).toBe(true);
    expect(controller.snapshot().authorizing).toBe(true);
    expect(controller.snapshot().editor).toMatchObject({
      mode: "edit",
      serverId: "alpha",
    });
    expect(controller.provisionOAuth()).toBe(false);
    expect(sent).toHaveLength(1);
    controller.closeEditor();
    expect(controller.snapshot().authorizing).toBe(false);

    oauthDraft(controller);
    controller.setEditorField("serverName", "glean");
    controller.provisionOAuth();
    controller.receiveOperation(operationFailure("mcp-2"));
    expect(controller.snapshot().authorizing).toBe(false);
  });
});

describe("McpController", () => {
  it("seeds list state and clears a selected server that disappears", () => {
    const { controller } = bench();
    controller.select("alpha");
    controller.receiveDetail(detailReply("mcp-1"));
    controller.poll();
    controller.receiveLogs(logsReply("mcp-3", 4, "line"));
    controller.openEdit("alpha");

    controller.updateView({ ...VIEW, servers: [VIEW.servers[1]!] });

    expect(controller.snapshot()).toMatchObject({
      servers: [expect.objectContaining({ server: expect.objectContaining({ id: "beta" }) })],
      secretStates: "available",
      logs: [],
      pending: [],
      noticeKey: "mcpServerRemoved",
    });
    expect(controller.snapshot().selectedServerId).toBeUndefined();
    expect(controller.snapshot().detail).toBeUndefined();
    expect(controller.snapshot().editor).toBeUndefined();
  });

  it("loads selection detail and replaces then appends incremental logs", () => {
    const { controller, sent, refresh } = bench();
    controller.select("alpha");
    controller.poll();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([
      { kind: "getMcpServer", requestId: "mcp-1", serverId: "alpha" },
      { kind: "getMcpLogs", requestId: "mcp-2", serverId: "alpha" },
    ]);
    expect(controller.receiveDetail(detailReply("mcp-1"))).toBe(true);
    expect(controller.receiveLogs(logsReply("mcp-2", 7, "first"))).toBe(true);

    controller.poll();
    expect(sent.at(-2)).toEqual({
      kind: "getMcpServer",
      requestId: "mcp-3",
      serverId: "alpha",
    });
    expect(sent.at(-1)).toEqual({
      kind: "getMcpLogs",
      requestId: "mcp-4",
      serverId: "alpha",
      after: 7,
    });
    controller.receiveDetail(detailReply("mcp-3"));
    controller.receiveLogs(logsReply("mcp-4", 9, "second"));
    expect(controller.snapshot()).toMatchObject({
      logCursor: 9,
      logs: [
        expect.objectContaining({ message: "first" }),
        expect.objectContaining({ message: "second" }),
      ],
    });
  });

  it("keeps list, detail, and logs polling single-flight independently", () => {
    const { controller, sent, refresh } = bench();
    controller.select("alpha");
    controller.poll();
    controller.poll();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(2);

    controller.updateView(VIEW);
    controller.receiveDetail(detailReply("mcp-1"));
    controller.receiveLogs(logsReply("mcp-2", 1, "line"));
    controller.poll();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(sent).toHaveLength(4);
  });

  it("settles a failed list read and allows the next poll to retry", () => {
    const { controller, refresh } = bench();
    controller.poll();
    controller.receiveListFailure();

    expect(controller.snapshot()).toMatchObject({
      servers: VIEW.servers,
      errorKey: "mcpListLoadFailed",
    });
    controller.poll();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("rejects stale detail and logs after the selection epoch changes", () => {
    const { controller } = bench();
    controller.select("alpha");
    controller.poll();
    controller.select("beta");

    expect(controller.receiveDetail(detailReply("mcp-1"))).toBe(false);
    expect(controller.receiveLogs(logsReply("mcp-2", 1, "stale"))).toBe(false);
    expect(controller.snapshot()).toMatchObject({
      selectedServerId: "beta",
      logs: [],
    });
    expect(controller.snapshot().logCursor).toBeUndefined();

    controller.select(undefined);
    expect(controller.snapshot()).toMatchObject({ logs: [] });
    expect(controller.snapshot().selectedServerId).toBeUndefined();
  });

  it("creates, edits, closes, and discards non-secret drafts", () => {
    const { controller } = bench();
    controller.openCreate();
    expect(controller.snapshot()).toMatchObject({
      dirty: false,
      editor: { mode: "create", serverName: "", transport: "stdio" },
    });
    controller.setEditorField("serverName", "Created");
    expect(controller.snapshot()).toMatchObject({ dirty: true });
    controller.closeEditor();
    expect(controller.snapshot().editor).toBeUndefined();

    controller.openEdit("alpha");
    expect(controller.snapshot()).toMatchObject({
      dirty: false,
      editor: {
        mode: "edit",
        serverId: "alpha",
        serverName: "Alpha",
        command: "alpha-mcp",
      },
    });
    controller.setEditorField("command", "changed");
    controller.discardAll();
    expect(controller.snapshot()).toMatchObject({ dirty: false });
    expect(controller.snapshot().editor).toBeUndefined();
  });

  it("omits transport-inapplicable fields and retains no staged literal", () => {
    const { controller, sent } = bench();
    controller.openEdit("alpha");
    controller.stageSecret("Authorization", "top-secret-literal");

    expect(controller.saveEditor({
      Authorization: "top-secret-literal",
    })).toBe(true);
    expect(sent[0]).toEqual({
      kind: "runMcpOperation",
      requestId: "mcp-1",
      operation: {
        kind: "upsertServer",
        server: {
          serverId: "alpha",
          serverName: "Alpha",
          enabled: true,
          transport: "stdio",
          command: "alpha-mcp",
          args: ["--serve"],
          env: [{ name: "MODE", value: "test" }],
          cwd: "/tmp",
          auth: { kind: "headers", headerNames: ["Authorization"] },
          toolCallTimeoutMs: 30_000,
          reconnect: {
            enabled: true,
            initialDelayMs: 1_000,
            maxDelayMs: 30_000,
            maxAttempts: 5,
          },
        },
      },
    });
    expect(JSON.stringify(controller.snapshot())).not.toContain("top-secret-literal");

    controller.disconnect();
    controller.updateView(VIEW);
    controller.openCreate();
    controller.setEditorField("transport", "streamable-http");
    controller.setEditorField("url", "https://mcp.example");
    controller.setEditorField("serverName", "HTTP");
    expect(controller.saveEditor()).toBe(true);
    expect(sent[1]).toMatchObject({
      operation: {
        kind: "upsertServer",
        server: {
          serverName: "HTTP",
          transport: "streamable-http",
          url: "https://mcp.example",
        },
      },
    });
    const server = (
      sent[1] as { operation: { server: Record<string, unknown> } }
    ).operation.server;
    expect(server).not.toHaveProperty("command");
    expect(server).not.toHaveProperty("args");
    expect(server).not.toHaveProperty("env");
    expect(server).not.toHaveProperty("cwd");
  });

  it("handshakes record success before a single-flight secret continuation", () => {
    const { controller, sent } = bench();
    controller.openEdit("alpha");
    controller.stageSecret("Authorization", "private-value");
    controller.saveEditor({ Authorization: "private-value" });

    expect(controller.receiveOperation(operationSuccess("mcp-1"))).toBe(true);
    expect(sent).toHaveLength(1);
    expect(controller.snapshot()).toMatchObject({
      editor: { mode: "edit", serverId: "alpha" },
      secretRequest: {
        serverId: "alpha",
        names: ["Authorization"],
        epoch: 1,
      },
    });
    expect(controller.continueSecretSave({
      Authorization: "private-value",
    })).toBe(true);
    expect(controller.continueSecretSave({
      Authorization: "private-value",
    })).toBe(false);
    expect(sent[1]).toEqual({
      kind: "runMcpOperation",
      requestId: "mcp-2",
      operation: {
        kind: "setServerSecrets",
        serverId: "alpha",
        secrets: [{ name: "Authorization", value: "private-value" }],
      },
    });
    expect(controller.receiveOperation(
      operationFailure("mcp-2", "Authorization could not be stored"),
    )).toBe(true);
    expect(controller.snapshot()).toMatchObject({
      dirty: true,
      editor: {
        secretFailure: { names: ["Authorization"] },
        errorKey: "mcpSecretFailure",
      },
    });
    expect(controller.snapshot().editor?.errorDetail).toBeUndefined();
    expect(JSON.stringify(controller.snapshot())).not.toContain("private-value");

    expect(controller.retrySecrets({ Authorization: "retry-value" })).toBe(true);
    expect(sent[2]).toMatchObject({
      operation: {
        kind: "setServerSecrets",
        serverId: "alpha",
        secrets: [{ name: "Authorization", value: "retry-value" }],
      },
    });
    expect(sent.filter((command) =>
      (command as { operation?: { kind?: string } }).operation?.kind ===
        "upsertServer"
    )).toHaveLength(1);
  });

  it("blocks editor replacement throughout its save lifecycle", () => {
    const { controller } = bench();
    controller.openEdit("alpha");
    controller.stageSecret("Authorization", "owner-secret");
    controller.saveEditor({ Authorization: "owner-secret" });

    controller.closeEditor();
    controller.openEdit("beta");
    controller.openCreate();
    expect(controller.snapshot().editor).toMatchObject({
      mode: "edit",
      serverId: "alpha",
    });

    controller.receiveOperation(operationSuccess("mcp-1"));
    controller.openEdit("beta");
    controller.openCreate();
    expect(controller.snapshot().editor).toMatchObject({
      mode: "edit",
      serverId: "alpha",
    });

    controller.continueSecretSave({ Authorization: "owner-secret" });
    controller.closeEditor();
    controller.openEdit("beta");
    controller.openCreate();
    expect(controller.snapshot().editor).toMatchObject({
      mode: "edit",
      serverId: "alpha",
    });
  });

  it("record success leaves an unrelated editor byte-for-byte intact", () => {
    const { controller } = bench();
    controller.openEdit("alpha");
    controller.setEditorField("command", "saved-alpha");
    controller.saveEditor();
    controller.discardAll();
    controller.openEdit("beta");
    controller.setEditorField("command", "unrelated-beta");
    const before = JSON.stringify(controller.snapshot().editor);

    controller.receiveOperation(operationSuccess("mcp-1"));

    expect(JSON.stringify(controller.snapshot().editor)).toBe(before);
  });

  it.each([
    ["success", operationSuccess("mcp-2")],
    ["failure", operationFailure("mcp-2")],
  ] as const)(
    "secret %s leaves an unrelated editor byte-for-byte intact",
    (_outcome, result) => {
      const { controller } = bench();
      controller.openEdit("alpha");
      controller.stageSecret("Authorization", "alpha-secret");
      controller.saveEditor({ Authorization: "alpha-secret" });
      controller.receiveOperation(operationSuccess("mcp-1"));
      controller.continueSecretSave({ Authorization: "alpha-secret" });
      controller.discardAll();
      controller.openEdit("beta");
      controller.setEditorField("command", "unrelated-beta");
      const before = JSON.stringify(controller.snapshot().editor);

      controller.receiveOperation(result);

      expect(JSON.stringify(controller.snapshot().editor)).toBe(before);
    },
  );

  it("keeps staged intent on record failure without posting secrets", () => {
    const { controller, sent } = bench();
    controller.openEdit("alpha");
    controller.stageSecret("Authorization", "never-posted-value");
    controller.saveEditor({ Authorization: "never-posted-value" });

    expect(controller.receiveOperation(
      operationFailure("mcp-1", "record rejected"),
    )).toBe(true);
    expect(sent).toHaveLength(1);
    expect(controller.snapshot()).toMatchObject({
      dirty: true,
      editor: { errorDetail: "record rejected" },
    });
    expect(JSON.stringify(controller.snapshot())).not.toContain("never-posted-value");
  });

  it("advances the secret epoch on success and disconnect settlement", () => {
    const { controller } = bench();
    controller.openEdit("alpha");
    controller.stageSecret("Authorization", "secret");
    controller.saveEditor({ Authorization: "secret" });
    controller.receiveOperation(operationSuccess("mcp-1"));
    controller.continueSecretSave({ Authorization: "secret" });
    controller.receiveOperation(operationSuccess("mcp-2"));
    expect(controller.snapshot()).toMatchObject({
      secretEpoch: 1,
      dirty: false,
      pending: [],
    });

    controller.openEdit("alpha");
    controller.stageSecret("Authorization", "other-secret");
    controller.saveEditor({ Authorization: "other-secret" });
    controller.connectServer("beta");
    controller.disconnect();
    expect(controller.snapshot()).toMatchObject({
      connected: false,
      secretEpoch: 2,
      pending: [],
      dirty: false,
      editor: { errorKey: "mcpDisconnectedOperation" },
    });
    expect(controller.receiveOperation(operationSuccess("mcp-3"))).toBe(false);
    expect(controller.receiveOperation(operationSuccess("mcp-4"))).toBe(false);
  });

  it("retains only names across record settlement and snapshot history", () => {
    const { controller, sent } = bench();
    const snapshots: unknown[] = [];
    controller.openEdit("alpha");
    controller.stageSecret("Authorization", "component-local");
    controller.stageSecret("not-authorized", "must-not-stage");
    controller.saveEditor({ Authorization: "component-local" });
    snapshots.push(controller.snapshot());

    expect(controller.receiveOperation(operationSuccess("mcp-1"))).toBe(true);
    snapshots.push(controller.snapshot());
    expect(sent).toHaveLength(1);
    expect(controller.snapshot()).toMatchObject({
      dirty: true,
      secretRequest: {
        serverId: "alpha",
        names: ["Authorization"],
      },
    });
    expect(JSON.stringify(controller)).not.toContain("component-local");
    expect(JSON.stringify(snapshots)).not.toContain("component-local");
    expect(JSON.stringify(controller.snapshot())).not.toContain("component-local");
    expect(JSON.stringify(controller.snapshot())).not.toContain("must-not-stage");
  });

  it("declines an unsent secret request without replaying any operation", () => {
    const { controller, sent } = bench();
    controller.openEdit("alpha");
    controller.stageSecret("Authorization", "declined-literal");
    controller.saveEditor({ Authorization: "declined-literal" });
    controller.receiveOperation(operationSuccess("mcp-1"));

    expect(controller.declineSecretSave()).toBe(true);
    expect(sent).toHaveLength(1);
    expect(controller.snapshot()).toMatchObject({
      secretEpoch: 1,
      dirty: false,
      noticeKey: "mcpSecretDeclined",
      editor: {
        mode: "edit",
        serverId: "alpha",
        errorKey: "mcpSecretDeclined",
      },
      pending: [],
    });
    expect(controller.snapshot().secretRequest).toBeUndefined();
    expect(controller.continueSecretSave({
      Authorization: "declined-literal",
    })).toBe(false);
    controller.setEditorField("command", "usable-again");
    expect(controller.snapshot().editor?.command).toBe("usable-again");
    expect(JSON.stringify(controller)).not.toContain("declined-literal");
    expect(JSON.stringify(controller.snapshot())).not.toContain("declined-literal");
  });

  it("closes a rebased editor by declining its unsent secret request", () => {
    const { controller, sent } = bench();
    controller.openEdit("alpha");
    controller.stageSecret("Authorization", "close-literal");
    controller.saveEditor({ Authorization: "close-literal" });
    controller.receiveOperation(operationSuccess("mcp-1"));

    controller.closeEditor();

    expect(sent).toHaveLength(1);
    expect(controller.snapshot()).toMatchObject({
      secretEpoch: 1,
      dirty: false,
      pending: [],
    });
    expect(controller.snapshot().editor).toBeUndefined();
    expect(controller.snapshot().secretRequest).toBeUndefined();
    expect(controller.continueSecretSave({
      Authorization: "close-literal",
    })).toBe(false);
    expect(JSON.stringify(controller.snapshot())).not.toContain("close-literal");
  });

  it("rebases a committed create before secret failure and retries no record", () => {
    const { controller, sent } = bench();
    const createdDetail: McpServerDetailWire = {
      ...DETAIL,
      server: { ...SERVER, id: "created", serverName: "Created" },
    };
    controller.openCreate();
    controller.setEditorField("serverName", "Created");
    controller.setEditorField("command", "created-mcp");
    controller.setEditorField("auth", {
      kind: "headers",
      headerNames: ["Authorization"],
    });
    controller.stageSecret("Authorization", "create-secret");
    controller.saveEditor({ Authorization: "create-secret" });

    controller.receiveOperation(operationSuccess("mcp-1", createdDetail));
    expect(controller.snapshot()).toMatchObject({
      editor: { mode: "edit", serverId: "created", serverName: "Created" },
      secretRequest: {
        serverId: "created",
        names: ["Authorization"],
      },
      pending: ["created"],
    });
    expect(controller.continueSecretSave({
      Authorization: "create-secret",
    })).toBe(true);
    controller.receiveOperation(operationFailure("mcp-2"));
    expect(controller.snapshot()).toMatchObject({
      editor: {
        mode: "edit",
        serverId: "created",
        secretFailure: { names: ["Authorization"] },
      },
    });
    expect(controller.retrySecrets({
      Authorization: "retry-secret",
    })).toBe(true);
    expect(sent.map((command) =>
      (command as { operation: { kind: string } }).operation.kind
    )).toEqual(["upsertServer", "setServerSecrets", "setServerSecrets"]);
    expect((sent[2] as {
      operation: { serverId: string };
    }).operation.serverId).toBe("created");
  });

  it("retries failed names with newly staged names and reconciles submissions", () => {
    const { controller, sent } = bench();
    controller.openEdit("alpha");
    controller.setEditorField("auth", {
      kind: "headers",
      headerNames: ["Authorization", "X-Token", "X-New"],
    });
    controller.stageSecret("Authorization", "first-a");
    controller.stageSecret("X-Token", "first-b");
    controller.saveEditor({
      Authorization: "first-a",
      "X-Token": "first-b",
    });
    controller.receiveOperation(operationSuccess("mcp-1", {
      ...DETAIL,
      server: {
        ...SERVER,
        auth: {
          kind: "headers",
          headerNames: ["Authorization", "X-Token", "X-New"],
        },
      },
    }));
    controller.continueSecretSave({
      Authorization: "first-a",
      "X-Token": "first-b",
    });
    controller.receiveOperation(operationFailure("mcp-2"));
    controller.stageSecret("X-New", "new-c");

    expect(controller.retrySecrets({
      Authorization: "retry-a",
      "X-Token": "",
      "X-New": "new-c",
    })).toBe(true);
    expect(sent[2]).toMatchObject({
      operation: {
        kind: "setServerSecrets",
        secrets: [
          { name: "Authorization", value: "retry-a" },
          { name: "X-New", value: "new-c" },
        ],
      },
    });
    controller.receiveOperation(operationSuccess("mcp-3"));
    expect(controller.snapshot()).toMatchObject({
      editor: { secretFailure: { names: ["X-Token"] } },
      dirty: true,
    });
    expect(controller.retrySecrets({ "X-Token": "retry-b" })).toBe(true);
    controller.receiveOperation(operationSuccess("mcp-4"));
    expect(controller.snapshot()).toMatchObject({
      dirty: false,
      pending: [],
    });
    expect(controller.snapshot().editor).toBeUndefined();
  });

  it("serializes operations per server while allowing independent servers", () => {
    const { controller } = bench();
    expect(controller.connectServer("alpha")).toBe(true);
    expect(controller.setEnabled("alpha", false)).toBe(false);
    expect(controller.connectServer("beta")).toBe(true);
    expect(controller.snapshot().pending).toEqual(["alpha", "beta"]);
  });

  it("restores a server-reported tool state when a toggle fails", () => {
    const { controller } = bench();
    controller.select("alpha");
    controller.receiveDetail(detailReply("mcp-1"));
    expect(controller.toggleTool("alpha", "enabled-tool", false)).toBe(true);
    expect(controller.snapshot().detail?.tools[0]?.enabled).toBe(false);

    controller.receiveOperation(operationFailure("mcp-2"));
    expect(controller.snapshot().detail?.tools[0]?.enabled).toBe(true);
  });

  it("discards drafts without abandoning operation ownership or rollback", () => {
    const { controller } = bench();
    controller.select("alpha");
    controller.receiveDetail(detailReply("mcp-1"));
    controller.openEdit("alpha");
    controller.setEditorField("command", "discarded");
    expect(controller.toggleTool("alpha", "enabled-tool", false)).toBe(true);

    controller.discardAll();
    expect(controller.snapshot()).toMatchObject({
      dirty: false,
      pending: ["alpha"],
    });
    expect(controller.snapshot().editor).toBeUndefined();
    expect(controller.connectServer("alpha")).toBe(false);
    expect(controller.receiveOperation(operationFailure("mcp-2"))).toBe(true);
    expect(controller.snapshot().detail?.tools[0]?.enabled).toBe(true);
    expect(controller.connectServer("alpha")).toBe(true);
  });

  it("drives confirmations and settles an operation whose server vanishes", () => {
    const { controller, sent } = bench();
    controller.confirm("delete", "alpha");
    expect(controller.snapshot().confirmation).toEqual({
      kind: "delete",
      serverId: "alpha",
    });
    controller.cancelConfirmation();
    expect(controller.snapshot().confirmation).toBeUndefined();

    controller.confirm("clear-oauth", "alpha");
    expect(controller.runConfirmed()).toBe(true);
    expect(sent[0]).toMatchObject({
      operation: { kind: "clearOAuthTokens", serverId: "alpha" },
    });
    controller.updateView({ ...VIEW, servers: [VIEW.servers[1]!] });
    expect(controller.snapshot()).toMatchObject({
      pending: [],
      noticeKey: "mcpServerRemoved",
    });
    expect(controller.receiveOperation(operationSuccess("mcp-1"))).toBe(false);

    controller.confirm("delete", "beta");
    expect(controller.runConfirmed()).toBe(true);
    expect(sent[1]).toMatchObject({
      operation: { kind: "removeServer", serverId: "beta" },
    });
  });

  it("clears confirmations when their server or selection context disappears", () => {
    const { controller } = bench();
    controller.confirm("delete", "alpha");
    controller.updateView({ ...VIEW, servers: [VIEW.servers[1]!] });
    expect(controller.snapshot().confirmation).toBeUndefined();

    controller.select("beta");
    controller.confirm("clear-oauth", "beta");
    controller.select(undefined);
    expect(controller.snapshot().confirmation).toBeUndefined();

    controller.confirm("delete", "beta");
    controller.unavailable();
    expect(controller.snapshot().confirmation).toBeUndefined();
  });

  it("rejects unavailable actions and reconnects without stale replies reopening state", () => {
    const { controller } = bench();
    controller.select("alpha");
    controller.poll();
    controller.openEdit("alpha");
    controller.setEditorField("command", "preserved");
    controller.disconnect();

    expect(controller.connectServer("alpha")).toBe(false);
    expect(controller.receiveDetail(detailReply("mcp-1"))).toBe(false);
    expect(controller.receiveLogs(logsReply("mcp-2", 2, "stale"))).toBe(false);
    expect(controller.snapshot()).toMatchObject({
      connected: false,
      selectedServerId: "alpha",
      logs: [],
      editor: { command: "preserved" },
    });

    controller.updateView(VIEW);
    expect(controller.snapshot()).toMatchObject({
      connected: true,
      selectedServerId: "alpha",
      editor: { command: "preserved" },
    });
  });

  it("drops MCP-owned state on capability loss without marking transport disconnected", () => {
    const { controller } = bench();
    controller.select("alpha");
    controller.poll();
    controller.openEdit("alpha");
    controller.stageSecret("Authorization", "unavailable-secret");
    controller.connectServer("beta");

    controller.unavailable();
    expect(controller.snapshot()).toMatchObject({
      connected: true,
      servers: [],
      secretStates: "unavailable",
      logs: [],
      pending: [],
      noticeKey: "unavailable",
      secretEpoch: 1,
      dirty: false,
    });
    expect(controller.snapshot().selectedServerId).toBeUndefined();
    expect(controller.snapshot().detail).toBeUndefined();
    expect(controller.snapshot().editor).toBeUndefined();
    expect(controller.receiveDetail(detailReply("mcp-1"))).toBe(false);
    expect(controller.receiveLogs(logsReply("mcp-2", 2, "stale"))).toBe(false);
    expect(controller.receiveOperation(operationSuccess("mcp-3"))).toBe(false);
  });

  it("advances the list revision only when the authoritative list changes", () => {
    const { controller } = bench();
    const seeded = controller.listRevision();
    controller.select("alpha");
    controller.poll();

    expect(controller.receiveDetail(detailReply("mcp-1"))).toBe(true);
    expect(controller.receiveLogs(logsReply("mcp-2", 2, "line"))).toBe(true);
    expect(controller.listRevision()).toBe(seeded);

    expect(controller.receiveOperation(operationSuccess("mcp-9"))).toBe(false);
    expect(controller.listRevision()).toBe(seeded);

    controller.confirm("clear-oauth", "alpha");
    controller.runConfirmed();
    controller.receiveOperation(operationSuccess("mcp-3", {
      ...DETAIL,
      status: { state: "failed", error: "boom", at: "now" },
    }));
    const adopted = controller.listRevision();
    expect(adopted).toBeGreaterThan(seeded);
    expect(controller.listView()?.servers[0]?.status).toEqual({
      state: "failed",
      error: "boom",
      at: "now",
    });

    controller.confirm("delete", "beta");
    controller.runConfirmed();
    controller.receiveOperation(operationSuccess("mcp-4", undefined));
    expect(controller.listRevision()).toBeGreaterThan(adopted);
    expect(controller.listView()?.servers.map((item) => item.server.id))
      .toEqual(["alpha"]);
  });

  it("exposes a list view without staged secret values", () => {
    const { controller } = bench();
    controller.openEdit("alpha");
    controller.stageSecret("Authorization", "list-view-secret");

    expect(JSON.stringify(controller.listView())).not.toContain(
      "list-view-secret",
    );
    controller.unavailable();
    expect(controller.listView()).toBeUndefined();
  });

  it.each([
    ["empty create", (controller: McpController) => {
      controller.openCreate();
    }],
    ["name without command", (controller: McpController) => {
      controller.openCreate();
      controller.setEditorField("serverName", "Draft");
    }],
    ["blank header name", (controller: McpController) => {
      controller.openCreate();
      controller.setEditorField("serverName", "Draft");
      controller.setEditorField("command", "draft-mcp");
      controller.setEditorField("auth", { kind: "headers", headerNames: [""] });
    }],
    ["blank environment name", (controller: McpController) => {
      controller.openCreate();
      controller.setEditorField("serverName", "Draft");
      controller.setEditorField("command", "draft-mcp");
      controller.setEditorField("env", [{ name: "", value: "" }]);
    }],
    ["tool timeout cleared to zero", (controller: McpController) => {
      controller.openCreate();
      controller.setEditorField("serverName", "Draft");
      controller.setEditorField("command", "draft-mcp");
      controller.setEditorField("toolCallTimeoutMs", 0);
    }],
    ["streamable HTTP without a URL", (controller: McpController) => {
      controller.openCreate();
      controller.setEditorField("serverName", "Draft");
      controller.setEditorField("transport", "streamable-http");
    }],
    ["OAuth selected with empty fields", (controller: McpController) => {
      controller.openCreate();
      controller.setEditorField("serverName", "Draft");
      controller.setEditorField("command", "draft-mcp");
      controller.setEditorField("auth", {
        kind: "oauth",
        clientId: "",
        authorizeUrl: "",
        tokenUrl: "",
        scopes: [],
        redirectPath: "",
      });
    }],
  ] as const)(
    "refuses to send or pend an invalid draft: %s",
    (_state, compose) => {
      const { controller, sent } = bench();
      compose(controller);

      expect(controller.editorValid()).toBe(false);
      expect(controller.saveEditor()).toBe(false);
      expect(sent).toEqual([]);
      expect(controller.snapshot()).toMatchObject({
        pending: [],
        editor: { errorKey: "mcpInvalidRecord" },
      });

      controller.setEditorField("serverName", "Still editable");
      expect(controller.snapshot().editor).toMatchObject({
        serverName: "Still editable",
      });
      expect(controller.snapshot().editor?.errorKey).toBeUndefined();
      controller.closeEditor();
      expect(controller.snapshot().editor).toBeUndefined();
    },
  );

  it("sends exactly one command for an acceptable stdio draft", () => {
    const { controller, sent } = bench();
    controller.openCreate();
    controller.setEditorField("serverName", "Draft");
    controller.setEditorField("command", "draft-mcp");

    expect(controller.editorValid()).toBe(true);
    expect(controller.saveEditor()).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "runMcpOperation",
      operation: {
        kind: "upsertServer",
        server: { serverName: "Draft", command: "draft-mcp" },
      },
    });
    expect(controller.snapshot().pending).toEqual(["create"]);
  });

  it("uses typed bilingual controller error copy", () => {
    expect(settingsText("en", "mcpListLoadFailed")).toBe(
      "MCP servers could not be refreshed. Retry to keep using the last loaded data.",
    );
    expect(settingsText("zh", "mcpListLoadFailed")).toBe(
      "无法刷新 MCP 服务器。请重试；上次加载的数据仍可继续使用。",
    );
    expect(settingsText("zh", "mcpSecretFailure")).toContain("密钥");
    expect(settingsText("zh", "mcpSecretDeclined")).toContain("重新输入");
    expect(settingsText("en", "mcpInvalidRecord")).toContain("required");
    expect(settingsText("zh", "mcpInvalidRecord")).toContain("必填");
  });
});

import { Context } from "@deepseek-ai/cordis";
import {
  isSettingsOutboundMessage,
  MAX_MCP_LOG_ENTRIES,
  MAX_MCP_LOG_DETAIL_LENGTH,
  MAX_MCP_LOG_MESSAGE_LENGTH,
  MAX_MCP_SERVERS,
  MAX_MCP_TOOLS,
} from "@dsh-vscode/contract";
import { describe, expect, it, vi } from "vitest";
import {
  buildMcpDetail,
  buildMcpView,
  discoverMcpOAuth,
  projectMcpServer,
  projectMcpStatus,
  readMcpLogs,
  runMcpOperation,
  secretNamesFor,
  writableSecretNamesFor,
} from "./mcp.js";
import type {
  McpConnectionStatusLike,
  McpManagementService,
  McpServerRecordLike,
} from "./optional-services.js";

const baseRecord = (
  overrides: Partial<McpServerRecordLike> = {},
): McpServerRecordLike => ({
  id: "server-1",
  serverName: "Fixture",
  enabled: true,
  transport: "stdio",
  command: "node",
  args: ["server.js"],
  env: { FIRST: "one", SECOND: "two" },
  cwd: "/workspace",
  auth: { kind: "none" },
  toolCallTimeoutMs: 30_000,
  reconnect: {
    enabled: true,
    initialDelayMs: 100,
    maxDelayMs: 1_000,
    maxAttempts: 3,
  },
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
  ...overrides,
});

const fakeService = (
  overrides: Partial<McpManagementService> = {},
): McpManagementService => {
  const record = baseRecord();
  return {
    list: () => [record],
    get: (id) => id === record.id ? record : undefined,
    upsert: async (candidate) => candidate,
    remove: async () => {},
    setEnabled: async () => {},
    connect: async () => {},
    disconnect: async () => {},
    getStatus: () => ({ state: "disconnected" }),
    getLogs: () => ({ next: 0, entries: [] }),
    getTools: () => [],
    setToolEnabled: async () => {},
    clearOAuth: async () => {},
    setSecrets: async () => {},
    ...overrides,
  };
};

function contextWith(service?: McpManagementService): Context {
  const ctx = new Context();
  if (service !== undefined) ctx.provide("mcp", service as never);
  return ctx;
}

describe("MCP read projection", () => {
  it("projects list records, live status, tool counts, env order, and support state", async () => {
    const record = baseRecord({ disabledTools: ["hidden"] });
    const service = fakeService({
      list: () => [record],
      getStatus: () => ({ state: "connected", toolCount: 2, connectedAt: "now" }),
      getTools: () => [
        { name: "visible", enabled: true },
        { name: "hidden", enabled: false },
      ],
      describeSecrets: async () => ({}),
    });

    await expect(buildMcpView(contextWith(service))).resolves.toEqual({
      section: "mcp",
      servers: [{
        server: {
          ...record,
          env: [
            { name: "FIRST", value: "one" },
            { name: "SECOND", value: "two" },
          ],
        },
        status: { state: "connected", toolCount: 2, connectedAt: "now" },
        toolCount: 2,
        disabledToolCount: 1,
      }],
      secretStates: "available",
      oauth: {
        kind: "manual",
        reason: "no-callback-origin",
        discovery: "unavailable",
        authorization: "unavailable",
      },
    });
  });

  it("reports OAuth discovery as reachable only when the plugin exposes it", async () => {
    await expect(
      buildMcpView(contextWith(fakeService())),
    ).resolves.toMatchObject({
      oauth: {
        kind: "manual",
        reason: "no-callback-origin",
        discovery: "unavailable",
        authorization: "unavailable",
      },
    });
    await expect(
      buildMcpView(contextWith(fakeService({
        discoverOAuth: async () => ({
          clientId: "",
          authorizeUrl: "https://auth.example/authorize",
          tokenUrl: "https://auth.example/token",
          scopes: [],
          registered: false,
        }),
      }))),
    ).resolves.toMatchObject({
      oauth: {
        kind: "manual",
        reason: "no-callback-origin",
        discovery: "available",
        authorization: "unavailable",
      },
    });
  });

  it("projects loopback OAuth support when authorization is available", async () => {
    const oauthRedirectOrigin = vi.fn(
      () => "http://127.0.0.1:54321",
    );

    await expect(buildMcpView(contextWith(fakeService({
      discoverOAuth: async () => ({
        clientId: "client",
        authorizeUrl: "https://auth.example/authorize",
        tokenUrl: "https://auth.example/token",
        scopes: [],
        registered: true,
      }),
      startOAuth: async () => ({
        authorizeUrl: "https://auth.example/authorize?client_id=client",
      }),
      oauthRedirectOrigin,
    })))).resolves.toMatchObject({
      oauth: {
        kind: "loopback",
        origin: "http://127.0.0.1:54321",
        discovery: "available",
        authorization: "available",
      },
    });
    expect(oauthRedirectOrigin).toHaveBeenCalledOnce();
  });

  it.each([
    ["method missing", {}],
    ["origin missing", { oauthRedirectOrigin: () => undefined }],
    ["origin probe throws", {
      oauthRedirectOrigin: () => {
        throw new Error("no listener");
      },
    }],
  ])("projects manual OAuth support when the %s", async (_label, overrides) => {
    await expect(buildMcpView(contextWith(fakeService({
      startOAuth: async () => ({
        authorizeUrl: "https://auth.example/authorize",
      }),
      ...overrides,
    })))).resolves.toMatchObject({
      oauth: {
        kind: "manual",
        reason: "no-callback-origin",
        authorization: "unavailable",
      },
    });
  });

  it("keeps absent optional record fields absent", () => {
    const projected = projectMcpServer(baseRecord({
      args: undefined,
      env: undefined,
      cwd: undefined,
      disabledTools: undefined,
    }));

    expect(projected).not.toHaveProperty("args");
    expect(projected).not.toHaveProperty("env");
    expect(projected).not.toHaveProperty("cwd");
    expect(projected).not.toHaveProperty("disabledTools");
  });

  it.each<McpConnectionStatusLike>([
    { state: "disconnected" },
    { state: "connecting", attempt: 1 },
    { state: "connected", toolCount: 2, connectedAt: "now" },
    { state: "reconnecting", attempt: 3, nextDelayMs: 500 },
    { state: "failed", error: "failed verbatim", at: "later" },
  ])("projects status variant $state", (status) => {
    expect(projectMcpStatus(status)).toEqual(status);
  });

  it("bounds foreign failed-status text before wire projection", () => {
    const projected = projectMcpStatus({
      state: "failed",
      error: "x".repeat(513),
      at: "later",
    });
    expect(projected).toEqual({
      state: "failed",
      error: "x".repeat(512),
      at: "later",
    });
  });

  it.each([[""], [42 as never]])(
    "replaces invalid failed-status error %# with a non-empty fallback",
    (error) => {
      expect(projectMcpStatus({
        state: "failed",
        error,
        at: "later",
      })).toEqual({
        state: "failed",
        error: "MCP connection failed",
        at: "later",
      });
    },
  );

  it.each([
    [
      { kind: "none" as const },
      [],
    ],
    [
      { kind: "headers" as const, headerNames: ["Authorization", "X-Key"] },
      ["Authorization", "X-Key"],
    ],
    [
      {
        kind: "oauth" as const,
        clientId: "client",
        authorizeUrl: "https://auth.example/authorize",
        tokenUrl: "https://auth.example/token",
        scopes: ["read"],
        redirectPath: "/oauth/callback",
      },
      [
        "OAUTH_ACCESS",
        "OAUTH_REFRESH",
        "OAUTH_EXPIRES_AT",
        "OAUTH_CLIENT_SECRET",
      ],
    ],
  ])("derives secret names for $0.kind auth", (auth, expected) => {
    expect(secretNamesFor(baseRecord({ auth }))).toEqual(expected);
  });

  it("projects streamable HTTP and every auth variant", () => {
    const projected = projectMcpServer(baseRecord({
      transport: "streamable-http",
      command: undefined,
      args: undefined,
      env: undefined,
      cwd: undefined,
      url: "https://mcp.example",
      auth: {
        kind: "oauth",
        clientId: "client",
        authorizeUrl: "https://auth.example/authorize",
        tokenUrl: "https://auth.example/token",
        scopes: ["read"],
        redirectPath: "/oauth/callback",
      },
    }));
    expect(projected.transport).toBe("streamable-http");
    expect(projected.url).toBe("https://mcp.example");
    expect(projected.auth.kind).toBe("oauth");
  });

  it("drops foreign reconnect keys from the closed server projection", async () => {
    const record = baseRecord({
      reconnect: {
        enabled: true,
        initialDelayMs: 100,
        maxDelayMs: 1_000,
        maxAttempts: 3,
        leaked: "foreign",
      } as never,
    });
    const view = await buildMcpView(contextWith(fakeService({
      list: () => [record],
    })));

    expect(view.servers[0]?.server.reconnect).toEqual({
      enabled: true,
      initialDelayMs: 100,
      maxDelayMs: 1_000,
      maxAttempts: 3,
    });
    expect(view.servers[0]?.server.reconnect).not.toHaveProperty("leaked");
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "reconnect-extra",
      view,
    })).toBe(true);
  });

  it("projects tools and known value-free secret state", async () => {
    const record = baseRecord({
      auth: { kind: "headers", headerNames: ["Authorization", "X-Key"] },
    });
    const service = fakeService({
      get: () => record,
      getStatus: () => ({ state: "connecting", attempt: 2 }),
      getTools: () => [
        { name: "described", description: "A tool", enabled: true },
        { name: "plain", enabled: false },
      ],
      describeSecrets: async () => ({
        Authorization: { configured: true },
        "X-Key": { configured: false },
        EXTRA: { configured: true },
      }),
    });

    await expect(buildMcpDetail(contextWith(service), record.id)).resolves.toEqual({
      server: projectMcpServer(record),
      status: { state: "connecting", attempt: 2 },
      tools: [
        { name: "described", description: "A tool", enabled: true },
        { name: "plain", description: "", enabled: false },
      ],
      secrets: {
        kind: "known",
        secrets: [
          { name: "Authorization", configured: true },
          { name: "X-Key", configured: false },
        ],
      },
    });
  });

  it.each(["missing", "rejecting"] as const)(
    "degrades secrets to unknown when describeSecrets is %s",
    async (mode) => {
      const service = fakeService(mode === "rejecting"
        ? { describeSecrets: async () => { throw new Error("unavailable"); } }
        : {});
      const detail = await buildMcpDetail(contextWith(service), "server-1");
      expect(detail.secrets).toEqual({ kind: "unknown" });
    },
  );

  it("reads incremental logs with exact cursor and bounded text", () => {
    const getLogs = vi.fn(() => ({
      next: 9,
      entries: [
        {
          at: "one",
          level: "info" as const,
          message: "i".repeat(MAX_MCP_LOG_MESSAGE_LENGTH + 1),
        },
        {
          at: "two",
          level: "warn" as const,
          message: "warning",
          detail: "d".repeat(MAX_MCP_LOG_DETAIL_LENGTH + 1),
        },
        { at: "three", level: "error" as const, message: "failure" },
      ],
    }));
    const result = readMcpLogs(contextWith(fakeService({ getLogs })), "server-1", 4);

    expect(getLogs).toHaveBeenCalledWith("server-1", 4);
    expect(result).toEqual({
      serverId: "server-1",
      next: 9,
      entries: [
        { at: "one", level: "info", message: "i".repeat(MAX_MCP_LOG_MESSAGE_LENGTH) },
        {
          at: "two",
          level: "warn",
          message: "warning",
          detail: "d".repeat(MAX_MCP_LOG_DETAIL_LENGTH),
        },
        { at: "three", level: "error", message: "failure" },
      ],
    });
  });

  it.each([
    ["detail", async (ctx: Context) => buildMcpDetail(ctx, "missing")],
    ["logs", async (ctx: Context) => readMcpLogs(ctx, "missing")],
  ])("rejects unknown server ids for %s", async (_name, read) => {
    await expect(read(contextWith(fakeService()))).rejects.toThrow("missing");
  });

  it.each([
    ["list", async (ctx: Context) => buildMcpView(ctx)],
    ["detail", async (ctx: Context) => buildMcpDetail(ctx, "server-1")],
    ["logs", async (ctx: Context) => readMcpLogs(ctx, "server-1")],
  ])("requires a fresh ready service probe for %s", async (_name, read) => {
    const ctx = contextWith();
    await expect(read(ctx)).rejects.toThrow("MCP management service is not available");
  });

  it("re-probes for every operation and retains no stale service", async () => {
    const ctx = contextWith();
    const remove = ctx.provide("mcp", fakeService({
      list: () => [baseRecord({ id: "first" })],
    }) as never);
    expect((await buildMcpView(ctx)).servers[0]?.server.id).toBe("first");
    await remove();
    ctx.provide("mcp", fakeService({
      list: () => [baseRecord({ id: "second" })],
    }) as never);
    expect((await buildMcpView(ctx)).servers[0]?.server.id).toBe("second");
  });

  it("rejects one-over collection caps and accepts exact caps", async () => {
    const records = Array.from({ length: MAX_MCP_SERVERS }, (_, index) =>
      baseRecord({
        id: `server-${index}`,
        serverName: `Server ${index}`,
        args: Array.from({ length: 64 }, (__, item) => `arg-${item}`),
        env: Object.fromEntries(
          Array.from({ length: 64 }, (__, item) => [`ENV_${item}`, `value-${item}`]),
        ),
        auth: {
          kind: "headers",
          headerNames: Array.from({ length: 32 }, (__, item) => `Header-${item}`),
        },
        disabledTools: Array.from(
          { length: 256 },
          (__, item) => `disabled-${item}`,
        ),
      }));
    const exact = await buildMcpView(contextWith(fakeService({
      list: () => records,
      getTools: () => [],
    })));
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "maximal",
      view: exact,
    })).toBe(true);

    await expect(buildMcpView(contextWith(fakeService({
      list: () => [...records, baseRecord({ id: "over" })],
    })))).rejects.toThrow(`${MAX_MCP_SERVERS}`);

    await expect(buildMcpDetail(contextWith(fakeService({
      getTools: () => Array.from(
        { length: MAX_MCP_TOOLS + 1 },
        (_, index) => ({ name: `tool-${index}`, enabled: true }),
      ),
    })), "server-1")).rejects.toThrow(`${MAX_MCP_TOOLS}`);

    expect(() => readMcpLogs(contextWith(fakeService({
      getLogs: () => ({
        next: 1,
        entries: Array.from(
          { length: MAX_MCP_LOG_ENTRIES + 1 },
          (_, index) => ({
            at: "now",
            level: "info" as const,
            message: `entry-${index}`,
          }),
        ),
      }),
    })), "server-1")).toThrow(`${MAX_MCP_LOG_ENTRIES}`);
  });

  it.each([
    [
      "arguments",
      baseRecord({ args: Array.from({ length: 65 }, () => "arg") }),
      "64",
    ],
    [
      "environment",
      baseRecord({
        env: Object.fromEntries(
          Array.from({ length: 65 }, (_, index) => [`ENV_${index}`, "value"]),
        ),
      }),
      "64",
    ],
    [
      "header names",
      baseRecord({
        auth: {
          kind: "headers",
          headerNames: Array.from({ length: 33 }, (_, index) => `Header-${index}`),
        },
      }),
      "32",
    ],
    [
      "OAuth scopes",
      baseRecord({
        auth: {
          kind: "oauth",
          clientId: "client",
          authorizeUrl: "https://auth.example/authorize",
          tokenUrl: "https://auth.example/token",
          scopes: Array.from({ length: 33 }, (_, index) => `scope-${index}`),
          redirectPath: "/oauth/callback",
        },
      }),
      "32",
    ],
    [
      "disabled tools",
      baseRecord({
        disabledTools: Array.from(
          { length: 257 },
          (_, index) => `tool-${index}`,
        ),
      }),
      "256",
    ],
  ])("rejects one-over MCP %s cap", (_name, record, cap) => {
    expect(() => projectMcpServer(record)).toThrow(cap);
  });

  it("accepts an exact-cap tool detail as an outbound message", async () => {
    const detail = await buildMcpDetail(contextWith(fakeService({
      getTools: () => Array.from(
        { length: MAX_MCP_TOOLS },
        (_, index) => ({
          name: `tool-${index}`,
          description: `Tool ${index}`,
          enabled: index % 2 === 0,
        }),
      ),
    })), "server-1");

    expect(isSettingsOutboundMessage({
      kind: "mcpServer",
      requestId: "maximal-detail",
      result: { ok: true, detail },
    })).toBe(true);
  });

  it("accepts an exact-cap incremental log response as an outbound message", () => {
    const result = readMcpLogs(contextWith(fakeService({
      getLogs: () => ({
        next: MAX_MCP_LOG_ENTRIES,
        entries: Array.from(
          { length: MAX_MCP_LOG_ENTRIES },
          (_, index) => ({
            at: "now",
            level: (["info", "warn", "error"] as const)[index % 3]!,
            message: `entry-${index}`,
          }),
        ),
      }),
    })), "server-1");

    expect(isSettingsOutboundMessage({
      kind: "mcpLogs",
      requestId: "maximal-logs",
      result: { ok: true, ...result },
    })).toBe(true);
  });

  it("rejects malformed foreign discriminants instead of emitting them", async () => {
    expect(() => projectMcpServer(baseRecord({
      auth: { kind: "invalid" } as never,
    }))).toThrow();
    expect(() => projectMcpStatus({
      state: "invalid",
    } as never)).toThrow();

    const malformedLogs = fakeService({
      getLogs: () => ({
        next: 1,
        entries: [{ at: "now", level: "debug", message: "hidden" }] as never,
      }),
    });
    expect(() => readMcpLogs(contextWith(malformedLogs), "server-1")).toThrow();
  });

  it("rejects malformed foreign booleans instead of emitting them", async () => {
    expect(() => projectMcpServer(baseRecord({
      enabled: "yes" as never,
    }))).toThrow();
    await expect(buildMcpDetail(contextWith(fakeService({
      getTools: () => [{ name: "tool", enabled: "yes" as never }],
    })), "server-1")).rejects.toThrow();
  });
});

describe("MCP mutations", () => {
  const serverInput = (
    overrides: Record<string, unknown> = {},
  ): Parameters<typeof runMcpOperation>[1] & { kind: "upsertServer" } => ({
    kind: "upsertServer",
    server: {
      serverName: "Fixture",
      enabled: true,
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      env: [{ name: "FIRST", value: "one" }],
      cwd: "/workspace",
      auth: { kind: "none" },
      toolCallTimeoutMs: 30_000,
      reconnect: {
        enabled: true,
        initialDelayMs: 100,
        maxDelayMs: 1_000,
        maxAttempts: 3,
      },
      ...overrides,
    },
  });

  it("maps all eight operation variants to their exact runtime calls", async () => {
    const record = baseRecord();
    const calls: string[] = [];
    const service = fakeService({
      list: () => [record],
      get: () => record,
      upsert: async () => {
        calls.push("upsert");
        return record;
      },
      remove: async () => {
        calls.push("remove");
      },
      setEnabled: async () => {
        calls.push("setEnabled");
      },
      connect: async () => {
        calls.push("connect");
      },
      disconnect: async () => {
        calls.push("disconnect");
      },
      getTools: () => [{ name: "known", enabled: true }],
      setToolEnabled: async () => {
        calls.push("setToolEnabled");
      },
      setSecrets: async () => {
        calls.push("setSecrets");
      },
      clearOAuth: async () => {
        calls.push("clearOAuth");
      },
    });
    const ctx = contextWith(service);
    const ids = { newId: () => "created", now: () => "now" };
    const operations: Parameters<typeof runMcpOperation>[1][] = [
      serverInput({ serverId: record.id }),
      { kind: "removeServer", serverId: record.id },
      { kind: "setServerEnabled", serverId: record.id, enabled: false },
      { kind: "connectServer", serverId: record.id },
      { kind: "disconnectServer", serverId: record.id },
      {
        kind: "setToolEnabled",
        serverId: record.id,
        toolName: "known",
        enabled: false,
      },
      {
        kind: "setServerSecrets",
        serverId: record.id,
        secrets: [],
      },
      { kind: "clearOAuthTokens", serverId: record.id },
    ];

    for (const operation of operations) {
      await runMcpOperation(ctx, operation, ids);
    }

    expect(calls).toEqual([
      "upsert",
      "remove",
      "setEnabled",
      "connect",
      "disconnect",
      "setToolEnabled",
      "setSecrets",
      "clearOAuth",
    ]);
  });

  it.each<{
    label: string;
    operation: Parameters<typeof runMcpOperation>[1];
    overrides: Partial<McpManagementService>;
    expected: string;
  }>([
    {
      label: "remove",
      operation: { kind: "removeServer", serverId: "server-1" },
      overrides: { remove: async () => { throw new Error(""); } },
      expected: 'MCP server "server-1" could not be removed',
    },
    {
      label: "set enabled",
      operation: {
        kind: "setServerEnabled",
        serverId: "server-1",
        enabled: false,
      },
      overrides: { setEnabled: async () => { throw new Error(""); } },
      expected: 'MCP server "server-1" could not be disabled',
    },
    {
      label: "connect",
      operation: { kind: "connectServer", serverId: "server-1" },
      overrides: { connect: async () => { throw new Error(""); } },
      expected: 'MCP server "server-1" could not connect',
    },
    {
      label: "disconnect",
      operation: { kind: "disconnectServer", serverId: "server-1" },
      overrides: { disconnect: async () => { throw new Error(""); } },
      expected: 'MCP server "server-1" could not disconnect',
    },
    {
      label: "tool toggle",
      operation: {
        kind: "setToolEnabled",
        serverId: "server-1",
        toolName: "known",
        enabled: false,
      },
      overrides: {
        getTools: () => [{ name: "known", enabled: true }],
        setToolEnabled: async () => { throw new Error(""); },
      },
      expected: 'MCP tool "known" on server "server-1" could not be disabled',
    },
    {
      label: "clear OAuth",
      operation: { kind: "clearOAuthTokens", serverId: "server-1" },
      overrides: { clearOAuth: async () => { throw new Error(""); } },
      expected: 'OAuth tokens for MCP server "server-1" could not be cleared',
    },
  ])(
    "normalizes an empty $label rejection before coordinator handling",
    async ({ operation, overrides, expected }) => {
      let caught: Error | undefined;
      try {
        await runMcpOperation(contextWith(fakeService(overrides)), operation);
      } catch (error) {
        caught = error as Error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught?.message).toBe(expected);
      expect(caught?.message.length).toBeGreaterThan(0);
      expect(caught?.message.length).toBeLessThanOrEqual(512);
    },
  );

  it("creates an id and timestamps while omitting fields from the other transport", async () => {
    let stored: McpServerRecordLike | undefined;
    const service = fakeService({
      list: () => [],
      get: (id) => stored?.id === id ? stored : undefined,
      upsert: async (record) => {
        stored = record;
        return record;
      },
    });

    const outcome = await runMcpOperation(
      contextWith(service),
      serverInput({ url: "must-be-omitted" }),
      { newId: () => "generated-id", now: () => "created-now" },
    );

    expect(stored).toEqual({
      id: "generated-id",
      serverName: "Fixture",
      enabled: true,
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      env: { FIRST: "one" },
      cwd: "/workspace",
      auth: { kind: "none" },
      toolCallTimeoutMs: 30_000,
      reconnect: {
        enabled: true,
        initialDelayMs: 100,
        maxDelayMs: 1_000,
        maxAttempts: 3,
      },
      createdAt: "created-now",
      updatedAt: "created-now",
    });
    expect(outcome.detail?.server.id).toBe("generated-id");
    expect(outcome.detail?.server).not.toHaveProperty("url");
  });

  it("uses UUID and ISO timestamp defaults for a create", async () => {
    let stored: McpServerRecordLike | undefined;
    const service = fakeService({
      list: () => [],
      get: (id) => stored?.id === id ? stored : undefined,
      upsert: async (record) => {
        stored = record;
        return record;
      },
    });

    await runMcpOperation(contextWith(service), serverInput());

    expect(stored?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(stored?.createdAt).toBe(stored?.updatedAt);
    expect(new Date(stored!.createdAt).toISOString()).toBe(stored?.createdAt);
  });

  it("edits with preserved creation metadata and disabled tools", async () => {
    const existing = baseRecord({
      createdAt: "original-created",
      disabledTools: ["hidden"],
    });
    let stored: McpServerRecordLike | undefined;
    const service = fakeService({
      get: () => stored ?? existing,
      upsert: async (record) => {
        stored = record;
        return record;
      },
    });

    await runMcpOperation(
      contextWith(service),
      serverInput({
        serverId: existing.id,
        transport: "streamable-http",
        command: "must-be-omitted",
        args: ["must-be-omitted"],
        env: [{ name: "MUST", value: "omit" }],
        cwd: "/must-be-omitted",
        url: "https://mcp.example",
      }),
      { newId: () => "unused", now: () => "edited-now" },
    );

    expect(stored).toEqual(expect.objectContaining({
      id: existing.id,
      transport: "streamable-http",
      url: "https://mcp.example",
      disabledTools: ["hidden"],
      createdAt: "original-created",
      updatedAt: "edited-now",
    }));
    expect(stored).not.toHaveProperty("command");
    expect(stored).not.toHaveProperty("args");
    expect(stored).not.toHaveProperty("env");
    expect(stored).not.toHaveProperty("cwd");
  });

  it("rejects generated-id collisions and unknown edit ids before upsert", async () => {
    const upsert = vi.fn();
    const service = fakeService({
      list: () => [baseRecord({ id: "collision" })],
      get: () => undefined,
      upsert,
    });
    const ctx = contextWith(service);
    const ids = { newId: () => "collision", now: () => "now" };

    await expect(runMcpOperation(ctx, serverInput(), ids)).rejects.toThrow(
      "collision",
    );
    await expect(runMcpOperation(
      ctx,
      serverInput({ serverId: "missing" }),
      ids,
    )).rejects.toThrow("missing");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns fresh detail except after removal", async () => {
    const record = baseRecord();
    const service = fakeService({
      get: () => record,
      getStatus: () => ({ state: "connected", toolCount: 1, connectedAt: "fresh" }),
      getTools: () => [{ name: "known", enabled: true }],
    });
    const ctx = contextWith(service);

    await expect(runMcpOperation(ctx, {
      kind: "connectServer",
      serverId: record.id,
    })).resolves.toEqual({
      detail: expect.objectContaining({
        status: { state: "connected", toolCount: 1, connectedAt: "fresh" },
      }),
    });
    await expect(runMcpOperation(ctx, {
      kind: "removeServer",
      serverId: record.id,
    })).resolves.toEqual({});
  });

  it("rejects unknown tools before the runtime mutation", async () => {
    const setToolEnabled = vi.fn();
    const service = fakeService({
      getTools: () => [{ name: "known", enabled: true }],
      setToolEnabled,
    });

    await expect(runMcpOperation(contextWith(service), {
      kind: "setToolEnabled",
      serverId: "server-1",
      toolName: "unknown",
      enabled: false,
    })).rejects.toThrow("unknown");
    expect(setToolEnabled).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "none" as const }, []],
    [{ kind: "headers" as const, headerNames: ["Authorization", "X-Key"] }, [
      "Authorization",
      "X-Key",
    ]],
    [{
      kind: "oauth" as const,
      clientId: "client",
      authorizeUrl: "https://auth.example/authorize",
      tokenUrl: "https://auth.example/token",
      scopes: ["read"],
      redirectPath: "/oauth/callback",
    }, ["OAUTH_CLIENT_SECRET"]],
  ])("derives writable secret names for $0.kind auth", (auth, names) => {
    expect(writableSecretNamesFor(baseRecord({ auth }))).toEqual(names);
  });

  it("authorizes bulk header secrets and OAuth client secret only", async () => {
    const setSecrets = vi.fn(async () => {});
    const headerRecord = baseRecord({
      auth: { kind: "headers", headerNames: ["Authorization", "X-Key"] },
    });
    const service = fakeService({
      get: () => headerRecord,
      setSecrets,
    });

    await runMcpOperation(contextWith(service), {
      kind: "setServerSecrets",
      serverId: headerRecord.id,
      secrets: [
        { name: "Authorization", value: "first-secret" },
        { name: "X-Key", value: "second-secret" },
      ],
    });
    expect(setSecrets).toHaveBeenCalledWith(headerRecord.id, {
      Authorization: "first-secret",
      "X-Key": "second-secret",
    });

    const oauthRecord = baseRecord({
      auth: {
        kind: "oauth",
        clientId: "client",
        authorizeUrl: "https://auth.example/authorize",
        tokenUrl: "https://auth.example/token",
        scopes: ["read"],
        redirectPath: "/oauth/callback",
      },
    });
    service.get = () => oauthRecord;
    await runMcpOperation(contextWith(service), {
      kind: "setServerSecrets",
      serverId: oauthRecord.id,
      secrets: [{ name: "OAUTH_CLIENT_SECRET", value: "client-secret" }],
    });
    expect(setSecrets).toHaveBeenLastCalledWith(oauthRecord.id, {
      OAUTH_CLIENT_SECRET: "client-secret",
    });
  });

  it.each([
    ["none", { kind: "none" as const }, "Authorization"],
    [
      "undeclared header",
      { kind: "headers" as const, headerNames: ["Authorization"] },
      "X-Key",
    ],
    [
      "OAuth access",
      {
        kind: "oauth" as const,
        clientId: "client",
        authorizeUrl: "https://auth.example/authorize",
        tokenUrl: "https://auth.example/token",
        scopes: [],
        redirectPath: "/oauth/callback",
      },
      "OAUTH_ACCESS",
    ],
    [
      "OAuth refresh",
      {
        kind: "oauth" as const,
        clientId: "client",
        authorizeUrl: "https://auth.example/authorize",
        tokenUrl: "https://auth.example/token",
        scopes: [],
        redirectPath: "/oauth/callback",
      },
      "OAUTH_REFRESH",
    ],
    [
      "OAuth expiry",
      {
        kind: "oauth" as const,
        clientId: "client",
        authorizeUrl: "https://auth.example/authorize",
        tokenUrl: "https://auth.example/token",
        scopes: [],
        redirectPath: "/oauth/callback",
      },
      "OAUTH_EXPIRES_AT",
    ],
  ])("rejects unauthorized secret names for %s", async (_label, auth, name) => {
    const setSecrets = vi.fn();
    const record = baseRecord({ auth });
    await expect(runMcpOperation(contextWith(fakeService({
      get: () => record,
      setSecrets,
    })), {
      kind: "setServerSecrets",
      serverId: record.id,
      secrets: [{ name, value: "fixture-secret" }],
    })).rejects.toThrow(name);
    expect(setSecrets).not.toHaveBeenCalled();
  });

  it("redacts plugin text and submitted values from secret failures", async () => {
    const record = baseRecord({
      auth: { kind: "headers", headerNames: ["Authorization"] },
    });
    const literal = "fixture-secret";
    const pluginText = `plugin echoed ${literal}`;

    await expect(runMcpOperation(contextWith(fakeService({
      get: () => record,
      setSecrets: async () => {
        throw new Error(pluginText);
      },
    })), {
      kind: "setServerSecrets",
      serverId: record.id,
      secrets: [{ name: "Authorization", value: literal }],
    })).rejects.toSatisfy((error: Error) => (
      error.message.includes(record.id)
      && error.message.includes("Authorization")
      && !error.message.includes(literal)
      && !error.message.includes(pluginText)
    ));
  });

  it("aborts before secrets on record failure and retries only secrets afterward", async () => {
    const record = baseRecord({
      auth: { kind: "headers", headerNames: ["Authorization"] },
    });
    let stored: McpServerRecordLike | undefined;
    const upsert = vi.fn(async (candidate: McpServerRecordLike) => {
      if (candidate.serverName === "Rejected") throw new Error("bad record");
      stored = candidate;
      return candidate;
    });
    let secretAttempts = 0;
    const setSecrets = vi.fn(async () => {
      secretAttempts += 1;
      if (secretAttempts === 1) throw new Error("plugin echoed fixture-secret");
    });
    const service = fakeService({
      list: () => stored === undefined ? [] : [stored],
      get: (id) => stored?.id === id ? stored : undefined,
      upsert,
      setSecrets,
    });
    const ctx = contextWith(service);
    const ids = { newId: () => record.id, now: () => "now" };

    await expect(runMcpOperation(
      ctx,
      serverInput({ serverName: "Rejected", auth: record.auth }),
      ids,
    )).rejects.toThrow("bad record");
    expect(setSecrets).not.toHaveBeenCalled();

    await runMcpOperation(
      ctx,
      serverInput({ auth: record.auth }),
      ids,
    );
    const secretOperation = {
      kind: "setServerSecrets" as const,
      serverId: record.id,
      secrets: [{ name: "Authorization", value: "fixture-secret" }],
    };
    await expect(runMcpOperation(ctx, secretOperation)).rejects.toThrow(
      "Authorization",
    );
    await runMcpOperation(ctx, secretOperation);

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(setSecrets).toHaveBeenCalledTimes(2);
  });

  it("bounds record rejection text through the shared truncation helper", async () => {
    await expect(runMcpOperation(contextWith(fakeService({
      upsert: async () => {
        throw new Error("x".repeat(513));
      },
    })), serverInput(), {
      newId: () => "created",
      now: () => "now",
    })).rejects.toThrow("x".repeat(512));
  });

  it("never calls OAuth authorization surfaces from a record operation", async () => {
    const clearOAuth = vi.fn(async () => {});
    const startOAuth = vi.fn();
    const discoverOAuth = vi.fn();
    const service = {
      ...fakeService({ clearOAuth }),
      startOAuth,
      discoverOAuth,
    };

    await runMcpOperation(contextWith(service), {
      kind: "clearOAuthTokens",
      serverId: "server-1",
    });

    expect(clearOAuth).toHaveBeenCalledWith("server-1");
    expect(startOAuth).not.toHaveBeenCalled();
    expect(discoverOAuth).not.toHaveBeenCalled();
  });

  it("refuses provision when discovery returns no client id", async () => {
    const upsert = vi.fn();
    const startOAuth = vi.fn();

    await expect(runMcpOperation(contextWith(fakeService({
      upsert,
      startOAuth,
      oauthRedirectOrigin: () => "http://127.0.0.1:9",
      discoverOAuth: async () => ({
        clientId: "",
        authorizeUrl: "https://auth.example/authorize",
        tokenUrl: "https://auth.example/token",
        scopes: [],
        registered: false,
      }),
    })), {
      kind: "provisionOAuthServer",
      serverName: "Glean",
      url: "https://mcp.example/rpc",
      enabled: true,
    })).rejects.toThrow(
      "OAuth discovery filled endpoints but registered no client ID. Enter a client ID under Advanced.",
    );
    expect(upsert).not.toHaveBeenCalled();
    expect(startOAuth).not.toHaveBeenCalled();
  });

  it.each([
    ["absent", {}],
    ["undefined", { oauthRedirectOrigin: () => undefined }],
    ["empty", { oauthRedirectOrigin: () => "" }],
  ])(
    "refuses provision without upsert when the callback origin is %s",
    async (_label, originOverride) => {
      const upsert = vi.fn();
      const discoverOAuth = vi.fn(async () => ({
        clientId: "issued",
        authorizeUrl: "https://auth.example/authorize",
        tokenUrl: "https://auth.example/token",
        scopes: [],
        registered: true,
      }));
      const startOAuth = vi.fn(async () => ({
        authorizeUrl: "https://auth.example/authorize",
      }));

      await expect(runMcpOperation(contextWith(fakeService({
        upsert,
        discoverOAuth,
        startOAuth,
        ...originOverride,
      })), {
        kind: "provisionOAuthServer",
        serverName: "Glean",
        url: "https://mcp.example/rpc",
        enabled: true,
      })).rejects.toThrow(
        "The mounted MCP plugin cannot authorize OAuth servers in this profile",
      );
      expect(upsert).not.toHaveBeenCalled();
      expect(discoverOAuth).not.toHaveBeenCalled();
      expect(startOAuth).not.toHaveBeenCalled();
    },
  );

  it("provisions OAuth and returns its authorize URL without its secret", async () => {
    let stored: McpServerRecordLike | undefined;
    const calls: string[] = [];
    const upsert = vi.fn(async (record: McpServerRecordLike) => {
      calls.push("upsert");
      stored = record;
      return record;
    });
    const setSecrets = vi.fn(async () => {
      calls.push("setSecrets");
    });
    const startOAuth = vi.fn(async () => {
      calls.push("startOAuth");
      return {
        authorizeUrl: "https://auth.example/authorize?client_id=issued",
      };
    });

    const outcome = await runMcpOperation(contextWith(fakeService({
      list: () => stored === undefined ? [] : [stored],
      get: (id) => stored?.id === id ? stored : undefined,
      upsert,
      setSecrets,
      startOAuth,
      oauthRedirectOrigin: () => "http://127.0.0.1:9",
      discoverOAuth: async () => {
        calls.push("discoverOAuth");
        return {
          clientId: "issued",
          authorizeUrl: "https://auth.example/authorize",
          tokenUrl: "https://auth.example/token",
          scopes: ["mcp"],
          registered: true,
          clientSecret: "dynamic-secret",
        };
      },
    })), {
      kind: "provisionOAuthServer",
      serverName: "Glean",
      url: "https://mcp.example/rpc",
      enabled: true,
    }, {
      newId: () => "new-id",
      now: () => "now",
    });

    expect(stored).toEqual(expect.objectContaining({
      id: "new-id",
      serverName: "Glean",
      enabled: true,
      transport: "streamable-http",
      url: "https://mcp.example/rpc",
      auth: {
        kind: "oauth",
        clientId: "issued",
        authorizeUrl: "https://auth.example/authorize",
        tokenUrl: "https://auth.example/token",
        scopes: ["mcp"],
        redirectPath: "/callback",
      },
      toolCallTimeoutMs: 30_000,
      reconnect: {
        enabled: true,
        initialDelayMs: 1_000,
        maxDelayMs: 30_000,
        maxAttempts: 5,
      },
    }));
    expect(setSecrets).toHaveBeenCalledWith("new-id", {
      OAUTH_CLIENT_SECRET: "dynamic-secret",
    });
    expect(startOAuth).toHaveBeenCalledWith("new-id");
    expect(calls).toEqual([
      "discoverOAuth",
      "upsert",
      "setSecrets",
      "startOAuth",
    ]);
    expect(outcome.authorizeUrl).toBe(
      "https://auth.example/authorize?client_id=issued",
    );
    expect(JSON.stringify(outcome)).not.toContain("dynamic-secret");
  });

  it("uses the generic secret error when provision cannot store registration secret", async () => {
    let stored: McpServerRecordLike | undefined;
    const pluginText = "plugin echoed dynamic-secret";
    const startOAuth = vi.fn();

    await expect(runMcpOperation(contextWith(fakeService({
      list: () => stored === undefined ? [] : [stored],
      get: (id) => stored?.id === id ? stored : undefined,
      upsert: async (record) => {
        stored = record;
        return record;
      },
      setSecrets: async () => {
        throw new Error(pluginText);
      },
      startOAuth,
      oauthRedirectOrigin: () => "http://127.0.0.1:9",
      discoverOAuth: async () => ({
        clientId: "issued",
        authorizeUrl: "https://auth.example/authorize",
        tokenUrl: "https://auth.example/token",
        scopes: [],
        registered: true,
        clientSecret: "dynamic-secret",
      }),
    })), {
      kind: "provisionOAuthServer",
      serverName: "Glean",
      url: "https://mcp.example/rpc",
      enabled: true,
    }, {
      newId: () => "new-id",
      now: () => "now",
    })).rejects.toSatisfy((error: Error) => (
      error.message ===
        'Could not store MCP secrets for server "new-id": OAUTH_CLIENT_SECRET'
      && !error.message.includes(pluginText)
      && !error.message.includes("dynamic-secret")
    ));
    expect(startOAuth).not.toHaveBeenCalled();
  });

  it("returns the plugin authorize URL for an existing server", async () => {
    const startOAuth = vi.fn(async () => ({
      authorizeUrl: "https://auth.example/authorize",
    }));

    await expect(runMcpOperation(contextWith(fakeService({
      startOAuth,
      oauthRedirectOrigin: () => "http://127.0.0.1:9",
    })), {
      kind: "startOAuth",
      serverId: "server-1",
    })).resolves.toMatchObject({
      authorizeUrl: "https://auth.example/authorize",
      detail: expect.objectContaining({
        server: expect.objectContaining({ id: "server-1" }),
      }),
    });
    expect(startOAuth).toHaveBeenCalledWith("server-1");
  });
});

describe("MCP OAuth discovery", () => {
  const discovered = {
    clientId: "issued-client",
    authorizeUrl: "https://auth.example/authorize",
    tokenUrl: "https://auth.example/token",
    scopes: ["docs:read"],
    registered: true,
  };

  it("projects the plugin's non-secret discovery fields", async () => {
    const discoverOAuth = vi.fn(async () => discovered);
    await expect(
      discoverMcpOAuth(
        contextWith(fakeService({ discoverOAuth })),
        "https://mcp.example/rpc",
      ),
    ).resolves.toEqual({
      clientId: "issued-client",
      authorizeUrl: "https://auth.example/authorize",
      tokenUrl: "https://auth.example/token",
      scopes: ["docs:read"],
      registered: true,
      clientSecretIssued: false,
    });
    expect(discoverOAuth).toHaveBeenCalledWith("https://mcp.example/rpc");
  });

  it("reports a registration secret without forwarding its value", async () => {
    const result = await discoverMcpOAuth(
      contextWith(fakeService({
        discoverOAuth: async () => ({
          ...discovered,
          clientSecret: "fixture-secret",
        }),
      })),
      "https://mcp.example/rpc",
    );

    expect(result.clientSecretIssued).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    expect(isSettingsOutboundMessage({
      kind: "mcpOAuthDiscovery",
      requestId: "disc1",
      result: { ok: true, discovery: result },
    })).toBe(true);
  });

  it("keeps an unregistered discovery's empty client id", async () => {
    await expect(
      discoverMcpOAuth(
        contextWith(fakeService({
          discoverOAuth: async () => ({
            ...discovered,
            clientId: "",
            registered: false,
          }),
        })),
        "https://mcp.example/rpc",
      ),
    ).resolves.toMatchObject({ clientId: "", registered: false });
  });

  it("refuses when the mounted plugin exposes no discovery entry point", async () => {
    await expect(
      discoverMcpOAuth(contextWith(fakeService()), "https://mcp.example/rpc"),
    ).rejects.toThrow(/does not support OAuth discovery/);
  });

  it("refuses when no MCP service is mounted", async () => {
    await expect(
      discoverMcpOAuth(contextWith(), "https://mcp.example/rpc"),
    ).rejects.toThrow(/not available/);
  });

  it("normalizes an empty discovery rejection", async () => {
    await expect(
      discoverMcpOAuth(
        contextWith(fakeService({
          discoverOAuth: async () => {
            throw new Error("");
          },
        })),
        "https://mcp.example/rpc",
      ),
    ).rejects.toThrow("OAuth discovery for https://mcp.example/rpc failed");
  });

  it("rejects endpoints the wire contract would refuse", async () => {
    await expect(
      discoverMcpOAuth(
        contextWith(fakeService({
          discoverOAuth: async () => ({ ...discovered, authorizeUrl: "" }),
        })),
        "https://mcp.example/rpc",
      ),
    ).rejects.toThrow(/authorize URL/);
    await expect(
      discoverMcpOAuth(
        contextWith(fakeService({
          discoverOAuth: async () => ({
            ...discovered,
            scopes: Array.from({ length: 33 }, (_, index) => `scope-${index}`),
          }),
        })),
        "https://mcp.example/rpc",
      ),
    ).rejects.toThrow("32");
  });
});

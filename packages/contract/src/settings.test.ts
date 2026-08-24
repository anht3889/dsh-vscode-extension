import { describe, it, expect } from "vitest";
import {
  isMcpServerInputWire,
  isSettingsInboundCommand,
  isSettingsOutboundMessage,
  MAX_MCP_ARGS,
  MAX_MCP_DISABLED_TOOLS,
  MAX_MCP_ENV_ENTRIES,
  MAX_MCP_HEADER_NAMES,
  MAX_MCP_LOG_DETAIL_LENGTH,
  MAX_MCP_LOG_ENTRIES,
  MAX_MCP_LOG_MESSAGE_LENGTH,
  MAX_MCP_SCOPES,
  MAX_MCP_SECRET_ENTRIES,
  MAX_MCP_SERVERS,
  MAX_MCP_TOOLS,
  MAX_SECRET_VALUE_LENGTH,
  MAX_WIRE_IDENTIFIER_LENGTH,
  MAX_WIRE_URL_LENGTH,
  OPTIONAL_SETTINGS_SECTION_IDS,
  SETTINGS_WIRE_SCAN_NODE_LIMIT,
} from "./settings.js";
import { isInboundMessage, isOutboundMessage } from "./protocol.js";

const generalNamespace = {
  namespace: "permission",
  revision: 0,
  applies: "live" as const,
  writable: true,
  base: {},
  user: {},
  value: { defaultPreset: "workspace-write" },
  secrets: [],
};

const mcpReconnect = {
  enabled: true,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 5,
};

const mcpServerInput = {
  serverName: "docs",
  enabled: true,
  transport: "stdio" as const,
  command: "mcp-docs",
  args: ["--stdio"],
  env: [{ name: "DOCS_ROOT", value: "/tmp/docs" }],
  cwd: "/tmp",
  auth: { kind: "none" as const },
  toolCallTimeoutMs: 30_000,
  reconnect: mcpReconnect,
};

const mcpServer = {
  id: "docs-id",
  ...mcpServerInput,
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
};

const mcpDetail = {
  server: mcpServer,
  status: {
    state: "connected" as const,
    toolCount: 1,
    connectedAt: "2026-08-23T00:00:00.000Z",
  },
  tools: [{ name: "search", description: "Search docs", enabled: true }],
  secrets: { kind: "known" as const, secrets: [] },
};

const webSearchView = {
  section: "web-search" as const,
  engine: "tavily" as const,
  engines: [{
    engine: "tavily" as const,
    defaultBaseURL: "https://api.tavily.com",
    baseURLRequired: false,
    secretRef: "TAVILY_API_KEY" as const,
  }],
  secrets: [{ ref: "TAVILY_API_KEY" as const, configured: true, writable: true }],
  available: true,
};

function makeMcpListItem(index: number, status: object = { state: "disconnected" }) {
  return {
    server: {
      id: `server-${index}`,
      serverName: `Server ${index}`,
      enabled: true,
      transport: "stdio",
      command: "mcp-server",
      args: ["--stdio"],
      env: [{ name: "SERVER_INDEX", value: String(index) }],
      cwd: "/tmp",
      auth: { kind: "none" },
      disabledTools: [],
      toolCallTimeoutMs: 30_000,
      reconnect: {
        enabled: true,
        initialDelayMs: 500,
        maxDelayMs: 30_000,
        maxAttempts: 5,
      },
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T00:00:00.000Z",
    },
    status,
    toolCount: 0,
    disabledToolCount: 0,
  };
}

describe("Protocol v6 settings constants", () => {
  it("exports the optional section order and exact safety bounds", () => {
    expect(OPTIONAL_SETTINGS_SECTION_IDS).toEqual(["mcp", "web-search"]);
    expect({
      MAX_MCP_SERVERS,
      MAX_MCP_TOOLS,
      MAX_MCP_LOG_ENTRIES,
      MAX_MCP_ARGS,
      MAX_MCP_ENV_ENTRIES,
      MAX_MCP_HEADER_NAMES,
      MAX_MCP_SCOPES,
      MAX_MCP_DISABLED_TOOLS,
      MAX_MCP_SECRET_ENTRIES,
      MAX_WIRE_IDENTIFIER_LENGTH,
      MAX_WIRE_URL_LENGTH,
      MAX_MCP_LOG_MESSAGE_LENGTH,
      MAX_MCP_LOG_DETAIL_LENGTH,
      MAX_SECRET_VALUE_LENGTH,
    }).toEqual({
      MAX_MCP_SERVERS: 64,
      MAX_MCP_TOOLS: 256,
      MAX_MCP_LOG_ENTRIES: 512,
      MAX_MCP_ARGS: 64,
      MAX_MCP_ENV_ENTRIES: 64,
      MAX_MCP_HEADER_NAMES: 32,
      MAX_MCP_SCOPES: 32,
      MAX_MCP_DISABLED_TOOLS: 256,
      MAX_MCP_SECRET_ENTRIES: 32,
      MAX_WIRE_IDENTIFIER_LENGTH: 1_024,
      MAX_WIRE_URL_LENGTH: 2_048,
      MAX_MCP_LOG_MESSAGE_LENGTH: 2_048,
      MAX_MCP_LOG_DETAIL_LENGTH: 4_096,
      MAX_SECRET_VALUE_LENGTH: 8_192,
    });
  });
});

describe("isSettingsInboundCommand", () => {
  it("accepts all Protocol v6 settings commands", () => {
    expect(isSettingsInboundCommand({
      kind: "getSettingsCapabilities",
      requestId: "c1",
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "getMcpServer",
      requestId: "d1",
      serverId: "docs-id",
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "getMcpLogs",
      requestId: "l1",
      serverId: "docs-id",
      after: 0,
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: { kind: "upsertServer", server: mcpServerInput },
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "setWebSearchConfig",
      requestId: "w1",
      catalog: {
        engine: "searxng",
        engines: [{ engine: "searxng", baseURL: "https://searx.example" }],
      },
      secrets: [{ ref: "TAVILY_API_KEY", value: "tvly-x" }],
    })).toBe(true);
  });

  it("accepts every MCP operation variant", () => {
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "remove",
      operation: { kind: "removeServer", serverId: "docs-id" },
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "enable",
      operation: {
        kind: "setServerEnabled",
        serverId: "docs-id",
        enabled: false,
      },
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "disconnect",
      operation: { kind: "disconnectServer", serverId: "docs-id" },
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "tool",
      operation: {
        kind: "setToolEnabled",
        serverId: "docs-id",
        toolName: "search",
        enabled: true,
      },
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "secret",
      operation: {
        kind: "setServerSecrets",
        serverId: "docs-id",
        secrets: [{ name: "X-API-Key", value: "write-only" }],
      },
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "oauth",
      operation: { kind: "clearOAuthTokens", serverId: "docs-id" },
    })).toBe(true);
  });

  it("accepts headers, OAuth, and streamable-http server inputs", () => {
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "headers",
      operation: {
        kind: "upsertServer",
        server: {
          ...mcpServerInput,
          auth: { kind: "headers", headerNames: ["X-API-Key"] },
        },
      },
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "oauth",
      operation: {
        kind: "upsertServer",
        server: {
          ...mcpServerInput,
          auth: {
            kind: "oauth",
            clientId: "docs-client",
            authorizeUrl: "https://auth.example/authorize",
            tokenUrl: "https://auth.example/token",
            scopes: ["docs:read"],
            redirectPath: "/oauth/callback",
          },
        },
      },
    })).toBe(true);
    const {
      command: _command,
      args: _args,
      env: _env,
      cwd: _cwd,
      ...httpInput
    } = mcpServerInput;
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "http",
      operation: {
        kind: "upsertServer",
        server: {
          ...httpInput,
          transport: "streamable-http",
          url: "https://mcp.example/rpc",
        },
      },
    })).toBe(true);
  });

  it("rejects malformed capability and section commands", () => {
    expect(isSettingsInboundCommand({
      kind: "getSettingsCapabilities",
      requestId: "",
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "getSettingsCapabilities",
      requestId: "c1",
      extra: true,
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "getSettingsSection",
      requestId: "s1",
      section: "mcp-servers",
    })).toBe(false);
  });

  it("rejects malformed MCP log cursors", () => {
    expect(isSettingsInboundCommand({
      kind: "getMcpLogs", requestId: "l1", serverId: "docs-id", after: -1,
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "getMcpLogs", requestId: "l1", serverId: "docs-id", after: 1.5,
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "getMcpLogs", requestId: "l1", serverId: "docs-id", after: "0",
    })).toBe(false);
  });

  it("rejects mixed MCP auth and transport variants", () => {
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: {
        kind: "upsertServer",
        server: { ...mcpServerInput, auth: { kind: "none", clientId: "x" } },
      },
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: {
        kind: "upsertServer",
        server: { ...mcpServerInput, auth: { kind: "headers", scopes: [] } },
      },
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: {
        kind: "upsertServer",
        server: { ...mcpServerInput, url: "https://mcp.example" },
      },
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: {
        kind: "upsertServer",
        server: {
          ...mcpServerInput,
          transport: "streamable-http",
          url: "https://mcp.example",
        },
      },
    })).toBe(false);
  });

  it("rejects invalid MCP numeric fields", () => {
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: {
        kind: "upsertServer",
        server: { ...mcpServerInput, toolCallTimeoutMs: 0 },
      },
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: {
        kind: "upsertServer",
        server: { ...mcpServerInput, toolCallTimeoutMs: 1.5 },
      },
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: {
        kind: "upsertServer",
        server: {
          ...mcpServerInput,
          reconnect: { ...mcpReconnect, maxAttempts: -1 },
        },
      },
    })).toBe(false);
  });

  it("rejects MCP collections and strings over their caps", () => {
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: {
        kind: "upsertServer",
        server: { ...mcpServerInput, args: Array(MAX_MCP_ARGS + 1).fill("x") },
      },
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: {
        kind: "upsertServer",
        server: {
          ...mcpServerInput,
          env: Array.from(
            { length: MAX_MCP_ENV_ENTRIES + 1 },
            (_, index) => ({ name: `KEY_${index}`, value: "x" }),
          ),
        },
      },
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: {
        kind: "upsertServer",
        server: {
          ...mcpServerInput,
          auth: {
            kind: "oauth",
            clientId: "client",
            authorizeUrl: "https://auth.example/authorize",
            tokenUrl: "https://auth.example/token",
            scopes: Array(MAX_MCP_SCOPES + 1).fill("read"),
            redirectPath: "/callback",
          },
        },
      },
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: {
        kind: "upsertServer",
        server: {
          ...mcpServerInput,
          auth: {
            kind: "headers",
            headerNames: Array(MAX_MCP_HEADER_NAMES + 1).fill("X-Key"),
          },
        },
      },
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: {
        kind: "upsertServer",
        server: { ...mcpServerInput, serverName: "x".repeat(MAX_WIRE_IDENTIFIER_LENGTH + 1) },
      },
    })).toBe(false);
    const { command: _command, args: _args, env: _env, cwd: _cwd, ...httpInput } = mcpServerInput;
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: {
        kind: "upsertServer",
        server: {
          ...httpInput,
          transport: "streamable-http",
          url: "x".repeat(MAX_WIRE_URL_LENGTH + 1),
        },
      },
    })).toBe(false);
  });

  it("rejects malformed MCP secret operations and unknown operations", () => {
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: {
        kind: "setServerSecrets",
        serverId: "docs-id",
        secrets: Array.from(
          { length: MAX_MCP_SECRET_ENTRIES + 1 },
          (_, index) => ({ name: `SECRET_${index}`, value: "x" }),
        ),
      },
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: {
        kind: "setServerSecrets",
        serverId: "docs-id",
        secrets: [{ name: "KEY", value: "x".repeat(MAX_SECRET_VALUE_LENGTH + 1) }],
      },
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: {
        kind: "setServerSecrets",
        serverId: "docs-id",
        secrets: [{ name: "KEY", value: "" }],
      },
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: { kind: "restartServer", serverId: "docs-id" },
    })).toBe(false);
  });

  it("rejects malformed Web Search configuration", () => {
    expect(isSettingsInboundCommand({
      kind: "setWebSearchConfig",
      requestId: "w1",
      catalog: { engine: "google", engines: [] },
      secrets: [],
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "setWebSearchConfig",
      requestId: "w1",
      catalog: {
        engine: "searxng",
        engines: [
          { engine: "searxng", baseURL: "https://one.example" },
          { engine: "searxng", baseURL: "https://two.example" },
        ],
      },
      secrets: [],
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "setWebSearchConfig",
      requestId: "w1",
      catalog: {
        engine: "searxng",
        engines: [{ engine: "searxng", baseURL: "x".repeat(MAX_WIRE_URL_LENGTH + 1) }],
      },
      secrets: [],
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "setWebSearchConfig",
      requestId: "w1",
      catalog: { engine: "tavily", engines: [] },
      secrets: [{ ref: "OTHER_KEY", value: "x" }],
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "setWebSearchConfig",
      requestId: "w1",
      catalog: { engine: "tavily", engines: [] },
      secrets: [{ ref: "TAVILY_API_KEY", value: "" }],
    })).toBe(false);
  });
  it("accepts getSettingsSection", () => {
    expect(isSettingsInboundCommand({
      kind: "getSettingsSection",
      requestId: "s1",
      section: "general",
    })).toBe(true);
  });

  it("accepts mutateSettings", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 3,
      ops: [{ op: "set", path: ["defaultPreset"], value: "workspace-write" }],
    })).toBe(true);
  });

  it("accepts setCredential and unsetCredential", () => {
    expect(isSettingsInboundCommand({
      kind: "setCredential",
      requestId: "c1",
      ref: "DEEPSEEK_API_KEY",
      value: "sk-secret",
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "unsetCredential",
      requestId: "c2",
      ref: "DEEPSEEK_API_KEY",
    })).toBe(true);
  });

  it("accepts preset commands", () => {
    expect(isSettingsInboundCommand({
      kind: "copyAgentPreset",
      requestId: "p1",
      fromPresetId: "standard",
      presetId: "my-copy",
      name: "My Copy",
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "deleteAgentPreset",
      requestId: "p2",
      presetId: "mine",
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "readAgentPreset",
      requestId: "p3",
      presetId: "standard",
    })).toBe(true);
  });

  it("accepts resolveSettingsPath targets without arbitrary paths", () => {
    expect(isSettingsInboundCommand({
      kind: "resolveSettingsPath",
      requestId: "r1",
      target: { kind: "dsh-home" },
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "resolveSettingsPath",
      requestId: "r2",
      target: { kind: "settings-document", prepare: true },
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "resolveSettingsPath",
      requestId: "r3",
      target: { kind: "agent-preset", presetId: "mine" },
    })).toBe(true);
  });

  it("rejects empty request ids", () => {
    expect(isSettingsInboundCommand({
      kind: "getSettingsSection",
      requestId: "",
      section: "general",
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "",
      namespace: "permission",
      expectedRevision: 0,
      ops: [],
    })).toBe(false);
  });

  it("rejects mutateSettings with empty ops", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m-empty",
      namespace: "permission",
      expectedRevision: 0,
      ops: [],
    })).toBe(false);
  });

  it("rejects unknown sections", () => {
    expect(isSettingsInboundCommand({
      kind: "getSettingsSection",
      requestId: "s1",
      section: "extension",
    })).toBe(false);
  });

  it("rejects namespace names outside kebab-case", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "Permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"], value: "x" }],
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "bad_name",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"], value: "x" }],
    })).toBe(false);
  });

  it("rejects negative and non-integer revisions", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: -1,
      ops: [{ op: "set", path: ["defaultPreset"], value: "x" }],
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 1.5,
      ops: [{ op: "set", path: ["defaultPreset"], value: "x" }],
    })).toBe(false);
  });

  it("rejects empty paths and forbidden object keys", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: [], value: "x" }],
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "unset", path: [""] }],
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["__proto__"], value: "x" }],
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"], value: { constructor: "x" } }],
    })).toBe(false);
  });

  it("rejects malformed operation tags", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "replace", path: ["defaultPreset"], value: "x" }],
    })).toBe(false);
  });

  it("rejects empty credential values and invalid credential refs", () => {
    expect(isSettingsInboundCommand({
      kind: "setCredential",
      requestId: "c1",
      ref: "DEEPSEEK_API_KEY",
      value: "",
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "setCredential",
      requestId: "c1",
      ref: "bad-ref",
      value: "secret",
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "unsetCredential",
      requestId: "c1",
      ref: "also-bad",
    })).toBe(false);
  });

  it("rejects invalid preset ids", () => {
    expect(isSettingsInboundCommand({
      kind: "copyAgentPreset",
      requestId: "p1",
      fromPresetId: "standard",
      presetId: "Bad-ID",
      name: "Copy",
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "copyAgentPreset",
      requestId: "p1",
      fromPresetId: "Bad-ID",
      presetId: "copy",
      name: "Copy",
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "deleteAgentPreset",
      requestId: "p1",
      presetId: "",
    })).toBe(false);
  });

  it("rejects arbitrary path strings on inbound messages", () => {
    expect(isSettingsInboundCommand({
      kind: "resolveSettingsPath",
      requestId: "r1",
      target: { kind: "dsh-home" },
      path: "/etc/passwd",
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: "defaultPreset", value: "x" }],
    })).toBe(false);
  });

  it("rejects extra fields on mutation ops and resolve targets", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"], value: "x", extra: true }],
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "resolveSettingsPath",
      requestId: "r1",
      target: { kind: "dsh-home", path: "/etc/passwd" },
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "resolveSettingsPath",
      requestId: "r2",
      target: { kind: "settings-document", prepare: true, path: "/tmp" },
    })).toBe(false);
  });

  it("rejects set ops missing an own value property", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"] }],
    })).toBe(false);
  });

  it("accepts set ops whose own value is explicitly undefined or null", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"], value: undefined }],
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"], value: null }],
    })).toBe(true);
  });

  it("rejects cyclic and over-deep mutation values fail closed", () => {
    const cyclic: Record<string, unknown> = { label: "loop" };
    cyclic.self = cyclic;
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"], value: cyclic }],
    })).toBe(false);

    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 40; i += 1) {
      deep = { nested: deep };
    }
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"], value: deep }],
    })).toBe(false);
  });
});

describe("isSettingsOutboundMessage", () => {
  it("accepts all Protocol v6 settings messages", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsCapabilities",
      sections: ["mcp", "web-search"],
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsCapabilities",
      requestId: "c1",
      sections: ["mcp"],
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "mcpServer",
      requestId: "d1",
      result: { ok: true, detail: mcpDetail },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "mcpLogs",
      requestId: "l1",
      result: {
        ok: true,
        serverId: "docs-id",
        next: 1,
        entries: [{
          at: "2026-08-23T00:00:00.000Z",
          level: "info",
          message: "connected",
        }],
      },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "mcpOperation",
      requestId: "o1",
      result: { ok: true, detail: mcpDetail },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "webSearchMutation",
      requestId: "w1",
      result: {
        ok: true,
        view: webSearchView,
        secretFailures: [{
          ref: "BRAVE_API_KEY",
          message: "Could not store BRAVE_API_KEY",
        }],
      },
    })).toBe(true);
  });

  it("accepts every MCP status and secret-state variant", () => {
    expect(isSettingsOutboundMessage({
      kind: "mcpServer",
      requestId: "connecting",
      result: {
        ok: true,
        detail: {
          ...mcpDetail,
          status: { state: "connecting", attempt: 1 },
        },
      },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "mcpServer",
      requestId: "reconnecting",
      result: {
        ok: true,
        detail: {
          ...mcpDetail,
          status: { state: "reconnecting", attempt: 2, nextDelayMs: 1_000 },
        },
      },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "mcpServer",
      requestId: "failed",
      result: {
        ok: true,
        detail: {
          ...mcpDetail,
          status: {
            state: "failed",
            error: "Connection refused",
            at: "2026-08-23T00:01:00.000Z",
          },
        },
      },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "mcpServer",
      requestId: "unknown-secrets",
      result: {
        ok: true,
        detail: {
          ...mcpDetail,
          secrets: { kind: "unknown" },
        },
      },
    })).toBe(true);
  });

  it("accepts headers, OAuth, and streamable-http server details", () => {
    expect(isSettingsOutboundMessage({
      kind: "mcpServer",
      requestId: "headers",
      result: {
        ok: true,
        detail: {
          ...mcpDetail,
          server: {
            ...mcpServer,
            auth: { kind: "headers", headerNames: ["X-API-Key"] },
          },
        },
      },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "mcpServer",
      requestId: "oauth",
      result: {
        ok: true,
        detail: {
          ...mcpDetail,
          server: {
            ...mcpServer,
            auth: {
              kind: "oauth",
              clientId: "docs-client",
              authorizeUrl: "https://auth.example/authorize",
              tokenUrl: "https://auth.example/token",
              scopes: ["docs:read"],
              redirectPath: "/oauth/callback",
            },
          },
        },
      },
    })).toBe(true);
    const {
      command: _command,
      args: _args,
      env: _env,
      cwd: _cwd,
      ...httpServer
    } = mcpServer;
    expect(isSettingsOutboundMessage({
      kind: "mcpServer",
      requestId: "http",
      result: {
        ok: true,
        detail: {
          ...mcpDetail,
          server: {
            ...httpServer,
            transport: "streamable-http",
            url: "https://mcp.example/rpc",
          },
        },
      },
    })).toBe(true);
  });

  it("accepts both new optional settings section views", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "mcp",
      view: {
        section: "mcp",
        servers: [{
          server: mcpServer,
          status: { state: "disconnected" },
          toolCount: 0,
          disabledToolCount: 0,
        }],
        secretStates: "available",
        oauth: { kind: "manual", reason: "no-callback-origin" },
      },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "web-search",
      view: webSearchView,
    })).toBe(true);
  });

  it("rejects malformed capability announcements", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsCapabilities",
      sections: ["mcp", "mcp"],
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsCapabilities",
      sections: ["general"],
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsCapabilities",
      requestId: "",
      sections: ["mcp"],
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsCapabilities",
      sections: ["mcp"],
      extra: true,
    })).toBe(false);
  });

  it("rejects malformed MCP server detail records", () => {
    expect(isSettingsOutboundMessage({
      kind: "mcpServer",
      requestId: "d1",
      result: {
        ok: true,
        detail: {
          ...mcpDetail,
          status: { state: "connected", attempt: 1 },
        },
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "mcpServer",
      requestId: "d1",
      result: {
        ok: true,
        detail: {
          ...mcpDetail,
          server: {
            ...mcpServer,
            disabledTools: Array(MAX_MCP_DISABLED_TOOLS + 1).fill("search"),
          },
        },
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "mcpServer",
      requestId: "d1",
      result: {
        ok: true,
        detail: {
          ...mcpDetail,
          tools: Array.from(
            { length: MAX_MCP_TOOLS + 1 },
            (_, index) => ({ name: `tool-${index}`, description: "", enabled: true }),
          ),
        },
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "mcpServer",
      requestId: "d1",
      result: {
        ok: true,
        detail: { ...mcpDetail, secrets: { kind: "known" } },
      },
    })).toBe(false);
  });

  it("rejects an MCP server list over its cap using fresh records", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "mcp-over-cap",
      view: {
        section: "mcp",
        servers: Array.from(
          { length: MAX_MCP_SERVERS + 1 },
          (_, index) => makeMcpListItem(index),
        ),
        secretStates: "available",
        oauth: { kind: "manual", reason: "no-callback-origin" },
      },
    })).toBe(false);
  });

  it("rejects malformed MCP log records", () => {
    const entry = {
      at: "2026-08-23T00:00:00.000Z",
      level: "info",
      message: "connected",
    };
    expect(isSettingsOutboundMessage({
      kind: "mcpLogs",
      requestId: "l1",
      result: {
        ok: true,
        serverId: "docs-id",
        next: 1,
        entries: Array.from(
          { length: MAX_MCP_LOG_ENTRIES + 1 },
          () => ({ ...entry }),
        ),
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "mcpLogs",
      requestId: "l1",
      result: {
        ok: true,
        serverId: "docs-id",
        next: 1,
        entries: [{ ...entry, message: "x".repeat(MAX_MCP_LOG_MESSAGE_LENGTH + 1) }],
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "mcpLogs",
      requestId: "l1",
      result: {
        ok: true,
        serverId: "docs-id",
        next: 1,
        entries: [{ ...entry, detail: "x".repeat(MAX_MCP_LOG_DETAIL_LENGTH + 1) }],
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "mcpLogs",
      requestId: "l1",
      result: {
        ok: true,
        serverId: "docs-id",
        next: 1,
        entries: [{ ...entry, level: "debug" }],
      },
    })).toBe(false);
  });

  it("rejects dual-arm and empty MCP operation results", () => {
    expect(isSettingsOutboundMessage({
      kind: "mcpOperation",
      requestId: "o1",
      result: {
        ok: true,
        error: { code: "internal", message: "x" },
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "mcpOperation",
      requestId: "o1",
      result: {},
    })).toBe(false);
  });

  it("rejects undeclared credential-bearing fields in a Web Search view", () => {
    const secretFields = [
      { ref: "TAVILY_API_KEY", value: "tvly-x" },
      { apiKey: "tvly-x" },
      { secret: "tvly-x" },
      { token: "tvly-x" },
      { password: "tvly-x" },
    ];
    for (const leaked of secretFields) {
      expect(isSettingsOutboundMessage({
        kind: "webSearchMutation",
        requestId: "w1",
        result: {
          ok: true,
          view: { ...webSearchView, leaked },
          secretFailures: [],
        },
      })).toBe(false);
    }
  });

  it("accepts MCP env name/value pairs through the outbound credential scan", () => {
    expect(isSettingsOutboundMessage({
      kind: "mcpServer",
      requestId: "env",
      result: {
        ok: true,
        detail: {
          ...mcpDetail,
          server: {
            ...mcpServer,
            env: [{ name: "DOCS_ROOT", value: "/tmp/docs" }],
          },
        },
      },
    })).toBe(true);
  });

  it("rejects repeated record references after closed-schema validation", () => {
    const sharedStatus = { state: "disconnected" };
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "shared-status",
      view: {
        section: "mcp",
        servers: [
          makeMcpListItem(1, sharedStatus),
          makeMcpListItem(2, sharedStatus),
        ],
        secretStates: "available",
        oauth: { kind: "manual", reason: "no-callback-origin" },
      },
    })).toBe(false);
  });

  it("rejects forbidden and undeclared recursive fields in closed schemas", () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const message = {
        kind: "settingsCapabilities",
        sections: ["mcp"],
      } as Record<string, unknown>;
      Object.defineProperty(message, key, {
        value: "x",
        enumerable: true,
      });
      expect(isSettingsOutboundMessage(message)).toBe(false);
    }

    const view: Record<string, unknown> = { ...webSearchView };
    view.self = view;
    expect(isSettingsOutboundMessage({
      kind: "webSearchMutation",
      requestId: "w1",
      result: { ok: true, view, secretFailures: [] },
    })).toBe(false);
  });

  it("accepts settingsSection views for each section tag", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "general",
        namespaces: [generalNamespace],
        agentPresets: [{ id: "standard", label: "Standard", trust: "system" }],
        permissionPresets: [{ id: "workspace-write", label: "Workspace Write", dangerous: false }],
      },
    })).toBe(true);

    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "models",
        namespaces: [],
        providers: [],
        credentials: [{
          ref: "DEEPSEEK_API_KEY",
          set: true,
          source: "env",
          writable: false,
        }],
      },
    })).toBe(true);

    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "plugins",
        namespaces: [],
        configurable: [{
          namespace: "shell",
          label: "Shell",
          fields: [{ path: ["timeoutMs"], label: "Timeout", kind: "number" }],
        }],
        inventory: [{
          entryId: "shell",
          moduleName: "@deepseek-ai/dsh-shell",
          enabled: true,
          fiberPhase: "active",
        }],
      },
    })).toBe(true);

    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "agent-presets",
        namespace: generalNamespace,
        presets: [{
          id: "standard",
          trust: "system",
          removable: false,
          openable: true,
        }],
      },
    })).toBe(true);
  });

  it("requires a closed trust tag on general agent-preset choices", () => {
    const view = (agentPresets: unknown) => ({
      kind: "settingsSection" as const,
      requestId: "s1",
      view: {
        section: "general" as const,
        namespaces: [generalNamespace],
        agentPresets,
        permissionPresets: [
          { id: "workspace-write", label: "Workspace Write", dangerous: false },
        ],
      },
    });
    expect(isSettingsOutboundMessage(view([
      { id: "standard", label: "Standard", trust: "system" },
      { id: "mine", label: "Mine", trust: "user" },
    ]))).toBe(true);
    expect(isSettingsOutboundMessage(view([
      { id: "standard", label: "Standard" },
    ]))).toBe(false);
    expect(isSettingsOutboundMessage(view([
      { id: "standard", label: "Standard", trust: "root" },
    ]))).toBe(false);
  });

  it("accepts settingsMutation results", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsMutation",
      requestId: "m1",
      result: { ok: true, namespace: generalNamespace, restartRequired: true },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsMutation",
      requestId: "m1",
      result: {
        ok: false,
        error: { code: "settings-conflict", message: "stale", namespace: "permission", currentRevision: 4 },
      },
    })).toBe(true);
  });

  it("accepts an explicit settingsSection unavailable error and rejects mixed arms", () => {
    const error = {
      code: "settings-unavailable",
      message: "Models settings are not available",
    } as const;
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      error,
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      error,
      view: {
        section: "general",
        namespaces: [],
        agentPresets: [],
        permissionPresets: [],
      },
    })).toBe(false);
  });

  it("accepts settingsInvalidated", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsInvalidated",
      sections: ["general", "models"],
      reason: "document",
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsInvalidated",
      sections: ["mcp", "web-search"],
      reason: "mcp",
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsInvalidated",
      sections: ["web-search"],
      reason: "web-search",
    })).toBe(true);
  });

  it("accepts the Protocol v6 settings error codes", () => {
    expect(isSettingsOutboundMessage({
      kind: "mcpOperation",
      requestId: "o1",
      result: {
        ok: false,
        error: { code: "mcp-rejected", message: "Server was rejected" },
      },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "webSearchMutation",
      requestId: "w1",
      result: {
        ok: false,
        error: {
          code: "web-search-rejected",
          message: "Catalog was rejected",
        },
      },
    })).toBe(true);
  });

  it("accepts agentPresetContent and settingsPath results", () => {
    expect(isSettingsOutboundMessage({
      kind: "agentPresetContent",
      requestId: "p1",
      result: { ok: true, presetId: "standard", trust: "system", content: "plugins: []" },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "agentPresetContent",
      requestId: "p1",
      result: { ok: false, error: { code: "preset-rejected", message: "missing" } },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsPath",
      requestId: "r1",
      result: { ok: true, path: "/home/user/.dsh", target: "dsh-home" },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsPath",
      requestId: "r1",
      result: { ok: false, error: { code: "settings-rejected", message: "no preset" } },
    })).toBe(true);
  });

  it("rejects empty request ids", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "",
      view: {
        section: "general",
        namespaces: [],
        agentPresets: [],
        permissionPresets: [],
      },
    })).toBe(false);
  });

  it("rejects malformed result tags and section tags", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsMutation",
      requestId: "m1",
      result: { ok: "yes" },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: { section: "unknown", namespaces: [] },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsInvalidated",
      sections: ["general"],
      reason: "unknown",
    })).toBe(false);
  });

  it("rejects any outbound credential value", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: { section: "models", credentialValue: "secret" },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "models",
        namespaces: [],
        providers: [],
        credentials: [{
          ref: "DEEPSEEK_API_KEY",
          set: true,
          source: "file",
          writable: true,
          value: "secret",
        }],
      },
    })).toBe(false);
  });

  it("rejects contradictory result arms and undeclared result fields", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsMutation",
      requestId: "m1",
      result: {
        ok: true,
        error: { code: "settings-conflict", message: "stale" },
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsMutation",
      requestId: "m1",
      result: {
        ok: false,
        error: { code: "settings-rejected", message: "no" },
        namespace: generalNamespace,
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "agentPresetContent",
      requestId: "p1",
      result: {
        ok: true,
        presetId: "standard",
        trust: "system",
        content: "x",
        error: { code: "preset-rejected", message: "no" },
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsPath",
      requestId: "r1",
      result: {
        ok: false,
        error: { code: "settings-rejected", message: "no" },
        path: "/tmp",
      },
    })).toBe(false);
  });

  it("rejects undeclared outbound message and section-view fields", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsInvalidated",
      sections: ["general"],
      reason: "document",
      requestId: "extra",
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "general",
        namespaces: [],
        agentPresets: [],
        permissionPresets: [],
        extra: true,
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "general",
        namespaces: [],
        agentPresets: [{ id: "standard", label: "Standard", trust: "system", prototype: "x" }],
        permissionPresets: [],
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "agent-presets",
        presets: [{
          id: "standard",
          trust: "system",
          removable: false,
          openable: true,
          constructor: "x",
        }],
      },
    })).toBe(false);
  });

  it("enforces closed credential records and rejects undeclared secret field names", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "models",
        namespaces: [],
        providers: [{
          id: "deepseek",
          namespace: "llm-deepseek",
          label: "DeepSeek",
          active: true,
          catalog: { kind: "ready" },
          credentialStatus: { kind: "none" },
          models: [],
          removable: true,
          fields: [],
          apiKey: "secret",
        }],
        credentials: [{
          ref: "DEEPSEEK_API_KEY",
          set: true,
          source: "file",
          writable: true,
        }],
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "models",
        namespaces: [],
        providers: [],
        credentials: [{
          ref: "DEEPSEEK_API_KEY",
          set: true,
          source: "file",
          writable: true,
        }],
      },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "models",
        namespaces: [],
        providers: [],
        credentials: [{
          ref: "DEEPSEEK_API_KEY",
          set: true,
          source: "file",
          writable: true,
          extra: true,
        }],
      },
    })).toBe(false);
  });

  it("rejects union settings fields without non-empty options", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "plugins",
        namespaces: [],
        configurable: [{
          namespace: "shell",
          label: "Shell",
          fields: [{ path: ["mode"], label: "Mode", kind: "union" }],
        }],
        inventory: [],
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "plugins",
        namespaces: [],
        configurable: [{
          namespace: "shell",
          label: "Shell",
          fields: [{
            path: ["mode"],
            label: "Mode",
            kind: "union",
            options: [{ value: "local", label: "Local" }],
          }],
        }],
        inventory: [],
      },
    })).toBe(true);
  });

  it("accepts numeric schema step constraints and rejects undeclared constraints", () => {
    const view = (field: unknown) => ({
      section: "plugins",
      namespaces: [],
      configurable: [{
        namespace: "agent-loop",
        label: "Agent Loop",
        fields: [field],
      }],
      inventory: [],
    });
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "plugins",
      view: view({
        path: ["maxParallelToolCalls"],
        label: "Maximum parallel tool calls",
        kind: "number",
        min: 1,
        step: 1,
      }),
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "plugins",
      view: view({
        path: ["maxParallelToolCalls"],
        label: "Maximum parallel tool calls",
        kind: "number",
        integer: true,
      }),
    })).toBe(false);
  });

  it("closes plugin credential metadata without admitting values", () => {
    const view = (configurable: unknown[]) => ({
      section: "plugins",
      namespaces: [],
      configurable,
      inventory: [],
    });
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "plugins",
      view: view([{
        namespace: "web-search-deepseek",
        label: "Web Search",
        fields: [],
        credentialStatus: { kind: "ready" },
        credential: {
          ref: "DEEPSEEK_API_KEY",
          set: true,
          source: "env",
          writable: false,
        },
      }]),
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "plugins",
      view: view([{
        namespace: "web-search-deepseek",
        label: "Web Search",
        fields: [],
        credentialStatus: { kind: "ready" },
      }]),
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "plugins",
      view: view([{
        namespace: "web-search-deepseek",
        label: "Web Search",
        fields: [],
        credentialStatus: { kind: "failed", message: "Credential metadata is unavailable" },
        credential: {
          ref: "DEEPSEEK_API_KEY",
          set: true,
          writable: true,
        },
      }]),
    })).toBe(false);
  });

  it("distinguishes dormant, ready, and failed provider catalogs", () => {
    const provider = () => ({
      namespace: "llm-pi-ai",
      label: "Provider",
      models: [],
      removable: false,
      fields: [],
      credentialStatus: { kind: "none" },
    });
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "models",
      view: {
        section: "models",
        namespaces: [],
        credentials: [],
        providers: [
          {
            ...provider(),
            id: "dormant",
            active: false,
            declared: true,
            catalog: { kind: "dormant" },
          },
          {
            ...provider(),
            id: "empty",
            active: true,
            catalog: { kind: "ready" },
          },
          {
            ...provider(),
            id: "failed",
            active: true,
            catalog: {
              kind: "failed",
              message: "Model catalog is unavailable",
            },
          },
        ],
      },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "models",
      view: {
        section: "models",
        namespaces: [],
        credentials: [],
        providers: [{
          ...provider(),
          id: "bad",
          active: true,
          catalog: { kind: "failed", message: "no", stack: "secret" },
        }],
      },
    })).toBe(false);
  });

  it("rejects every active and catalog status mismatch", () => {
    const provider = (
      active: boolean,
      catalog: unknown,
      models: unknown[] = [],
    ) => ({
      id: "provider",
      namespace: "llm-pi-ai",
      label: "Provider",
      active,
      catalog,
      credentialStatus: { kind: "none" },
      models,
      removable: false,
      fields: [],
    });
    const accepts = (candidate: unknown) => isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "models",
      view: {
        section: "models",
        namespaces: [],
        credentials: [],
        providers: [candidate],
      },
    });

    expect(accepts(provider(true, { kind: "dormant" }))).toBe(false);
    expect(accepts(provider(false, { kind: "ready" }))).toBe(false);
    expect(accepts(provider(false, {
      kind: "failed",
      message: "Model catalog is unavailable",
    }))).toBe(false);
    expect(accepts(provider(false, { kind: "dormant" }, [{
      id: "unexpected",
      label: "Unexpected",
    }]))).toBe(false);
    expect(accepts(provider(true, {
      kind: "failed",
      message: "Model catalog is unavailable",
    }, [{
      id: "unexpected",
      label: "Unexpected",
    }]))).toBe(false);
  });

  it("closes provider credential metadata status and success state", () => {
    const common = {
      namespace: "llm-deepseek",
      label: "DeepSeek",
      active: true,
      catalog: { kind: "ready" },
      models: [],
      removable: false,
      fields: [],
    };
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "models",
      view: {
        section: "models",
        namespaces: [],
        credentials: [],
        providers: [{
          ...common,
          id: "failed",
          credentialStatus: {
            kind: "failed",
            message: "Credential metadata is unavailable",
          },
        }],
      },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "models",
      view: {
        section: "models",
        namespaces: [],
        credentials: [],
        providers: [{
          ...common,
          id: "ready-without-state",
          credentialStatus: { kind: "ready" },
        }],
      },
    })).toBe(false);
  });

  it("rejects nested credential-like keys inside namespace records", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "general",
        namespaces: [{
          namespace: "permission",
          revision: 0,
          applies: "live",
          writable: true,
          base: {},
          user: {},
          value: { token: "secret" },
          secrets: [],
        }],
        agentPresets: [],
        permissionPresets: [],
      },
    })).toBe(false);
  });

  it("admits a legitimate payload filling the wire scan budget", () => {
    // Four nodes per model entry: the record plus `id`, `label`, `contextWindow`.
    const models = Array.from(
      { length: Math.floor((SETTINGS_WIRE_SCAN_NODE_LIMIT - 64) / 4) },
      (_, index) => ({
        id: `model-${index}`,
        label: `Model ${index}`,
        contextWindow: 128_000,
      }),
    );

    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "models",
        namespaces: [],
        providers: [{
          id: "openrouter",
          namespace: "llm-pi-ai",
          label: "OpenRouter",
          active: true,
          catalog: { kind: "ready" },
          credentialStatus: { kind: "none" },
          models,
          removable: true,
          fields: [],
        }],
        credentials: [],
      },
    })).toBe(true);
  });

  it("still fails closed beyond the wire scan budget", () => {
    const models = Array.from(
      { length: SETTINGS_WIRE_SCAN_NODE_LIMIT },
      (_, index) => ({ id: `model-${index}`, label: `Model ${index}` }),
    );

    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "models",
        namespaces: [],
        providers: [{
          id: "openrouter",
          namespace: "llm-pi-ai",
          label: "OpenRouter",
          active: true,
          catalog: { kind: "ready" },
          credentialStatus: { kind: "none" },
          models,
          removable: true,
          fields: [],
        }],
        credentials: [],
      },
    })).toBe(false);
  });

  it("rejects cyclic namespace object layers fail closed", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "general",
        namespaces: [{
          namespace: "permission",
          revision: 0,
          applies: "live",
          writable: true,
          base: cyclic,
          user: {},
          value: {},
          secrets: [],
        }],
        agentPresets: [],
        permissionPresets: [],
      },
    })).toBe(false);
  });
});

describe("isMcpServerInputWire", () => {
  it("is the exported acceptance predicate the editor can reuse before sending", () => {
    expect(isMcpServerInputWire(mcpServerInput)).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "runMcpOperation",
      requestId: "op-1",
      operation: { kind: "upsertServer", server: mcpServerInput },
    })).toBe(true);
  });

  it("rejects the same records the operation validator rejects", () => {
    const rejected: object[] = [
      { ...mcpServerInput, serverName: "" },
      { ...mcpServerInput, command: "" },
      { ...mcpServerInput, toolCallTimeoutMs: 0 },
      {
        ...mcpServerInput,
        auth: { kind: "headers", headerNames: [""] },
      },
      { ...mcpServerInput, env: [{ name: "", value: "" }] },
      {
        serverName: "http",
        enabled: true,
        transport: "streamable-http",
        url: "",
        auth: { kind: "none" },
        toolCallTimeoutMs: 30_000,
        reconnect: mcpReconnect,
      },
      {
        ...mcpServerInput,
        auth: {
          kind: "oauth",
          clientId: "",
          authorizeUrl: "",
          tokenUrl: "",
          scopes: [],
          redirectPath: "",
        },
      },
    ];
    for (const server of rejected) {
      expect(isMcpServerInputWire(server)).toBe(false);
      expect(isSettingsInboundCommand({
        kind: "runMcpOperation",
        requestId: "op-1",
        operation: { kind: "upsertServer", server },
      })).toBe(false);
    }
  });
});

describe("protocol v6 settings integration", () => {
  it("routes settings kinds through protocol validators", () => {
    expect(isInboundMessage({
      kind: "getSettingsSection",
      requestId: "s1",
      section: "plugins",
    })).toBe(true);
    expect(isOutboundMessage({
      kind: "settingsInvalidated",
      sections: ["plugins"],
      reason: "plugins",
    })).toBe(true);
  });
});

import { Context } from "@deepseek-ai/cordis";
import {
  settingsNamespace,
  type SettingsDescriptor,
} from "@deepseek-ai/dsh-settings";
import {
  isOutboundMessage,
  MAX_MCP_ARGS,
  MAX_MCP_DISABLED_TOOLS,
  MAX_MCP_ENV_ENTRIES,
  MAX_MCP_HEADER_NAMES,
  MAX_MCP_LOG_DETAIL_LENGTH,
  MAX_MCP_LOG_ENTRIES,
  MAX_MCP_LOG_MESSAGE_LENGTH,
  MAX_MCP_SCOPES,
  MAX_MCP_SERVERS,
  MAX_MCP_TOOLS,
  MAX_SECRET_VALUE_LENGTH,
  MAX_WIRE_IDENTIFIER_LENGTH,
  MAX_WIRE_URL_LENGTH,
  SETTINGS_WIRE_SCAN_NODE_LIMIT,
} from "@dsh-vscode/contract";
import { describe, expect, it } from "vitest";
import {
  buildMcpDetail,
  buildMcpView,
  MAX_MCP_DETAIL_NODES,
  MAX_MCP_LIST_VIEW_NODES,
  MAX_MCP_LOGS_MESSAGE_NODES,
  readMcpLogs,
} from "../src/settings/mcp.js";
import {
  buildWebSearchView,
  MAX_WEB_SEARCH_VIEW_NODES,
} from "../src/settings/web-search.js";
import type {
  McpLogEntryLike,
  McpServerRecordLike,
  McpToolInfoLike,
} from "../src/settings/optional-services.js";
import {
  buildGeneralView,
  MAX_GENERAL_CHOICES,
} from "../src/settings/general.js";
import {
  buildModelsView,
  MAX_MODELS_PER_PROVIDER,
  MAX_PROVIDERS,
  MAX_VIEW_NODES as MODELS_MAX_VIEW_NODES,
} from "../src/settings/models.js";
import {
  buildPluginsView,
  MAX_INVENTORY_ENTRIES,
  MAX_VIEW_NODES as PLUGINS_MAX_VIEW_NODES,
} from "../src/settings/plugins.js";
import { buildAgentPresetsView, MAX_PRESETS } from "../src/settings/presets.js";
import {
  MAX_PROJECTED_DEPTH,
  MAX_PROJECTED_NODES,
} from "../src/settings/project.js";

// `settingsSection` adds the message record, `kind`, and `requestId` around a view.
const MESSAGE_ENVELOPE_NODES = 3;
// A result message adds the message record, `kind`, `requestId`, the `result`
// record, and `ok` around its payload.
const RESULT_ENVELOPE_NODES = 5;
/**
 * Nodes the contract wire scan charges for one payload: every visited value,
 * including each record, each array, and each primitive leaf.
 * @param value - payload to measure.
 * @returns the node count the contract scan budget is compared against.
 */
function countWireNodes(value: unknown): number {
  if (Array.isArray(value)) {
    return 1 + value.reduce<number>(
      (total, item) => total + countWireNodes(item),
      0,
    );
  }
  if (typeof value !== "object" || value === null) return 1;
  return 1 + Object.values(value).reduce<number>(
    (total, child) => total + countWireNodes(child),
    0,
  );
}

function maxString(prefix: string, length = MAX_WIRE_IDENTIFIER_LENGTH): string {
  return `${prefix}${"x".repeat(length - prefix.length)}`;
}

// Cap-length strings are shared where the wire contract allows repeats; only
// env names and server ids must stay distinct. Every fixture object below is
// built fresh so the wire scan never sees a repeated record.
const MAX_ID = maxString("id-");
const MAX_URL = maxString("https://mcp.example/", MAX_WIRE_URL_LENGTH);
const MAX_ENV_VALUE = maxString("env-value-", MAX_SECRET_VALUE_LENGTH);
const MAX_DESCRIPTION = maxString("description-", MAX_MCP_LOG_DETAIL_LENGTH);
const MAX_LOG_MESSAGE = maxString("message-", MAX_MCP_LOG_MESSAGE_LENGTH);
const ENV_NAMES = Array.from(
  { length: MAX_MCP_ENV_ENTRIES },
  (_, entry) => maxString(`ENV_${entry}_`),
);

function maximalMcpRecord(
  index: number,
  auth: McpServerRecordLike["auth"],
): McpServerRecordLike {
  return {
    id: `server-${index}`,
    serverName: MAX_ID,
    enabled: true,
    transport: "stdio",
    command: MAX_ID,
    args: Array.from({ length: MAX_MCP_ARGS }, () => MAX_ID),
    env: Object.fromEntries(ENV_NAMES.map((name) => [name, MAX_ENV_VALUE])),
    cwd: MAX_ID,
    auth,
    disabledTools: Array.from({ length: MAX_MCP_DISABLED_TOOLS }, () => MAX_ID),
    toolCallTimeoutMs: 600_000,
    reconnect: {
      enabled: true,
      initialDelayMs: 1_000,
      maxDelayMs: 60_000,
      maxAttempts: 10,
    },
    createdAt: MAX_ID,
    updatedAt: MAX_ID,
  };
}

function oauthAuth(): McpServerRecordLike["auth"] {
  return {
    kind: "oauth",
    clientId: MAX_ID,
    authorizeUrl: MAX_URL,
    tokenUrl: MAX_URL,
    scopes: Array.from({ length: MAX_MCP_SCOPES }, () => MAX_ID),
    redirectPath: MAX_ID,
  };
}

const HEADER_NAMES = Array.from(
  { length: MAX_MCP_HEADER_NAMES },
  (_, name) => maxString(`Header-${name}-`),
);

function headerAuth(): McpServerRecordLike["auth"] {
  return { kind: "headers", headerNames: [...HEADER_NAMES] };
}

function maximalTools(): McpToolInfoLike[] {
  return Array.from({ length: MAX_MCP_TOOLS }, (_, tool) => ({
    name: MAX_ID,
    description: MAX_DESCRIPTION,
    enabled: tool % 2 === 0,
  }));
}

function maximalLogEntries(): McpLogEntryLike[] {
  return Array.from({ length: MAX_MCP_LOG_ENTRIES }, () => ({
    at: MAX_ID,
    level: "error" as const,
    message: MAX_LOG_MESSAGE,
    detail: MAX_DESCRIPTION,
  }));
}

/** Provide a fake `mcp` service that answers every read from fixed fixtures. */
function provideMcp(ctx: Context, options: {
  records: McpServerRecordLike[];
  tools?: McpToolInfoLike[];
  logs?: McpLogEntryLike[];
  describeSecrets?: boolean;
}): void {
  const byId = new Map(options.records.map((record) => [record.id, record]));
  ctx.provide("mcp", {
    list: () => options.records,
    get: (id: string) => byId.get(id),
    upsert: async (record: McpServerRecordLike) => record,
    remove: async () => {},
    setEnabled: async () => {},
    connect: async () => {},
    disconnect: async () => {},
    getStatus: () => ({
      state: "connected",
      toolCount: options.tools?.length ?? 0,
      connectedAt: MAX_ID,
    }),
    getLogs: () => ({ next: MAX_MCP_LOG_ENTRIES, entries: options.logs ?? [] }),
    getTools: () => options.tools ?? [],
    setToolEnabled: async () => {},
    clearOAuth: async () => {},
    setSecrets: async () => {},
    ...(options.describeSecrets === true
      ? {
          describeSecrets: async () => Object.fromEntries(
            HEADER_NAMES.map((name) => [name, { configured: true }]),
          ),
        }
      : {}),
  } as never);
}

const profileRefs = {
  "1": {
    type: "object",
    meta: {},
    dict: { apiKeyEnv: 2, displayName: 3, api: 4, baseURL: 7 },
  },
  "2": { type: "string", meta: { role: "credential-ref" } },
  "3": { type: "string", meta: {} },
  "4": { type: "union", meta: {}, list: [5, 6] },
  "5": { type: "const", meta: {}, value: "openai-completions" },
  "6": { type: "const", meta: {}, value: "anthropic-messages" },
  "7": { type: "string", meta: {} },
};

const piAiSchema = {
  uid: 10,
  refs: {
    ...profileRefs,
    "10": { type: "object", meta: {}, dict: { providers: 11 } },
    "11": { type: "dict", meta: {}, inner: 1 },
  },
};

const pluginSchema = {
  uid: 1,
  refs: {
    "1": {
      type: "object",
      meta: {},
      dict: {
        timeoutMs: 2,
        maxOutputBytes: 2,
        maxParallelToolCalls: 2,
        apiKeyEnv: 3,
        baseURL: 4,
        maxUses: 2,
      },
    },
    "2": { type: "number", meta: { min: 1, step: 1 } },
    "3": { type: "string", meta: { role: "credential-ref" } },
    "4": { type: "string", meta: {} },
  },
};

const providerIds = Array.from(
  { length: MAX_PROVIDERS },
  (_, index) => `provider-${index}`,
);

function providerProfiles(): Record<string, unknown> {
  return Object.fromEntries(providerIds.map((id, index) => [id, {
    apiKeyEnv: `PROVIDER_${index}_API_KEY`,
    displayName: `Provider ${index}`,
    api: "openai-completions",
    baseURL: `https://provider-${index}.example/v1`,
  }]));
}

function descriptor(
  namespace: string,
  schema: unknown,
  layers: Pick<SettingsDescriptor, "base" | "user" | "value">,
): SettingsDescriptor {
  return {
    ns: settingsNamespace(namespace),
    schema,
    revision: 7,
    applies: "live",
    secrets: [],
    ...layers,
  };
}

function sectionMessage(requestId: string, view: unknown): unknown {
  return { kind: "settingsSection", requestId, view };
}

describe("bridge projection ceilings stay inside the contract wire scan", () => {
  it("keeps the wire scan budget above every bridge view ceiling", () => {
    expect(SETTINGS_WIRE_SCAN_NODE_LIMIT)
      .toBeGreaterThan(MODELS_MAX_VIEW_NODES + MESSAGE_ENVELOPE_NODES);
    expect(SETTINGS_WIRE_SCAN_NODE_LIMIT)
      .toBeGreaterThan(PLUGINS_MAX_VIEW_NODES + MESSAGE_ENVELOPE_NODES);
    expect(SETTINGS_WIRE_SCAN_NODE_LIMIT)
      .toBeGreaterThan(MAX_MCP_LIST_VIEW_NODES + MESSAGE_ENVELOPE_NODES);
    expect(SETTINGS_WIRE_SCAN_NODE_LIMIT)
      .toBeGreaterThan(MAX_MCP_DETAIL_NODES + RESULT_ENVELOPE_NODES);
    expect(SETTINGS_WIRE_SCAN_NODE_LIMIT)
      .toBeGreaterThan(MAX_MCP_LOGS_MESSAGE_NODES + RESULT_ENVELOPE_NODES);
    expect(SETTINGS_WIRE_SCAN_NODE_LIMIT)
      .toBeGreaterThan(MAX_WEB_SEARCH_VIEW_NODES + MESSAGE_ENVELOPE_NODES);
  });

  it("keeps namespace projection below the aggregate view ceilings", () => {
    expect(MAX_PROJECTED_NODES).toBeLessThan(PLUGINS_MAX_VIEW_NODES);
    expect(MAX_PROJECTED_NODES).toBeLessThan(MODELS_MAX_VIEW_NODES);
  });

  it("accepts a Plugins view whose namespace nests to the projection depth", async () => {
    // The layer root sits at depth 0 and its `deep` value at depth 1, so the
    // chain holds one record fewer than the depth ceiling before its leaf.
    let nested: Record<string, unknown> = { leaf: "value" };
    for (let level = 2; level < MAX_PROJECTED_DEPTH; level += 1) {
      nested = { nested };
    }
    const ctx = new Context();
    ctx.provide("settings", {
      writable: true,
      describe: () => [descriptor("shell", pluginSchema, {
        base: {},
        user: {},
        value: { timeoutMs: 1, deep: nested },
      })],
    } as never);
    ctx.provide("pluginInventory", { list: () => ({ entries: [] }) } as never);

    const view = await buildPluginsView(ctx);

    expect(isOutboundMessage(sectionMessage("plugins-deep", view))).toBe(true);
    await ctx.fiber.dispose();
  });

  it("accepts a Models view built at every Models cap", async () => {
    const ctx = new Context();
    ctx.provide("settings", {
      writable: true,
      describe: () => [descriptor("llm-pi-ai", piAiSchema, {
        base: {},
        user: { providers: providerProfiles() },
        value: { providers: providerProfiles() },
      })],
    } as never);
    ctx.provide("llm", {
      listConfigurableProviders: () => providerIds.map((id, index) => ({
        provider: id,
        displayName: `Provider ${index}`,
        settingsNs: "llm-pi-ai",
        settingsPath: ["providers", id],
        declared: false,
      })),
      listProviders: () => providerIds.map((id) => ({ id, name: id })),
      listModels: async (provider: string) => (
        provider === providerIds[0]
          ? Array.from({ length: MAX_MODELS_PER_PROVIDER }, (_, index) => ({
              provider,
              id: `model-${index}`,
              name: `Model ${index}`,
            }))
          : []
      ),
      resolveModelInfo: async (provider: string, model: string) => ({
        provider,
        id: model,
        name: model,
        context: { contextWindow: 1_000_000 },
      }),
    } as never);
    ctx.provide("credentials", {
      describe: async (ref: string) => ({
        configured: true,
        source: `file:${ref}`,
        writable: true,
      }),
    } as never);

    const view = await buildModelsView(ctx);

    expect(view.providers).toHaveLength(MAX_PROVIDERS);
    expect(view.providers[0]?.models).toHaveLength(MAX_MODELS_PER_PROVIDER);
    expect(view.credentials).toHaveLength(MAX_PROVIDERS);
    expect(isOutboundMessage(sectionMessage("models-max", view))).toBe(true);
    await ctx.fiber.dispose();
  });

  it("accepts a Plugins view built at every Plugins cap", async () => {
    const ctx = new Context();
    ctx.provide("settings", {
      writable: true,
      describe: () => ["shell", "agent-loop", "web-search-deepseek"].map(
        (namespace) => descriptor(namespace, pluginSchema, {
          base: { timeoutMs: 1, maxOutputBytes: 2, maxParallelToolCalls: 3 },
          user: { maxUses: 4 },
          value: {
            timeoutMs: 1,
            maxOutputBytes: 2,
            maxParallelToolCalls: 3,
            maxUses: 4,
            apiKeyEnv: "DEEPSEEK_API_KEY",
            baseURL: "https://search.example/v1",
          },
        }),
      ),
    } as never);
    ctx.provide("credentials", {
      describe: async () => ({
        configured: true,
        source: "env",
        writable: false,
      }),
    } as never);
    ctx.provide("pluginInventory", {
      list: () => ({
        entries: Array.from({ length: MAX_INVENTORY_ENTRIES }, (_, index) => ({
          entryId: `entry-${index}`,
          moduleName: `@deepseek-ai/dsh-plugin-${index}`,
          enabled: true,
          fiberPhase: "active",
        })),
      }),
    } as never);

    const view = await buildPluginsView(ctx);

    expect(view.inventory).toHaveLength(MAX_INVENTORY_ENTRIES);
    expect(isOutboundMessage(sectionMessage("plugins-max", view))).toBe(true);
    await ctx.fiber.dispose();
  });

  it("accepts an Agent Presets view built at the roster cap", async () => {
    const ctx = new Context();
    ctx.provide("settings", {
      writable: true,
      describe: () => [descriptor("agent-presets", {}, {
        base: { default: "preset-0" },
        user: {},
        value: { default: "preset-0" },
      })],
    } as never);
    ctx.provide("agentPresets", {
      list: async () => Array.from({ length: MAX_PRESETS }, (_, index) => ({
        id: `preset-${index}`,
        trust: "user" as const,
        name: `Preset ${index}`,
        description: `Composition ${index}`,
        path: `/presets/preset-${index}/cordis.yml`,
      })),
    } as never);

    const view = await buildAgentPresetsView(ctx);

    expect(view.presets).toHaveLength(MAX_PRESETS);
    expect(isOutboundMessage(sectionMessage("presets-max", view))).toBe(true);
    await ctx.fiber.dispose();
  });

  it("accepts a General view built at the choice cap", async () => {
    const ctx = new Context();
    ctx.provide("settings", {
      writable: true,
      describe: () => [
        "agent-presets",
        "permission",
        "locale",
        "ui-theme",
        "ui-conversation",
      ].map((namespace) => descriptor(namespace, {}, {
        base: { preference: "system" },
        user: {},
        value: { preference: "system" },
      })),
    } as never);
    ctx.provide("agentPresets", {
      list: async () => Array.from(
        { length: MAX_GENERAL_CHOICES },
        (_, index) => ({
          id: `preset-${index}`,
          trust: "user" as const,
          name: `Preset ${index}`,
          path: `/presets/preset-${index}/cordis.yml`,
        }),
      ),
    } as never);
    ctx.provide("permissionPresets", {
      names: Array.from(
        { length: MAX_GENERAL_CHOICES },
        (_, index) => `permission-${index}`,
      ),
      optionOf: (id: string) => ({ name: `Permission ${id}` }),
      resolve: () => ({ sandbox: "workspace-write" }),
    } as never);

    const view = await buildGeneralView(ctx);

    expect(view.agentPresets).toHaveLength(MAX_GENERAL_CHOICES);
    expect(view.permissionPresets).toHaveLength(MAX_GENERAL_CHOICES);
    expect(isOutboundMessage(sectionMessage("general-max", view))).toBe(true);
    await ctx.fiber.dispose();
  });

  it("accepts an MCP list view built at every MCP record cap", async () => {
    const ctx = new Context();
    provideMcp(ctx, {
      records: Array.from(
        { length: MAX_MCP_SERVERS },
        (_, index) => maximalMcpRecord(index, oauthAuth()),
      ),
      describeSecrets: true,
    });

    const view = await buildMcpView(ctx);
    const message = sectionMessage("mcp-max", view);

    expect(view.servers).toHaveLength(MAX_MCP_SERVERS);
    expect(view.servers[0]?.server.args).toHaveLength(MAX_MCP_ARGS);
    expect(view.servers[0]?.server.env).toHaveLength(MAX_MCP_ENV_ENTRIES);
    expect(view.servers[0]?.server.disabledTools)
      .toHaveLength(MAX_MCP_DISABLED_TOOLS);
    // The largest producer payload the contract scan budget is sized for:
    // 9 view nodes plus 576 nodes for each maximal server row, and 3 more for
    // the message envelope. The view shell grew by two oauth children
    // (`discovery` and `authorization`); loopback `origin` replaces `reason`
    // and does not change the count.
    expect(countWireNodes(view)).toBe(9 + MAX_MCP_SERVERS * 576);
    expect(countWireNodes(view)).toBe(36_873);
    expect(countWireNodes(view)).toBeLessThanOrEqual(MAX_MCP_LIST_VIEW_NODES);
    expect(countWireNodes(message)).toBe(36_876);
    expect(countWireNodes(message))
      .toBeLessThanOrEqual(MAX_MCP_LIST_VIEW_NODES + MESSAGE_ENVELOPE_NODES);
    expect(isOutboundMessage(message)).toBe(true);
    await ctx.fiber.dispose();
  });

  it("accepts an MCP detail built at every tool and secret cap", async () => {
    const ctx = new Context();
    provideMcp(ctx, {
      records: [maximalMcpRecord(0, headerAuth())],
      tools: maximalTools(),
      describeSecrets: true,
    });

    const detail = await buildMcpDetail(ctx, "server-0");
    const message = {
      kind: "mcpServer",
      requestId: "mcp-detail-max",
      result: { ok: true, detail },
    };

    expect(detail.tools).toHaveLength(MAX_MCP_TOOLS);
    expect(detail.secrets).toEqual({
      kind: "known",
      secrets: HEADER_NAMES.map((name) => ({ name, configured: true })),
    });
    expect(countWireNodes(message))
      .toBeLessThanOrEqual(MAX_MCP_DETAIL_NODES + RESULT_ENVELOPE_NODES);
    expect(isOutboundMessage(message)).toBe(true);
    await ctx.fiber.dispose();
  });

  it("accepts a logs page built at the entry cap", async () => {
    const ctx = new Context();
    provideMcp(ctx, {
      records: [maximalMcpRecord(0, headerAuth())],
      logs: maximalLogEntries(),
    });

    const result = readMcpLogs(ctx, "server-0");
    const message = {
      kind: "mcpLogs",
      requestId: "mcp-logs-max",
      result: { ok: true, ...result },
    };

    expect(result.entries).toHaveLength(MAX_MCP_LOG_ENTRIES);
    expect(result.entries[0]?.message).toHaveLength(MAX_MCP_LOG_MESSAGE_LENGTH);
    expect(result.entries[0]?.detail).toHaveLength(MAX_MCP_LOG_DETAIL_LENGTH);
    expect(countWireNodes(message))
      .toBeLessThanOrEqual(MAX_MCP_LOGS_MESSAGE_NODES + RESULT_ENVELOPE_NODES);
    expect(isOutboundMessage(message)).toBe(true);
    await ctx.fiber.dispose();
  });

  it("accepts a Web Search view with every endpoint override at its cap", async () => {
    const ctx = new Context();
    ctx.provide("webSearchManager", {
      getCatalog: () => ({
        engine: "searxng",
        engines: {
          tavily: { baseURL: MAX_URL },
          brave: { baseURL: MAX_URL },
          searxng: { baseURL: MAX_URL },
        },
      }),
      putCatalog: async (catalog: unknown) => catalog,
      describeSecrets: async () => ({
        TAVILY_API_KEY: { configured: true },
        BRAVE_API_KEY: { configured: true },
      }),
      putSecrets: async () => {},
      available: () => true,
    } as never);

    const view = await buildWebSearchView(ctx);
    const message = sectionMessage("web-search-max", view);

    expect(view.engines).toHaveLength(3);
    expect(view.secrets).toHaveLength(2);
    expect(countWireNodes(message))
      .toBeLessThanOrEqual(MAX_WEB_SEARCH_VIEW_NODES + MESSAGE_ENVELOPE_NODES);
    expect(isOutboundMessage(message)).toBe(true);
    await ctx.fiber.dispose();
  });

  it("rejects one over-cap payload per optional message family", () => {
    const server = {
      id: "server-over",
      serverName: "over",
      enabled: true,
      transport: "stdio" as const,
      command: "over",
      auth: { kind: "none" as const },
      toolCallTimeoutMs: 1_000,
      reconnect: {
        enabled: false,
        initialDelayMs: 1,
        maxDelayMs: 2,
        maxAttempts: 0,
      },
      createdAt: "created",
      updatedAt: "updated",
    };
    const listItem = () => ({
      server: { ...server, reconnect: { ...server.reconnect } },
      status: { state: "disconnected" as const },
      toolCount: 0,
      disabledToolCount: 0,
    });

    expect(isOutboundMessage(sectionMessage("mcp-over", {
      section: "mcp",
      servers: Array.from({ length: MAX_MCP_SERVERS + 1 }, listItem),
      secretStates: "available",
      oauth: { kind: "manual", reason: "no-callback-origin" },
    }))).toBe(false);

    expect(isOutboundMessage({
      kind: "mcpServer",
      requestId: "mcp-detail-over",
      result: {
        ok: true,
        detail: {
          server: { ...server, reconnect: { ...server.reconnect } },
          status: { state: "disconnected" },
          tools: Array.from({ length: MAX_MCP_TOOLS + 1 }, () => ({
            name: "tool",
            description: "",
            enabled: true,
          })),
          secrets: { kind: "unknown" },
        },
      },
    })).toBe(false);

    expect(isOutboundMessage({
      kind: "mcpLogs",
      requestId: "mcp-logs-over",
      result: {
        ok: true,
        serverId: "server-over",
        next: 1,
        entries: Array.from({ length: MAX_MCP_LOG_ENTRIES + 1 }, () => ({
          at: "at",
          level: "info",
          message: "message",
        })),
      },
    })).toBe(false);

    expect(isOutboundMessage(sectionMessage("web-search-over", {
      section: "web-search",
      engine: "tavily",
      engines: [
        { engine: "tavily", baseURLRequired: false },
        { engine: "brave", baseURLRequired: false },
        { engine: "searxng", baseURLRequired: true },
        { engine: "tavily", baseURLRequired: false },
      ],
      secrets: [],
      available: true,
    }))).toBe(false);
  });
});

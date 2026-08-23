import { Context } from "@deepseek-ai/cordis";
import {
  settingsNamespace,
  type SettingsDescriptor,
} from "@deepseek-ai/dsh-settings";
import {
  isOutboundMessage,
  SETTINGS_WIRE_SCAN_NODE_LIMIT,
} from "@dsh-vscode/contract";
import { describe, expect, it } from "vitest";
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
});

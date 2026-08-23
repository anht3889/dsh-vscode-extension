import { Context } from "@deepseek-ai/cordis";
import { settingsNamespace, type SettingsDescriptor } from "@deepseek-ai/dsh-settings";
import { isSettingsOutboundMessage } from "@dsh-vscode/contract";
import { describe, expect, it, vi } from "vitest";
import { buildPluginsView } from "./plugins.js";

const schema = {
  uid: 1,
  refs: {
    "1": {
      type: "object",
      meta: {},
      dict: {
        timeoutMs: 2,
        maxOutputBytes: 3,
        maxParallelToolCalls: 4,
        apiKeyEnv: 5,
        baseURL: 6,
        maxUses: 7,
        undeclaredCardField: 8,
      },
    },
    "2": { type: "number", meta: {} },
    "3": { type: "number", meta: {} },
    "4": { type: "number", meta: { min: 1, step: 1 } },
    "5": { type: "string", meta: { role: "credential-ref" } },
    "6": { type: "string", meta: {} },
    "7": { type: "number", meta: { min: 1, step: 1 } },
    "8": { type: "string", meta: {} },
  },
};

function descriptor(
  namespace: string,
  value: Record<string, unknown>,
): SettingsDescriptor {
  return {
    ns: settingsNamespace(namespace),
    schema,
    revision: 2,
    applies: "live",
    base: { ...value },
    user: {},
    value,
    secrets: [],
  };
}

describe("buildPluginsView", () => {
  it("projects only mounted specialized cards with exact schema fields", async () => {
    const ctx = new Context();
    ctx.provide("settings", {
      writable: false,
      describe: vi.fn(() => [
        descriptor("shell", { timeoutMs: 120_000, maxOutputBytes: 64_000 }),
        descriptor("agent-loop", { maxParallelToolCalls: 4 }),
        descriptor("unrelated", { undeclaredCardField: "hidden" }),
      ]),
    } as never);
    ctx.provide("pluginInventory", { list: () => ({ entries: [] }) } as never);

    const view = await buildPluginsView(ctx);

    expect(view.configurable).toEqual([
      {
        namespace: "shell",
        label: "Shell",
        fields: [
          { path: ["timeoutMs"], label: "Command timeout", kind: "number" },
          { path: ["maxOutputBytes"], label: "Maximum output bytes", kind: "number" },
        ],
      },
      {
        namespace: "agent-loop",
        label: "Agent Loop",
        fields: [{
          path: ["maxParallelToolCalls"],
          label: "Maximum parallel tool calls",
          kind: "number",
          min: 1,
          step: 1,
        }],
      },
    ]);
    expect(view.namespaces.map((item) => item.namespace)).toEqual([
      "shell",
      "agent-loop",
    ]);
    expect(view.namespaces.every((item) => item.writable === false)).toBe(true);
    await ctx.fiber.dispose();
  });

  it("describes web-search credential metadata without resolving or leaking values", async () => {
    const ctx = new Context();
    const resolve = vi.fn(async () => ({ value: "fixture-secret" }));
    ctx.provide("settings", {
      writable: true,
      describe: () => [descriptor("web-search-deepseek", {
        apiKeyEnv: "DEEPSEEK_API_KEY",
        baseURL: "https://search.example/v1",
        maxUses: 5,
      })],
    } as never);
    ctx.provide("credentials", {
      resolve,
      describe: async () => ({
        configured: true,
        source: "env",
        writable: false,
      }),
    } as never);
    ctx.provide("pluginInventory", { list: () => ({ entries: [] }) } as never);

    const view = await buildPluginsView(ctx);

    expect(view.configurable).toEqual([{
      namespace: "web-search-deepseek",
      label: "Web Search",
      credential: {
        ref: "DEEPSEEK_API_KEY",
        set: true,
        source: "env",
        writable: false,
      },
      credentialStatus: { kind: "ready" },
      fields: [
        { path: ["baseURL"], label: "Base URL", kind: "string" },
        {
          path: ["maxUses"],
          label: "Maximum uses",
          kind: "number",
          min: 1,
          step: 1,
        },
      ],
    }]);
    expect(resolve).not.toHaveBeenCalled();
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "plugins",
      view,
    })).toBe(true);
    expect(JSON.stringify(view)).not.toContain("fixture-secret");
    await ctx.fiber.dispose();
  });

  it("marks web-search credential metadata failed when storage is absent", async () => {
    const ctx = new Context();
    ctx.provide("settings", {
      writable: true,
      describe: () => [descriptor("web-search-deepseek", {
        apiKeyEnv: "DEEPSEEK_API_KEY",
        baseURL: "https://search.example/v1",
        maxUses: 5,
      })],
    } as never);
    ctx.provide("pluginInventory", { list: () => ({ entries: [] }) } as never);

    const view = await buildPluginsView(ctx);

    expect(view.configurable[0]).toEqual(expect.objectContaining({
      namespace: "web-search-deepseek",
      credentialStatus: {
        kind: "failed",
        message: "Credential metadata is unavailable",
      },
    }));
    expect(view.configurable[0]).not.toHaveProperty("credential");
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "plugins",
      view,
    })).toBe(true);
    expect(JSON.stringify(view)).not.toContain("fixture-secret");
    await ctx.fiber.dispose();
  });

  it("keeps inventory closed to the four authoritative fields", async () => {
    const ctx = new Context();
    ctx.provide("settings", { writable: true, describe: () => [] } as never);
    ctx.provide("pluginInventory", {
      list: () => ({
        entries: [{
          entryId: "entry-1",
          moduleName: "@deepseek-ai/dsh-agent-loop",
          enabled: true,
          fiberPhase: "active",
          description: "must not cross",
          config: { apiKey: "fixture-secret" },
        }],
      }),
    } as never);

    const view = await buildPluginsView(ctx);

    expect(view.inventory).toEqual([{
      entryId: "entry-1",
      moduleName: "@deepseek-ai/dsh-agent-loop",
      enabled: true,
      fiberPhase: "active",
    }]);
    expect(JSON.stringify(view.inventory)).not.toContain("description");
    expect(JSON.stringify(view.inventory)).not.toContain("config");
    expect(JSON.stringify(view.inventory)).not.toContain("fixture-secret");
    await ctx.fiber.dispose();
  });

  it("fails closed when inventory exceeds its bounded projection", async () => {
    const ctx = new Context();
    ctx.provide("settings", { writable: true, describe: () => [] } as never);
    ctx.provide("pluginInventory", {
      list: () => ({
        entries: Array.from({ length: 65 }, (_, index) => ({
          entryId: `entry-${index}`,
          moduleName: `plugin-${index}`,
          enabled: true,
          fiberPhase: null,
        })),
      }),
    } as never);

    await expect(buildPluginsView(ctx)).rejects.toThrow("at most 64 inventory entries");
    await ctx.fiber.dispose();
  });

  it("fails closed when the complete Plugins view exceeds projection bounds", async () => {
    const ctx = new Context();
    const options = Array.from({ length: 700 }, (_, index) => index + 10);
    const oversizedSchema = {
      uid: 1,
      refs: {
        "1": {
          type: "object",
          meta: {},
          dict: { timeoutMs: 2 },
        },
        "2": { type: "union", meta: {}, list: options },
        ...Object.fromEntries(options.map((id) => [
          String(id),
          { type: "const", meta: {}, value: `option-${id}` },
        ])),
      },
    };
    ctx.provide("settings", {
      writable: true,
      describe: () => [{
        ...descriptor("shell", { timeoutMs: 120_000 }),
        schema: oversizedSchema,
      }],
    } as never);
    ctx.provide("pluginInventory", { list: () => ({ entries: [] }) } as never);

    await expect(buildPluginsView(ctx)).rejects.toThrow(
      "Plugins settings view exceeds bridge projection limits",
    );
    await ctx.fiber.dispose();
  });
});

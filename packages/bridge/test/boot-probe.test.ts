import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startMockLlmServer } from "@deepseek-ai/dsh-llm-mock-server";
import type { MockLlmServer } from "@deepseek-ai/dsh-llm-mock-server";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import type { PresetRoot } from "@deepseek-ai/dsh-agent-presets";
import type { PluginInventoryEntry } from "@deepseek-ai/dsh-host-plugin-inventory";
import { createCapabilityWatcher } from "../src/settings/capabilities.js";
import {
  MCP_REQUIRED_MEMBERS,
  WEB_SEARCH_REQUIRED_MEMBERS,
} from "../src/settings/optional-services.js";
import {
  bootTree,
  HOST_REGISTRAR_PACKAGES,
  optionalServiceStub,
} from "./boot.js";

// The boot probe proves the composition is correct before we wire `runVscode`.
describe("boot probe", () => {
  let mock: MockLlmServer;

  beforeAll(async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    mock = await startMockLlmServer({
      sequence: ["success"],
      repeatLast: true,
      successText: "hello",
    });
  });

  afterAll(async () => {
    await mock.close();
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("mounts agents + agentDefaultModel and selects deepseek-official", async () => {
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });

    const agents = ctx.get("agents");
    const defaultModel = ctx.get("agentDefaultModel");
    expect(agents).toBeDefined();
    expect(defaultModel).toBeDefined();

    const selection = defaultModel!.currentSelection();
    expect(selection.provider).toBe("deepseek-official");
    expect(selection.model).toBe("mock-model");
  });

  it("mounts settings services and General namespaces", async () => {
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });

    expect(ctx.get("settings")).toBeDefined();
    expect(ctx.get("credentials")).toBeDefined();
    expect(ctx.get("agentPresets")).toBeDefined();
    expect(ctx.get("pluginInventory")).toBeDefined();
    const capabilities = createCapabilityWatcher(ctx);
    expect(capabilities.sections()).toEqual([]);
    capabilities.dispose();

    const agentPresets = ctx.get("agentPresets")!;
    expect(agentPresets.authorable).toBe(true);
    expect(agentPresets.roots).toEqual([
      { path: dshHomePath(".agent-presets"), trust: "user" },
    ]);
    expect(agentPresets.roots.some((root: PresetRoot) => root.trust === "system")).toBe(
      false,
    );

    const snapshot = ctx.get("pluginInventory")!.list();
    expect(snapshot.entries.length).toBeGreaterThanOrEqual(
      HOST_REGISTRAR_PACKAGES.length,
    );
    for (const entry of snapshot.entries) {
      expect(entry).toEqual({
        entryId: expect.any(String),
        moduleName: expect.any(String),
        enabled: expect.any(Boolean),
        fiberPhase: expect.toSatisfy(
          (phase: unknown) =>
            phase === null ||
            phase === "pending" ||
            phase === "loading" ||
            phase === "active" ||
            phase === "failed" ||
            phase === "unloading",
        ),
      });
    }

    const moduleNames = snapshot.entries.map(
      (entry: PluginInventoryEntry) => entry.moduleName,
    );
    expect(moduleNames).toEqual(
      expect.arrayContaining([...HOST_REGISTRAR_PACKAGES]),
    );

    for (const moduleName of HOST_REGISTRAR_PACKAGES) {
      expect(snapshot.entries.find((entry: PluginInventoryEntry) => entry.moduleName === moduleName))
        .toEqual({
          entryId: expect.any(String),
          moduleName,
          enabled: true,
          fiberPhase: "active",
        });
    }

    const namespaces = ctx.get("settings")!
      .describe({ redactSecrets: true })
      .map((item) => String(item.ns));

    expect(namespaces).toEqual(expect.arrayContaining([
      "permission",
      "agent-presets",
      "locale",
      "ui-theme",
      "ui-conversation",
      "agent-loop",
    ]));
  });

  it("detects optional services mounted on the booted tree", async () => {
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });
    ctx.provide("mcp", optionalServiceStub(MCP_REQUIRED_MEMBERS) as never);
    ctx.provide(
      "webSearchManager",
      optionalServiceStub(WEB_SEARCH_REQUIRED_MEMBERS) as never,
    );
    const capabilities = createCapabilityWatcher(ctx);

    expect(capabilities.sections()).toEqual(["mcp", "web-search"]);

    capabilities.dispose();
    await ctx.fiber.dispose();
  });

  it("withholds an incomplete MCP service and warns once per generation", async () => {
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });
    const warn = vi.fn();
    const capabilities = createCapabilityWatcher(ctx, warn);
    const incomplete = () =>
      optionalServiceStub(MCP_REQUIRED_MEMBERS, ["getTools"]) as never;

    const first = ctx.provide("mcp", incomplete());
    expect(capabilities.sections()).toEqual([]);
    expect(capabilities.sections()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("getTools");

    await first();
    const second = ctx.provide("mcp", incomplete());
    expect(capabilities.sections()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);

    await second();
    capabilities.dispose();
    await ctx.fiber.dispose();
  });

  it("pushes a capability change when an optional service mounts and unmounts", async () => {
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });
    const capabilities = createCapabilityWatcher(ctx);
    const changes: string[][] = [];
    capabilities.onChange((sections) => changes.push(sections));

    const dispose = ctx.provide(
      "webSearchManager",
      optionalServiceStub(WEB_SEARCH_REQUIRED_MEMBERS) as never,
    );
    expect(changes).toEqual([["web-search"]]);
    expect(capabilities.sections()).toEqual(["web-search"]);

    await dispose();
    expect(changes).toEqual([["web-search"], []]);
    expect(capabilities.sections()).toEqual([]);

    capabilities.dispose();
    await ctx.fiber.dispose();
  });
});

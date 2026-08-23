import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startMockLlmServer } from "@deepseek-ai/dsh-llm-mock-server";
import type { MockLlmServer } from "@deepseek-ai/dsh-llm-mock-server";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import type { PresetRoot } from "@deepseek-ai/dsh-agent-presets";
import type { PluginInventoryEntry } from "@deepseek-ai/dsh-host-plugin-inventory";
import { bootTree, HOST_REGISTRAR_PACKAGES } from "./boot.js";

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
});

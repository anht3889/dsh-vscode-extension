import { Context } from "@deepseek-ai/cordis";
import { settingsNamespace, type SettingsDescriptor } from "@deepseek-ai/dsh-settings";
import { describe, expect, it, vi } from "vitest";
import {
  buildAgentPresetsView,
  copyAgentPreset,
  deleteAgentPreset,
  readAgentPreset,
} from "./presets.js";

function descriptor(
  value: Record<string, unknown>,
  base: Record<string, unknown> = { default: "standard" },
): SettingsDescriptor {
  return {
    ns: settingsNamespace("agent-presets"),
    schema: {},
    revision: 3,
    applies: "live",
    base,
    user: value,
    value: { ...base, ...value },
    secrets: [],
  };
}

const roster = [
  {
    id: "standard",
    trust: "system" as const,
    path: "/system/standard/cordis.yml",
    name: "Standard",
    description: "The shipped default",
  },
  {
    id: "mine",
    trust: "user" as const,
    path: "/home/me/.dsh/presets/mine/cordis.yml",
    broken: "not valid YAML",
  },
];

describe("agent preset settings adapter", () => {
  it("projects bounded default, trust, broken, and user ownership state", async () => {
    const ctx = new Context();
    ctx.provide("settings", {
      writable: true,
      describe: () => [descriptor({ default: "mine" })],
    } as never);
    ctx.provide("agentPresets", { list: async () => roster } as never);

    const view = await buildAgentPresetsView(ctx);

    expect(view.namespace).toEqual(expect.objectContaining({
      namespace: "agent-presets",
      value: { default: "mine" },
    }));
    expect(view.presets).toEqual([
      {
        id: "standard",
        trust: "system",
        name: "Standard",
        description: "The shipped default",
        removable: false,
        openable: false,
      },
      {
        id: "mine",
        trust: "user",
        broken: "not valid YAML",
        removable: true,
        openable: true,
      },
    ]);
    await ctx.fiber.dispose();
  });

  it("reads exact composition content and trust", async () => {
    const ctx = new Context();
    ctx.provide("agentPresets", {
      resolve: async () => roster[1],
      read: async () => "- id: tools\n  name: ./tools.js\n",
    } as never);

    await expect(readAgentPreset(ctx, "mine")).resolves.toEqual({
      presetId: "mine",
      trust: "user",
      content: "- id: tools\n  name: ./tools.js\n",
    });
    await ctx.fiber.dispose();
  });

  it("accepts preset content exactly at 256 KiB and rejects one byte above", async () => {
    const ctx = new Context();
    let content = "a".repeat(256 * 1024);
    ctx.provide("agentPresets", {
      resolve: async () => roster[1],
      read: async () => content,
    } as never);

    await expect(readAgentPreset(ctx, "mine")).resolves.toEqual({
      presetId: "mine",
      trust: "user",
      content,
    });

    content += "b";
    await expect(readAgentPreset(ctx, "mine"))
      .rejects.toThrow("content exceeds the bridge read limit");
    await ctx.fiber.dispose();
  });

  it("validates copy source, target id, and display name before copying", async () => {
    const ctx = new Context();
    const copy = vi.fn(async () => {});
    ctx.provide("agentPresets", { list: async () => [], copy } as never);

    await expect(copyAgentPreset(ctx, "standard", "my-copy", "My Copy"))
      .resolves.toBeUndefined();
    expect(copy).toHaveBeenCalledWith("standard", "my-copy", "My Copy");

    await expect(copyAgentPreset(ctx, "Bad Source", "my-copy", "My Copy"))
      .rejects.toThrow("source preset id");
    await expect(copyAgentPreset(ctx, "standard", "../escape", "My Copy"))
      .rejects.toThrow("new preset id");
    await expect(copyAgentPreset(ctx, "standard", "my-copy", "   "))
      .rejects.toThrow("display name");
    expect(copy).toHaveBeenCalledTimes(1);
    await ctx.fiber.dispose();
  });

  it("rejects a new destination at the 64-preset limit before writing", async () => {
    const ctx = new Context();
    const copy = vi.fn(async () => {});
    let listed = Array.from({ length: 64 }, (_, index) => ({
      id: `preset-${index}`,
      trust: "system" as const,
      path: `/system/preset-${index}/cordis.yml`,
    }));
    ctx.provide("agentPresets", {
      list: async () => listed,
      copy,
    } as never);

    await expect(copyAgentPreset(ctx, "preset-0", "new-preset", "New Preset"))
      .rejects.toThrow("at most 64 presets");
    expect(copy).not.toHaveBeenCalled();

    listed = listed.slice(0, 63);
    await expect(copyAgentPreset(ctx, "preset-0", "new-preset", "New Preset"))
      .resolves.toBeUndefined();
    expect(copy).toHaveBeenCalledWith("preset-0", "new-preset", "New Preset");
    await ctx.fiber.dispose();
  });

  it("rejects an existing destination because DSH copy never replaces", async () => {
    const ctx = new Context();
    const copy = vi.fn(async () => {});
    ctx.provide("agentPresets", {
      list: async () => roster,
      copy,
    } as never);

    await expect(copyAgentPreset(ctx, "standard", "mine", "Replacement"))
      .rejects.toThrow("already exists");
    expect(copy).not.toHaveBeenCalled();
    await ctx.fiber.dispose();
  });

  it("deletes only user presets and requires a composed fallback for the default", async () => {
    const ctx = new Context();
    const remove = vi.fn(async () => {});
    let currentDescriptor = descriptor({ default: "mine" });
    ctx.provide("settings", {
      writable: true,
      describe: () => [currentDescriptor],
    } as never);
    ctx.provide("agentPresets", {
      list: async () => roster,
      resolve: async (id: string) => roster.find((item) => item.id === id),
      remove,
    } as never);

    await expect(deleteAgentPreset(ctx, "standard"))
      .rejects.toThrow("system preset");
    await expect(deleteAgentPreset(ctx, "mine")).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith("mine");

    currentDescriptor = descriptor({ default: "mine" }, {});
    await expect(deleteAgentPreset(ctx, "mine"))
      .rejects.toThrow("replacement default");
    currentDescriptor = descriptor({ default: "mine" }, { default: "mine" });
    await expect(deleteAgentPreset(ctx, "mine"))
      .rejects.toThrow("replacement default");
    expect(remove).toHaveBeenCalledTimes(1);
    await ctx.fiber.dispose();
  });

  it("fails closed when the roster exceeds its projection bound", async () => {
    const ctx = new Context();
    ctx.provide("agentPresets", {
      list: async () => Array.from({ length: 65 }, (_, index) => ({
        id: `preset-${index}`,
        trust: "system",
        path: `/system/preset-${index}/cordis.yml`,
      })),
    } as never);

    await expect(buildAgentPresetsView(ctx)).rejects.toThrow("at most 64 presets");
    await ctx.fiber.dispose();
  });
});

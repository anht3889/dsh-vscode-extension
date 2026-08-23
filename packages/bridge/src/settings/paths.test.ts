import { describe, expect, it, vi } from "vitest";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { resolveSettingsTarget } from "./paths.js";

describe("trusted settings paths", () => {
  it("resolves the DSH home without accepting a caller path", async () => {
    await expect(resolveSettingsTarget({ get: () => undefined } as never, {
      kind: "dsh-home",
    })).resolves.toEqual({
      target: "dsh-home",
      path: resolveDshHome(),
    });
  });

  it("prepares and returns the mounted settings document", async () => {
    const prepareDocument = vi.fn(async () => "/tmp/dsh/settings.yaml");
    const ctx = {
      get: (name: string) => name === "settings"
        ? { documentPath: "/tmp/dsh/settings.yaml", prepareDocument }
        : undefined,
    };

    await expect(resolveSettingsTarget(ctx as never, {
      kind: "settings-document",
      prepare: true,
    })).resolves.toEqual({
      target: "settings-document",
      path: "/tmp/dsh/settings.yaml",
    });
    expect(prepareDocument).toHaveBeenCalledOnce();
  });

  it("returns only a resolved user preset composition path", async () => {
    const resolve = vi.fn(async (id: string) => ({
      id,
      trust: "user",
      path: `/tmp/dsh/presets/${id}/cordis.yml`,
    }));
    const ctx = {
      get: (name: string) => name === "agentPresets" ? { resolve } : undefined,
    };

    await expect(resolveSettingsTarget(ctx as never, {
      kind: "agent-preset",
      presetId: "mine",
    })).resolves.toEqual({
      target: "agent-preset",
      path: "/tmp/dsh/presets/mine/cordis.yml",
    });
  });

  it("rejects system and unknown preset targets", async () => {
    const system = {
      get: () => ({
        resolve: async () => ({
          id: "standard",
          trust: "system",
          path: "/app/presets/standard/cordis.yml",
        }),
      }),
    };
    const unknown = {
      get: () => ({
        resolve: async () => {
          throw new Error("preset not found");
        },
      }),
    };

    await expect(resolveSettingsTarget(system as never, {
      kind: "agent-preset",
      presetId: "standard",
    })).rejects.toThrow(/user preset/);
    await expect(resolveSettingsTarget(unknown as never, {
      kind: "agent-preset",
      presetId: "unknown",
    })).rejects.toThrow(/preset not found/);
  });
});

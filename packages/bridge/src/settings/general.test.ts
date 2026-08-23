import { describe, expect, it, vi } from "vitest";
import { settingsNamespace, type SettingsDescriptor } from "@deepseek-ai/dsh-settings";
import { buildGeneralView } from "./general.js";

const described = (namespace: string): SettingsDescriptor => ({
  ns: settingsNamespace(namespace),
  schema: {},
  revision: 1,
  applies: "live",
  value: { enabled: true },
});

describe("General settings view", () => {
  it("includes only mounted General namespaces and current service choices", async () => {
    const describe = vi.fn(() => [
      described("ui-conversation"),
      described("agent-loop"),
      described("agent-presets"),
      described("ui-theme"),
      described("llm-deepseek"),
      described("locale"),
      described("permission"),
    ]);
    const ctx = {
      get(name: string) {
        if (name === "settings") return { writable: true, describe };
        if (name === "agentPresets") {
          return {
            list: async () => [
              { id: "standard", trust: "system", path: "/system", name: "Standard" },
              { id: "mine", trust: "user", path: "/user" },
            ],
          };
        }
        if (name === "permissionPresets") {
          return {
            names: ["workspace-write", "danger-full-access"],
            optionOf: (id: string) => ({
              value: id,
              name: id === "workspace-write" ? "Workspace Write" : "Full Access",
            }),
            resolve: (id: string) => ({
              sandbox: id === "danger-full-access"
                ? "danger-full-access"
                : "workspace-write",
              approval: id === "danger-full-access" ? "never" : "ask",
            }),
          };
        }
        return undefined;
      },
    };

    const view = await buildGeneralView(ctx as never);

    expect(describe).toHaveBeenCalledWith({ redactSecrets: true });
    expect(view.namespaces.map((item) => item.namespace)).toEqual([
      "agent-presets",
      "permission",
      "locale",
      "ui-theme",
      "ui-conversation",
    ]);
    expect(view.agentPresets).toEqual([
      { id: "standard", label: "Standard", trust: "system" },
      { id: "mine", label: "mine", trust: "user" },
    ]);
    expect(view.permissionPresets).toEqual([
      { id: "workspace-write", label: "Workspace Write", dangerous: false },
      { id: "danger-full-access", label: "Full Access", dangerous: true },
    ]);
  });

  it("makes provider read-only state explicit and omits unavailable choices", async () => {
    const ctx = {
      get(name: string) {
        if (name === "settings") {
          return {
            writable: false,
            describe: () => [described("locale")],
          };
        }
        return undefined;
      },
    };

    const view = await buildGeneralView(ctx as never);

    expect(view.namespaces[0]?.writable).toBe(false);
    expect(view.agentPresets).toEqual([]);
    expect(view.permissionPresets).toEqual([]);
  });

  it("caps service choices before the protocol validator node limit", async () => {
    const many = Array.from({ length: 5000 }, (_, index) => ({
      id: `preset-${index}`,
      trust: "user",
      path: `/user/${index}`,
    }));
    const ctx = {
      get(name: string) {
        if (name === "settings") {
          return { writable: true, describe: () => [described("agent-presets")] };
        }
        if (name === "agentPresets") return { list: async () => many };
        return undefined;
      },
    };

    const view = await buildGeneralView(ctx as never);

    expect(view.agentPresets.length).toBeLessThan(5000);
  });
});

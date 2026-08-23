import { describe, expect, it, vi } from "vitest";
import type {
  GeneralSettingsView,
  MutateSettingsCommand,
  SettingsMutationMessage,
  SettingsNamespaceWire,
} from "@dsh-vscode/contract";
import { GeneralController, mutationFor } from "./GeneralController.js";

function namespace(
  id: string,
  revision: number,
  value: Record<string, unknown>,
  user: Record<string, unknown> = {},
  writable = true,
): SettingsNamespaceWire {
  return {
    namespace: id,
    revision,
    applies: "live",
    writable,
    base: value,
    user,
    value,
    secrets: [],
  };
}

function view(namespaces: SettingsNamespaceWire[]): GeneralSettingsView {
  return {
    section: "general",
    namespaces,
    agentPresets: [{ id: "standard", label: "Standard", trust: "system" }],
    permissionPresets: [
      { id: "workspace-write", label: "Workspace Write", dangerous: false },
    ],
  };
}

describe("GeneralController", () => {
  it("maps every row to its exact namespace field", () => {
    expect(mutationFor("agent-preset", "standard", 1)).toEqual({
      kind: "mutateSettings",
      namespace: "agent-presets",
      expectedRevision: 1,
      ops: [{ op: "set", path: ["default"], value: "standard" }],
    });
    expect(mutationFor("permission", "workspace-write", 2)).toEqual({
      kind: "mutateSettings",
      namespace: "permission",
      expectedRevision: 2,
      ops: [{ op: "set", path: ["defaultPreset"], value: "workspace-write" }],
    });
    expect(mutationFor("locale", "en", 4)).toEqual({
      kind: "mutateSettings",
      namespace: "locale",
      expectedRevision: 4,
      ops: [{ op: "set", path: ["preference"], value: "en" }],
    });
    expect(mutationFor("appearance", "dark", 5)).toEqual({
      kind: "mutateSettings",
      namespace: "ui-theme",
      expectedRevision: 5,
      ops: [{ op: "set", path: ["preference"], value: "dark" }],
    });
    expect(mutationFor("busy-enter", "steer", 6)).toEqual({
      kind: "mutateSettings",
      namespace: "ui-conversation",
      expectedRevision: 6,
      ops: [{ op: "set", path: ["busyEnter"], value: "steer" }],
    });
    expect(mutationFor("locale", "", 4, true)).toEqual({
      kind: "mutateSettings",
      namespace: "locale",
      expectedRevision: 4,
      ops: [{ op: "unset", path: ["preference"] }],
    });
  });

  it("unsets locale preference for the system default language option", () => {
    const send = vi.fn();
    const controller = new GeneralController(send, vi.fn(), () => "locale-unset");
    controller.updateView(view([
      namespace("locale", 4, { preference: "en" }, { preference: "en" }),
    ]));
    controller.select("locale", "");

    expect(send).toHaveBeenCalledWith({
      requestId: "locale-unset",
      kind: "mutateSettings",
      namespace: "locale",
      expectedRevision: 4,
      ops: [{ op: "unset", path: ["preference"] }],
    });
  });

  it("omits unavailable rows and disables read-only resolved rows", () => {
    const controller = new GeneralController(vi.fn(), vi.fn());
    controller.updateView(view([
      namespace("locale", 1, { preference: "en" }, {}, false),
    ]));
    expect(controller.snapshot().rows.map((row) => row.id)).toEqual(["locale"]);
    expect(controller.snapshot().rows[0]).toMatchObject({
      value: "en",
      writable: false,
      overridden: false,
    });
  });

  it("serializes writes per namespace and rolls back a rejection", () => {
    const sent: Array<{ requestId: string; expectedRevision: number; ops: unknown }> = [];
    const controller = new GeneralController(
      (command) => sent.push(command),
      vi.fn(),
      () => `request-${sent.length + 1}`,
    );
    controller.updateView(view([
      namespace("locale", 4, { preference: "en" }),
    ]));
    controller.select("locale", "zh");
    controller.select("locale", "en");
    expect(sent).toHaveLength(1);
    expect(controller.snapshot().rows[0]?.value).toBe("en");

    controller.receive({
      kind: "settingsMutation",
      requestId: "request-1",
      result: {
        ok: true,
        namespace: namespace("locale", 5, { preference: "zh" }, { preference: "zh" }),
      },
    });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ expectedRevision: 5 });

    controller.receive({
      kind: "settingsMutation",
      requestId: "request-2",
      result: {
        ok: false,
        error: { code: "settings-rejected", message: "rejected" },
      },
    });
    expect(controller.snapshot().rows[0]).toMatchObject({
      value: "zh",
      status: "error",
      error: "rejected",
    });
  });

  it("preserves the desired value on conflict and retries with refreshed revision", () => {
    const sent: Array<{ requestId: string; expectedRevision: number }> = [];
    const refresh = vi.fn();
    const controller = new GeneralController(
      (command) => sent.push(command),
      refresh,
      () => `request-${sent.length + 1}`,
    );
    controller.updateView(view([
      namespace("ui-theme", 2, { preference: "system" }),
    ]));
    controller.select("appearance", "dark");
    const conflict: SettingsMutationMessage = {
      kind: "settingsMutation",
      requestId: "request-1",
      result: {
        ok: false,
        error: {
          code: "settings-conflict",
          message: "changed elsewhere",
          namespace: "ui-theme",
          currentRevision: 3,
        },
      },
    };
    controller.receive(conflict);
    expect(controller.snapshot().rows[0]).toMatchObject({
      value: "dark",
      status: "conflict",
    });
    expect(refresh).toHaveBeenCalledOnce();

    controller.updateView(view([
      namespace("ui-theme", 3, { preference: "light" }),
    ]));
    controller.retry("appearance");
    expect(sent[1]).toMatchObject({ expectedRevision: 3 });
  });

  it("rejects reset while the namespace has an in-flight mutation", () => {
    const sent: MutateSettingsCommand[] = [];
    const controller = new GeneralController(
      (command) => sent.push(command),
      vi.fn(),
      () => `request-${sent.length + 1}`,
    );
    controller.updateView(view([
      namespace(
        "locale",
        4,
        { preference: "en" },
        { preference: "en" },
      ),
    ]));
    controller.select("locale", "zh");
    controller.reset("locale");
    expect(sent).toHaveLength(1);

    controller.receive({
      kind: "settingsMutation",
      requestId: "request-1",
      result: {
        ok: true,
        namespace: namespace(
          "locale",
          5,
          { preference: "zh" },
          { preference: "zh" },
        ),
      },
    });
    expect(controller.snapshot().rows[0]).toMatchObject({
      status: "idle",
      value: "zh",
    });
  });

  it("ignores a wrong-namespace success until the matching namespace settles", () => {
    const sent: MutateSettingsCommand[] = [];
    const controller = new GeneralController(
      (command) => sent.push(command),
      vi.fn(),
      () => "general-pending",
    );
    controller.updateView(view([
      namespace("locale", 3, { preference: "en" }),
    ]));
    controller.select("locale", "zh");

    expect(controller.receive({
      kind: "settingsMutation",
      requestId: "general-pending",
      result: {
        ok: true,
        namespace: namespace("ui-theme", 9, { preference: "dark" }),
      },
    })).toBe(false);
    expect(controller.snapshot().rows[0]).toMatchObject({
      value: "zh",
      status: "saving",
      namespace: { namespace: "locale", revision: 3 },
    });

    controller.receive({
      kind: "settingsMutation",
      requestId: "general-pending",
      result: {
        ok: true,
        namespace: namespace(
          "locale",
          4,
          { preference: "zh" },
          { preference: "zh" },
        ),
      },
    });
    expect(controller.snapshot().rows[0]).toMatchObject({
      value: "zh",
      status: "idle",
      namespace: { namespace: "locale", revision: 4 },
    });
  });

  it("settles disconnect ownership and rejects late or mismatched namespaces", () => {
    const sent: MutateSettingsCommand[] = [];
    const controller = new GeneralController(
      (command) => sent.push(command),
      vi.fn(),
      () => "general-pending",
    );
    controller.updateView(view([
      namespace("ui-theme", 4, { preference: "system" }),
    ]));
    controller.select("appearance", "dark");

    controller.receive({
      kind: "settingsMutation",
      requestId: "general-pending",
      result: {
        ok: true,
        namespace: namespace("locale", 9, { preference: "zh" }),
      },
    });
    expect(controller.snapshot().rows[0]).toMatchObject({
      value: "dark",
      status: "saving",
      namespace: { namespace: "ui-theme", revision: 4 },
    });

    controller.disconnect();
    controller.receive({
      kind: "settingsMutation",
      requestId: "general-pending",
      result: {
        ok: true,
        namespace: namespace("ui-theme", 5, { preference: "dark" }),
      },
    });
    expect(controller.snapshot().rows[0]).toMatchObject({
      value: "dark",
      status: "idle",
      namespace: { namespace: "ui-theme", revision: 4 },
    });
  });
});

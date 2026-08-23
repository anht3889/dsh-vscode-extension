import { describe, expect, it, vi } from "vitest";
import type {
  AgentPresetContentMessage,
  AgentPresetsSettingsView,
  SettingsInboundCommand,
  SettingsMutationMessage,
} from "@dsh-vscode/contract";
import type { SettingsHostResultMessage } from "../../../vscode.js";
import { AgentPresetsController } from "./AgentPresetsController.js";

const namespace = {
  namespace: "agent-presets",
  revision: 4,
  applies: "live" as const,
  writable: true,
  base: { default: "standard" },
  user: { default: "mine" },
  value: { default: "mine" },
  secrets: [],
};

const view: AgentPresetsSettingsView = {
  section: "agent-presets",
  namespace,
  presets: [
    {
      id: "mine",
      trust: "user",
      name: "Mine",
      description: "Personal",
      removable: true,
      openable: true,
    },
    {
      id: "standard",
      trust: "system",
      name: "Standard",
      description: "Shipped",
      removable: false,
      openable: false,
    },
    {
      id: "broken",
      trust: "user",
      broken: "invalid YAML",
      removable: true,
      openable: true,
    },
  ],
};

function fixture() {
  const sent: SettingsInboundCommand[] = [];
  const host: unknown[] = [];
  const refreshPresets = vi.fn();
  const refreshGeneral = vi.fn();
  let id = 0;
  const controller = new AgentPresetsController(
    (command) => sent.push(command),
    (command) => host.push(command),
    refreshPresets,
    refreshGeneral,
    () => `request-${++id}`,
  );
  controller.updateView(view);
  return { controller, sent, host, refreshPresets, refreshGeneral };
}

function success(requestId: string, updated = namespace): SettingsMutationMessage {
  return {
    kind: "settingsMutation",
    requestId,
    result: { ok: true, namespace: updated },
  };
}

describe("AgentPresetsController", () => {
  it("groups system before user while retaining authoritative roster order and metadata", () => {
    const { controller } = fixture();
    expect(controller.snapshot().rows.map((row) => row.id)).toEqual([
      "standard",
      "mine",
      "broken",
    ]);
    expect(controller.snapshot().rows[1]).toEqual(expect.objectContaining({
      trust: "user",
      description: "Personal",
      removable: true,
      openable: true,
      isDefault: true,
    }));
    expect(controller.snapshot().rows[2]?.broken).toBe("invalid YAML");
  });

  it("reads lazily, correlates the viewer response, and ignores stale content", () => {
    const { controller, sent } = fixture();
    controller.view("standard");
    controller.view("mine");
    expect(sent.slice(-2)).toEqual([
      { kind: "readAgentPreset", requestId: "request-1", presetId: "standard" },
      { kind: "readAgentPreset", requestId: "request-2", presetId: "mine" },
    ]);

    controller.receiveContent({
      kind: "agentPresetContent",
      requestId: "request-1",
      result: {
        ok: true,
        presetId: "standard",
        trust: "system",
        content: "<img src=x onerror=alert(1)>",
      },
    });
    expect(controller.snapshot().viewer?.status).toBe("loading");

    controller.receiveContent({
      kind: "agentPresetContent",
      requestId: "request-2",
      result: {
        ok: true,
        presetId: "standard",
        trust: "system",
        content: "wrong correlated preset",
      },
    });
    expect(controller.snapshot().viewer?.status).toBe("loading");

    controller.receiveContent({
      kind: "agentPresetContent",
      requestId: "request-2",
      result: {
        ok: true,
        presetId: "mine",
        trust: "user",
        content: "plugins:\n  - ./mine.ts\n",
      },
    });
    expect(controller.snapshot().viewer).toEqual({
      presetId: "mine",
      status: "ready",
      content: "plugins:\n  - ./mine.ts\n",
    });
  });

  it("writes the default with the preset namespace revision and preserves conflicts", () => {
    const { controller, sent, refreshGeneral, refreshPresets } = fixture();
    expect(controller.makeDefault("standard")).toBe(true);
    expect(sent.at(-1)).toEqual({
      kind: "mutateSettings",
      requestId: "request-1",
      namespace: "agent-presets",
      expectedRevision: 4,
      ops: [{ op: "set", path: ["default"], value: "standard" }],
    });

    controller.receiveMutation({
      kind: "settingsMutation",
      requestId: "request-1",
      result: {
        ok: false,
        error: {
          code: "settings-conflict",
          message: "changed",
          namespace: "agent-presets",
          currentRevision: 6,
        },
      },
    });
    expect(controller.snapshot().defaultChange).toEqual(expect.objectContaining({
      desired: "standard",
      status: "conflict",
      retryable: false,
    }));
    expect(refreshGeneral).toHaveBeenCalled();
    expect(refreshPresets).toHaveBeenCalled();

    controller.updateView({
      ...view,
      namespace: { ...namespace, revision: 6 },
    });
    expect(controller.snapshot().defaultChange?.retryable).toBe(true);
    controller.retryDefault();
    expect(sent.at(-1)).toEqual(expect.objectContaining({
      expectedRevision: 6,
      ops: [{ op: "set", path: ["default"], value: "standard" }],
    }));
    controller.receiveMutation({
      kind: "settingsMutation",
      requestId: "request-2",
      result: {
        ok: false,
        error: {
          code: "settings-conflict",
          message: "changed again",
          namespace: "agent-presets",
          currentRevision: 7,
        },
      },
    });
    controller.updateView({
      ...view,
      namespace: { ...namespace, revision: 7, value: { default: "mine" } },
    });
    controller.discardDefault();
    expect(controller.snapshot()).toMatchObject({
      currentDefault: "mine",
      dirty: false,
    });
    expect(controller.snapshot().defaultChange).toBeUndefined();
  });

  it("does not settle a default write from another namespace", () => {
    const { controller } = fixture();
    controller.makeDefault("standard");

    expect(controller.receiveMutation({
      kind: "settingsMutation",
      requestId: "request-1",
      result: {
        ok: true,
        namespace: { ...namespace, namespace: "locale" },
      },
    })).toBe(false);
    expect(controller.snapshot().defaultChange).toMatchObject({
      desired: "standard",
      status: "saving",
    });
  });

  it("refreshes Agent Presets and General after default success", () => {
    const { controller, sent, refreshGeneral, refreshPresets } = fixture();
    controller.makeDefault("standard");
    controller.receiveMutation(success(
      (sent.at(-1) as { requestId: string }).requestId,
      {
        ...namespace,
        revision: 5,
        user: { default: "standard" },
        value: { default: "standard" },
      },
    ));
    expect(refreshPresets).toHaveBeenCalledOnce();
    expect(refreshGeneral).toHaveBeenCalledOnce();
    expect(controller.snapshot().currentDefault).toBe("standard");
  });

  it("validates distinct copy source, destination id, non-empty name, and roster cap errors", () => {
    const { controller, sent } = fixture();
    controller.beginCopy("standard");
    controller.setCopyId("Bad Id");
    controller.setCopyName(" ");
    expect(controller.snapshot().copy).toEqual(expect.objectContaining({
      idError: "presetsIdInvalid",
      nameError: "validationRequired",
    }));
    expect(controller.copy()).toBe(false);

    controller.setCopyId("standard");
    controller.setCopyName("Standard copy");
    expect(controller.snapshot().copy?.idError).toBe("presetsIdTaken");

    controller.setCopyId("standard-copy");
    controller.setCopyName(" Standard copy ");
    expect(controller.copy()).toBe(true);
    expect(sent.at(-1)).toEqual({
      kind: "copyAgentPreset",
      requestId: "request-1",
      fromPresetId: "standard",
      presetId: "standard-copy",
      name: "Standard copy",
    });
    controller.receiveMutation({
      kind: "settingsMutation",
      requestId: "request-1",
      result: {
        ok: false,
        error: {
          code: "preset-rejected",
          message: "Agent Presets settings supports at most 64 presets",
        },
      },
    });
    expect(controller.snapshot().copy).toEqual(expect.objectContaining({
      status: "error",
      error: "Agent Presets settings supports at most 64 presets",
    }));
  });

  it("refreshes both roster consumers after a correlated copy result", () => {
    const { controller, sent, refreshGeneral, refreshPresets } = fixture();
    controller.beginCopy("standard");
    controller.setCopyId("copy");
    controller.setCopyName("Copy");
    controller.copy();
    controller.receiveMutation(success((sent.at(-1) as { requestId: string }).requestId));
    expect(controller.snapshot().copy).toBeUndefined();
    expect(refreshGeneral).toHaveBeenCalledOnce();
    expect(refreshPresets).toHaveBeenCalledOnce();
  });

  it("allows delete only for removable user presets", () => {
    const { controller } = fixture();
    expect(controller.beginDelete("standard")).toBe(false);
    expect(controller.beginDelete("mine")).toBe(true);
    expect(controller.snapshot().deletion?.presetId).toBe("mine");
  });

  it("deletes a non-default user preset without a default mutation", () => {
    const { controller, sent } = fixture();
    controller.updateView({
      ...view,
      namespace: {
        ...namespace,
        user: { default: "standard" },
        value: { default: "standard" },
      },
    });
    controller.beginDelete("mine");
    expect(controller.deletePreset()).toBe(true);
    expect(sent).toEqual([{
      kind: "deleteAgentPreset",
      requestId: "request-1",
      presetId: "mine",
    }]);
  });

  it("changes a current default to a distinct fallback before deleting", () => {
    const { controller, sent } = fixture();
    controller.beginDelete("mine");
    expect(controller.deletePreset()).toBe(false);
    controller.setDeleteFallback("standard");
    expect(controller.deletePreset()).toBe(true);
    expect(sent.at(-1)).toEqual({
      kind: "mutateSettings",
      requestId: "request-1",
      namespace: "agent-presets",
      expectedRevision: 4,
      ops: [{ op: "set", path: ["default"], value: "standard" }],
    });
    controller.receiveMutation(success("request-1", {
      ...namespace,
      revision: 5,
      user: { default: "standard" },
      value: { default: "standard" },
    }));
    expect(sent.at(-1)).toEqual({
      kind: "deleteAgentPreset",
      requestId: "request-2",
      presetId: "mine",
    });
    controller.receiveMutation({
      kind: "settingsMutation",
      requestId: "request-2",
      result: {
        ok: false,
        error: { code: "preset-rejected", message: "remove failed" },
      },
    });
    expect(controller.snapshot().deletion).toEqual(expect.objectContaining({
      status: "error",
      defaultChanged: true,
      error: "remove failed",
    }));
    expect(controller.deletePreset()).toBe(true);
    expect(sent.at(-1)).toEqual({
      kind: "deleteAgentPreset",
      requestId: "request-3",
      presetId: "mine",
    });
    expect(sent.filter((command) => command.kind === "mutateSettings")).toHaveLength(1);
  });

  it("preserves fallback/default intent on conflict and retries after refresh", () => {
    const { controller, sent } = fixture();
    controller.beginDelete("mine");
    controller.setDeleteFallback("standard");
    controller.deletePreset();
    controller.receiveMutation({
      kind: "settingsMutation",
      requestId: "request-1",
      result: {
        ok: false,
        error: {
          code: "settings-conflict",
          message: "changed",
          currentRevision: 7,
        },
      },
    });
    expect(controller.snapshot().deletion).toEqual(expect.objectContaining({
      fallbackId: "standard",
      status: "conflict",
      retryable: false,
    }));
    controller.updateView({ ...view, namespace: { ...namespace, revision: 7 } });
    expect(controller.snapshot().deletion?.retryable).toBe(true);
    expect(controller.retryDelete()).toBe(true);
    expect(sent.at(-1)).toEqual(expect.objectContaining({ expectedRevision: 7 }));
  });

  it("posts only the preset id to the trusted host action for openable user presets", () => {
    const { controller, host } = fixture();
    expect(controller.open("standard")).toBe(false);
    expect(controller.open("mine")).toBe(true);
    expect(host).toEqual([{
      kind: "openAgentPreset",
      requestId: "request-1",
      presetId: "mine",
    }]);
    controller.receiveHost({
      kind: "settingsHostResult",
      requestId: "request-1",
      action: "openAgentPreset",
      result: { ok: true },
    } as SettingsHostResultMessage);
    expect(controller.snapshot().opening).toBe(false);
  });

  it("keeps copy, delete, and viewer mutually exclusive when idle", () => {
    const { controller } = fixture();
    controller.beginCopy("standard");
    expect(controller.snapshot().copy).toBeDefined();

    expect(controller.beginDelete("mine")).toBe(true);
    expect(controller.snapshot().copy).toBeUndefined();
    expect(controller.snapshot().deletion).toBeDefined();

    expect(controller.view("standard")).toBe(true);
    expect(controller.snapshot().deletion).toBeUndefined();
    expect(controller.snapshot().viewer?.presetId).toBe("standard");

    expect(controller.beginCopy("mine")).toBe(true);
    expect(controller.snapshot().viewer).toBeUndefined();
    expect(controller.snapshot().copy?.fromPresetId).toBe("mine");
  });

  it("does not discard dirty copy or delete conflict state to open another dialog", () => {
    const { controller } = fixture();
    controller.beginCopy("standard");
    controller.setCopyId("draft");
    expect(controller.beginDelete("mine")).toBe(false);
    expect(controller.view("standard")).toBe(false);
    expect(controller.snapshot().copy?.id).toBe("draft");

    controller.cancelCopy();
    controller.beginDelete("mine");
    controller.setDeleteFallback("standard");
    expect(controller.beginCopy("standard")).toBe(false);
    expect(controller.view("standard")).toBe(false);
    expect(controller.snapshot().deletion?.fallbackId).toBe("standard");
  });

  it("blocks incompatible preset mutations while one mutation owns settlement", () => {
    const { controller, sent } = fixture();
    controller.beginCopy("standard");
    controller.setCopyId("copy");
    controller.setCopyName("Copy");
    expect(controller.copy()).toBe(true);

    expect(controller.beginDelete("mine")).toBe(false);
    expect(controller.makeDefault("standard")).toBe(false);
    expect(controller.beginCopy("mine")).toBe(false);
    expect(sent).toHaveLength(1);

    // A viewer cannot replace the saving copy dialog.
    expect(controller.view("standard")).toBe(false);
    expect(controller.snapshot().copy?.status).toBe("saving");
  });

  it("allows viewing during a default mutation because it does not overwrite dialog state", () => {
    const { controller, sent } = fixture();
    expect(controller.makeDefault("standard")).toBe(true);
    expect(controller.view("standard")).toBe(true);
    expect(sent.map((command) => command.kind)).toEqual([
      "mutateSettings",
      "readAgentPreset",
    ]);
  });

  it("clears pending ownership on disconnect, preserves drafts, and ignores late results", () => {
    const { controller, sent } = fixture();
    controller.makeDefault("standard");
    controller.receiveMutation({
      kind: "settingsMutation",
      requestId: "request-1",
      result: {
        ok: false,
        error: {
          code: "settings-conflict",
          message: "changed",
          currentRevision: 8,
        },
      },
    });
    controller.beginCopy("standard");
    controller.setCopyId("copy");
    controller.setCopyName("Copy");
    controller.copy();
    const pendingId = sent.at(-1)!.requestId;
    controller.disconnect();
    expect(controller.snapshot()).toEqual(expect.objectContaining({
      connected: false,
      dirty: true,
    }));
    expect(controller.snapshot().copy).toEqual(expect.objectContaining({
      id: "copy",
      name: "Copy",
      status: "idle",
    }));
    expect(controller.snapshot().defaultChange?.desired).toBe("standard");

    controller.receiveMutation(success(pendingId));
    expect(controller.snapshot().copy).toBeDefined();
    expect(controller.snapshot().defaultChange?.desired).toBe("standard");
    controller.updateView({ ...view, namespace: { ...namespace, revision: 8 } });
    expect(controller.snapshot().connected).toBe(true);
  });

  it("rejects unrelated content and host response records", () => {
    const { controller } = fixture();
    expect(controller.receiveContent({
      kind: "agentPresetContent",
      requestId: "unknown",
      result: { ok: false, error: { code: "internal", message: "late" } },
    } as AgentPresetContentMessage)).toBe(false);
    expect(controller.receiveHost({
      kind: "settingsHostResult",
      requestId: "unknown",
      action: "openAgentPreset",
      result: { ok: true },
    } as SettingsHostResultMessage)).toBe(false);
  });
});

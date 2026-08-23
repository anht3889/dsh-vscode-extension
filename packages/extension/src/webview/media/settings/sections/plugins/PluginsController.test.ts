import { describe, expect, it, vi } from "vitest";
import type {
  PluginsSettingsView,
  SettingsMutationMessage,
} from "@dsh-vscode/contract";
import { PluginsController } from "./PluginsController.js";

function view(revision = 3): PluginsSettingsView {
  return {
    section: "plugins",
    namespaces: [{
      namespace: "shell",
      revision,
      applies: "live",
      writable: true,
      base: { timeoutMs: 10_000, maxOutputBytes: 1_000_000 },
      user: { timeoutMs: 20_000 },
      value: { timeoutMs: 20_000, maxOutputBytes: 1_000_000 },
      secrets: [],
    }, {
      namespace: "agent-loop",
      revision,
      applies: "restart",
      writable: true,
      base: { maxParallelToolCalls: 4 },
      user: {},
      value: { maxParallelToolCalls: 4 },
      secrets: [],
    }, {
      namespace: "web-search-deepseek",
      revision,
      applies: "live",
      writable: true,
      base: { baseURL: "", maxUses: 5 },
      user: { maxUses: 8 },
      value: { baseURL: "", maxUses: 8 },
      secrets: [],
    }],
    configurable: [{
      namespace: "shell",
      label: "Shell",
      fields: [{
        path: ["timeoutMs"],
        label: "Timeout (ms)",
        kind: "number",
      }, {
        path: ["maxOutputBytes"],
        label: "Maximum output bytes",
        kind: "number",
      }],
    }, {
      namespace: "agent-loop",
      label: "Agent Loop",
      fields: [{
        path: ["maxParallelToolCalls"],
        label: "Maximum parallel tool calls",
        kind: "number",
        min: 1,
        step: 1,
      }],
    }, {
      namespace: "web-search-deepseek",
      label: "Web Search",
      fields: [{
        path: ["baseURL"],
        label: "Base URL",
        kind: "string",
      }, {
        path: ["maxUses"],
        label: "Maximum uses",
        kind: "number",
        min: 1,
        step: 1,
      }],
      credential: {
        ref: "DEEPSEEK_API_KEY",
        set: true,
        source: "env",
        writable: false,
      },
      credentialStatus: { kind: "ready" },
    }],
    inventory: [{
      entryId: "shell",
      moduleName: "@deepseek-ai/dsh-shell",
      enabled: true,
      fiberPhase: "active",
    }],
  };
}

function bench() {
  const sent: unknown[] = [];
  let next = 0;
  const refresh = vi.fn();
  const controller = new PluginsController(
    (command) => sent.push(command),
    refresh,
    () => `plugins-${++next}`,
  );
  controller.updateView(view());
  return { controller, sent, refresh };
}

function success(
  requestId: string,
  namespace = view().namespaces[0],
  restartRequired?: boolean,
): SettingsMutationMessage {
  return {
    kind: "settingsMutation",
    requestId,
    result: {
      ok: true,
      namespace,
      ...(restartRequired === undefined ? {} : { restartRequired }),
    },
  };
}

describe("PluginsController", () => {
  it("keeps an independent persistent form for every available namespace", () => {
    const { controller } = bench();
    controller.edit("shell", "timeoutMs", "30000");
    controller.edit("agent-loop", "maxParallelToolCalls", "6");

    expect(controller.snapshot()).toMatchObject({
      dirty: true,
      cards: [
        { namespace: "shell", dirty: true },
        { namespace: "agent-loop", dirty: true },
        { namespace: "web-search-deepseek", dirty: false },
      ],
    });
    expect(controller.card("shell")?.fields.timeoutMs.text).toBe("30000");
  });

  it("validates only the specialized declared fields", () => {
    const { controller, sent } = bench();
    controller.edit("shell", "timeoutMs", "0");
    controller.edit("shell", "maxOutputBytes", "Infinity");
    controller.edit("agent-loop", "maxParallelToolCalls", "1.5");
    controller.edit("web-search-deepseek", "baseURL", "ftp://example.com");
    controller.edit("web-search-deepseek", "maxUses", "0");

    expect(controller.card("shell")?.fields).toMatchObject({
      timeoutMs: { invalid: true },
      maxOutputBytes: { invalid: true },
    });
    expect(controller.card("agent-loop")?.fields.maxParallelToolCalls.invalid)
      .toBe(true);
    expect(controller.card("web-search-deepseek")?.fields).toMatchObject({
      baseURL: { invalid: true },
      maxUses: { invalid: true },
    });
    expect(controller.save("shell")).toBe(false);
    expect(sent).toEqual([]);
  });

  it("saves and resets with the card revision while preserving other drafts", () => {
    const { controller, sent } = bench();
    controller.resetField("shell", "timeoutMs");
    controller.edit("agent-loop", "maxParallelToolCalls", "6");

    expect(controller.card("shell")?.fields.timeoutMs).toMatchObject({
      text: "10000",
      overridden: false,
    });
    expect(controller.save("shell")).toBe(true);
    expect(sent[0]).toMatchObject({
      kind: "mutateSettings",
      namespace: "shell",
      expectedRevision: 3,
      ops: [{ op: "unset", path: ["timeoutMs"] }],
    });
    controller.receive(success(
      "plugins-1",
      {
        ...view(4).namespaces[0]!,
        user: {},
        value: { timeoutMs: 10_000, maxOutputBytes: 1_000_000 },
      },
    ));

    expect(controller.card("shell")?.dirty).toBe(false);
    expect(controller.card("agent-loop")?.dirty).toBe(true);
  });

  it("discards one card without affecting another", () => {
    const { controller } = bench();
    controller.edit("shell", "timeoutMs", "30000");
    controller.edit("agent-loop", "maxParallelToolCalls", "6");
    controller.discard("shell");

    expect(controller.card("shell")?.fields.timeoutMs.text).toBe("20000");
    expect(controller.card("shell")?.dirty).toBe(false);
    expect(controller.card("agent-loop")?.dirty).toBe(true);
  });

  it("adopts external updates on clean cards and marks dirty cards stale", () => {
    const { controller } = bench();
    controller.edit("shell", "timeoutMs", "30000");
    const refreshed = view(5);
    refreshed.namespaces[0] = {
      ...refreshed.namespaces[0]!,
      user: { timeoutMs: 25_000 },
      value: { timeoutMs: 25_000, maxOutputBytes: 2_000_000 },
    };
    refreshed.namespaces[1] = {
      ...refreshed.namespaces[1]!,
      value: { maxParallelToolCalls: 7 },
    };
    controller.updateView(refreshed);

    expect(controller.card("shell")).toMatchObject({
      stale: true,
      expectedRevision: 5,
      fields: { timeoutMs: { text: "30000" } },
    });
    expect(controller.card("agent-loop")).toMatchObject({
      stale: false,
      fields: { maxParallelToolCalls: { text: "7" } },
    });
  });

  it("preserves conflict drafts and retries after the refreshed revision", () => {
    const { controller, sent } = bench();
    controller.edit("shell", "timeoutMs", "30000");
    controller.save("shell");
    controller.receive({
      kind: "settingsMutation",
      requestId: "plugins-1",
      result: {
        ok: false,
        error: {
          code: "settings-conflict",
          message: "Changed elsewhere",
          currentRevision: 5,
        },
      },
    });

    expect(controller.card("shell")).toMatchObject({
      status: "conflict",
      retryable: false,
      fields: { timeoutMs: { text: "30000" } },
    });
    controller.updateView(view(5));
    expect(controller.card("shell")?.retryable).toBe(true);
    controller.retry("shell");
    expect(sent[1]).toMatchObject({
      kind: "mutateSettings",
      expectedRevision: 5,
      ops: [{ op: "set", path: ["timeoutMs"], value: 30_000 }],
    });
    controller.receive({
      kind: "settingsMutation",
      requestId: "plugins-2",
      result: {
        ok: false,
        error: {
          code: "settings-conflict",
          message: "Changed again",
          currentRevision: 5,
        },
      },
    });
    controller.discard("shell");
    expect(controller.card("shell")?.fields.timeoutMs.text).toBe("20000");
  });

  it("exposes unavailable and read-only behavior without sending writes", () => {
    const controller = new PluginsController(vi.fn(), vi.fn());
    const next = view();
    next.namespaces = next.namespaces.filter((item) => item.namespace !== "shell");
    next.namespaces[0] = { ...next.namespaces[0]!, writable: false };
    controller.updateView(next);

    expect(controller.card("shell")).toMatchObject({ available: false });
    expect(controller.card("agent-loop")).toMatchObject({
      available: true,
      writable: false,
    });
    controller.edit("agent-loop", "maxParallelToolCalls", "6");
    expect(controller.save("agent-loop")).toBe(false);
  });

  it("allows a writable credential independently of read-only settings", () => {
    const sent: unknown[] = [];
    const controller = new PluginsController(
      (command) => sent.push(command),
      vi.fn(),
      () => "credential-only",
    );
    const next = view();
    next.namespaces[2] = { ...next.namespaces[2]!, writable: false };
    next.configurable[2] = {
      ...next.configurable[2]!,
      credential: {
        ...next.configurable[2]!.credential!,
        writable: true,
      },
    };
    controller.updateView(next);
    controller.armCredential("web-search-deepseek", "DEEPSEEK_API_KEY");

    expect(controller.save("web-search-deepseek")).toBe(true);
    expect(controller.snapshot().pendingCredential).toEqual({
      kind: "set",
      requestId: "credential-only",
      ref: "DEEPSEEK_API_KEY",
      namespace: "web-search-deepseek",
    });
    expect(sent).toEqual([]);
  });

  it("requires ready writable credential metadata and supports credential unset", () => {
    const { controller } = bench();
    const next = view();
    next.configurable[2] = {
      ...next.configurable[2]!,
      credential: {
        ...next.configurable[2]!.credential!,
        writable: true,
      },
    };
    controller.updateView(next);
    controller.stageCredential(
      "web-search-deepseek",
      "DEEPSEEK_API_KEY",
      "unset",
    );

    expect(controller.save("web-search-deepseek")).toBe(true);
    expect(controller.snapshot().pendingCredential).toEqual({
      kind: "unset",
      requestId: "plugins-1",
      ref: "DEEPSEEK_API_KEY",
      namespace: "web-search-deepseek",
    });

    controller.disconnect();
    const failed = view();
    failed.configurable[2] = {
      namespace: "web-search-deepseek",
      label: "Web Search",
      fields: failed.configurable[2]!.fields,
      credentialStatus: { kind: "failed", message: "Metadata unavailable" },
    };
    controller.updateView(failed);
    controller.stageCredential(
      "web-search-deepseek",
      "DEEPSEEK_API_KEY",
      "unset",
    );
    expect(controller.save("web-search-deepseek")).toBe(false);
  });

  it("rejects mixed read-only settings and credential until settings are discarded", () => {
    const { controller } = bench();
    controller.edit(
      "web-search-deepseek",
      "baseURL",
      "https://search.example/v1",
    );
    const readOnly = view(4);
    readOnly.namespaces[2] = { ...readOnly.namespaces[2]!, writable: false };
    readOnly.configurable[2] = {
      ...readOnly.configurable[2]!,
      credential: {
        ...readOnly.configurable[2]!.credential!,
        writable: true,
      },
    };
    controller.updateView(readOnly);
    controller.stageCredential(
      "web-search-deepseek",
      "DEEPSEEK_API_KEY",
      "unset",
    );

    expect(controller.card("web-search-deepseek")).toMatchObject({
      settingsDirty: true,
      credentialDirty: true,
      canSave: false,
    });
    expect(controller.save("web-search-deepseek")).toBe(false);
    controller.discardSettings("web-search-deepseek");
    expect(controller.card("web-search-deepseek")).toMatchObject({
      settingsDirty: false,
      credentialDirty: true,
      canSave: true,
    });
    expect(controller.save("web-search-deepseek")).toBe(true);
  });

  it("saves different cards concurrently and rejects a second own save", () => {
    const { controller, sent } = bench();
    controller.edit("shell", "timeoutMs", "30000");
    controller.edit("agent-loop", "maxParallelToolCalls", "6");

    expect(controller.save("shell")).toBe(true);
    expect(controller.save("shell")).toBe(false);
    expect(controller.save("agent-loop")).toBe(true);
    expect(controller.snapshot()).toMatchObject({
      busy: true,
      dirty: true,
    });
    expect(controller.card("shell")?.status).toBe("saving-settings");
    expect(controller.card("agent-loop")?.status).toBe("saving-settings");
    expect(sent).toHaveLength(2);

    controller.receive(success(
      "plugins-2",
      {
        ...view(4).namespaces[1]!,
        user: { maxParallelToolCalls: 6 },
        value: { maxParallelToolCalls: 6 },
      },
    ));
    expect(controller.card("agent-loop")?.dirty).toBe(false);
    expect(controller.card("shell")?.dirty).toBe(true);
    expect(controller.snapshot().busy).toBe(true);

    controller.receive(success(
      "plugins-1",
      {
        ...view(4).namespaces[0]!,
        user: { timeoutMs: 30_000 },
        value: { timeoutMs: 30_000, maxOutputBytes: 1_000_000 },
      },
    ));
    expect(controller.snapshot()).toMatchObject({ busy: false, dirty: false });
  });

  it("orders web-search settings before credential with distinct ids", () => {
    const { controller, sent } = bench();
    const writableCredential = view();
    writableCredential.configurable[2] = {
      ...writableCredential.configurable[2]!,
      credential: {
        ...writableCredential.configurable[2]!.credential!,
        writable: true,
      },
    };
    controller.updateView(writableCredential);
    controller.edit("web-search-deepseek", "baseURL", "https://search.example/v1");
    controller.armCredential("web-search-deepseek", "DEEPSEEK_API_KEY");
    expect(controller.save("web-search-deepseek")).toBe(true);
    expect(sent[0]).toMatchObject({
      kind: "mutateSettings",
      requestId: "plugins-1",
      namespace: "web-search-deepseek",
      expectedRevision: 3,
    });

    controller.receive(success(
      "plugins-1",
      {
        ...view(4).namespaces[2]!,
        user: { baseURL: "https://search.example/v1", maxUses: 8 },
        value: { baseURL: "https://search.example/v1", maxUses: 8 },
      },
    ));
    expect(controller.snapshot().pendingCredential).toEqual({
      kind: "set",
      requestId: "plugins-2",
      ref: "DEEPSEEK_API_KEY",
      namespace: "web-search-deepseek",
    });
    expect(sent).toHaveLength(1);
  });

  it("reports credential partial failure without rolling back committed settings", () => {
    const { controller } = bench();
    const writableCredential = view();
    writableCredential.configurable[2] = {
      ...writableCredential.configurable[2]!,
      credential: {
        ...writableCredential.configurable[2]!.credential!,
        writable: true,
      },
    };
    controller.updateView(writableCredential);
    controller.edit("web-search-deepseek", "baseURL", "https://search.example/v1");
    controller.armCredential("web-search-deepseek", "DEEPSEEK_API_KEY");
    controller.save("web-search-deepseek");
    controller.receive(success(
      "plugins-1",
      {
        ...view(4).namespaces[2]!,
        user: { baseURL: "https://search.example/v1", maxUses: 8 },
        value: { baseURL: "https://search.example/v1", maxUses: 8 },
      },
    ));
    controller.credentialPosted("plugins-2");
    controller.receive({
      kind: "settingsMutation",
      requestId: "plugins-2",
      result: {
        ok: false,
        error: {
          code: "credentials-rejected",
          message: "Credential write failed",
        },
      },
    });

    expect(controller.card("web-search-deepseek")).toMatchObject({
      status: "credential-failed",
      dirty: false,
      error: "Credential write failed",
    });
    expect(controller.card("web-search-deepseek")?.fields.baseURL.text)
      .toBe("https://search.example/v1");
  });

  it("does not settle a settings write from another namespace", () => {
    const { controller, sent } = bench();
    controller.edit("shell", "timeoutMs", "30000");
    controller.edit("agent-loop", "maxParallelToolCalls", "8");
    controller.save("shell");
    const requestId = (sent[0] as { requestId: string }).requestId;

    expect(controller.receive({
      kind: "settingsMutation",
      requestId,
      result: {
        ok: true,
        namespace: {
          ...view().namespaces[1]!,
          user: { maxParallelToolCalls: 8 },
          value: { maxParallelToolCalls: 8 },
        },
      },
    })).toBe(false);
    expect(controller.card("shell")).toMatchObject({
      status: "saving-settings",
      dirty: true,
      fields: { timeoutMs: { text: "30000" } },
    });
    expect(controller.card("agent-loop")).toMatchObject({
      dirty: true,
      fields: { maxParallelToolCalls: { text: "8" } },
    });

    controller.receive(success(
      requestId,
      {
        ...view(4).namespaces[0]!,
        user: { timeoutMs: 30_000 },
        value: { timeoutMs: 30_000, maxOutputBytes: 1_000_000 },
      },
    ));
    expect(controller.card("shell")).toMatchObject({
      status: "idle",
      dirty: false,
      fields: { timeoutMs: { text: "30000" } },
    });
    expect(controller.card("agent-loop")).toMatchObject({
      dirty: true,
      fields: { maxParallelToolCalls: { text: "8" } },
    });
  });

  it("settles disconnect ownership, preserves drafts, and ignores late results", () => {
    const { controller, sent } = bench();
    controller.edit("shell", "timeoutMs", "30000");
    controller.save("shell");
    controller.disconnect();

    expect(controller.snapshot()).toMatchObject({
      connected: false,
      secretEpoch: 1,
      dirty: true,
    });
    expect(controller.card("shell")).toMatchObject({
      namespace: "shell",
      status: "idle",
    });
    expect(controller.receive(success("plugins-1"))).toBe(false);
    controller.updateView(view(4));
    controller.save("shell");
    expect(sent[1]).toMatchObject({ expectedRevision: 4 });
  });

  it("settles overlapping card ownership and ignores every late result", () => {
    const { controller } = bench();
    controller.edit("shell", "timeoutMs", "30000");
    controller.edit("agent-loop", "maxParallelToolCalls", "6");
    controller.save("shell");
    controller.save("agent-loop");
    controller.disconnect();

    expect(controller.snapshot()).toMatchObject({
      connected: false,
      busy: false,
      dirty: true,
    });
    expect(controller.card("shell")?.status).toBe("idle");
    expect(controller.card("agent-loop")?.status).toBe("idle");
    expect(controller.receive(success("plugins-1"))).toBe(false);
    expect(controller.receive(success("plugins-2"))).toBe(false);
    expect(controller.card("shell")?.fields.timeoutMs.text).toBe("30000");
    expect(controller.card("agent-loop")?.fields.maxParallelToolCalls.text)
      .toBe("6");
  });

  it("restores a conflict when disconnect interrupts its retry", () => {
    const { controller } = bench();
    controller.edit("shell", "timeoutMs", "30000");
    controller.save("shell");
    controller.receive({
      kind: "settingsMutation",
      requestId: "plugins-1",
      result: {
        ok: false,
        error: {
          code: "settings-conflict",
          message: "Changed elsewhere",
          currentRevision: 5,
        },
      },
    });
    controller.updateView(view(5));
    controller.retry("shell");
    controller.disconnect();

    expect(controller.card("shell")).toMatchObject({
      status: "conflict",
      dirty: true,
      fields: { timeoutMs: { text: "30000" } },
    });
  });

  it("marks restart-applying cards and aggregates successful restart-required writes", () => {
    const { controller } = bench();
    controller.edit("agent-loop", "maxParallelToolCalls", "6");
    controller.save("agent-loop");
    controller.receive(success(
      "plugins-1",
      {
        ...view(4).namespaces[1]!,
        user: { maxParallelToolCalls: 6 },
        value: { maxParallelToolCalls: 6 },
      },
      true,
    ));

    expect(controller.card("agent-loop")?.applies).toBe("restart");
    expect(controller.snapshot().restartRequired).toBe(true);
  });
});

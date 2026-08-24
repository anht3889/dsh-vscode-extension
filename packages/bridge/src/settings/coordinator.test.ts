import { describe, expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import {
  SettingsConflictError,
  settingsNamespace,
  type SettingsDescriptor,
} from "@deepseek-ai/dsh-settings";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import {
  isSettingsOutboundMessage,
  type McpOperationWire,
  type OutboundMessage,
} from "@dsh-vscode/contract";
import { createSettingsCoordinator } from "./coordinator.js";
import {
  MCP_REQUIRED_MEMBERS,
  type McpManagementService,
  type McpServerRecordLike,
  type WebSearchCatalogLike,
  type WebSearchManagementService,
} from "./optional-services.js";

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

const descriptor = (
  namespace: string,
  revision = 1,
): SettingsDescriptor => ({
  ns: settingsNamespace(namespace),
  schema: {},
  revision,
  applies: "live",
  value: { preference: "en" },
  secrets: [],
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const mcpRecord = (id = "server-1"): McpServerRecordLike => ({
  id,
  serverName: id,
  enabled: true,
  transport: "stdio",
  command: "node",
  auth: { kind: "none" },
  toolCallTimeoutMs: 30_000,
  reconnect: {
    enabled: true,
    initialDelayMs: 100,
    maxDelayMs: 1_000,
    maxAttempts: 3,
  },
  createdAt: "created",
  updatedAt: "updated",
});

const mcpService = (
  overrides: Partial<McpManagementService> = {},
): McpManagementService => {
  const record = mcpRecord();
  return {
    list: () => [record],
    get: (id) => id === record.id ? record : undefined,
    upsert: async (candidate) => candidate,
    remove: async () => {},
    setEnabled: async () => {},
    connect: async () => {},
    disconnect: async () => {},
    getStatus: () => ({ state: "disconnected" }),
    getLogs: () => ({ next: 0, entries: [] }),
    getTools: () => [],
    setToolEnabled: async () => {},
    clearOAuth: async () => {},
    setSecrets: async () => {},
    ...overrides,
  };
};

describe("settings coordinator", () => {
  it("returns a correlated capability snapshot", async () => {
    const ctx = new Context();
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.getCapabilities("capabilities-1");

    expect(messages).toEqual([{
      kind: "settingsCapabilities",
      requestId: "capabilities-1",
      sections: [],
    }]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("pushes an unsolicited capability message when services change", async () => {
    const ctx = new Context();
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );
    const service = Object.fromEntries(
      MCP_REQUIRED_MEMBERS.map((member) => [member, () => {}]),
    );

    const disposeService = ctx.provide("mcp", service as never);

    expect(messages).toEqual([{
      kind: "settingsCapabilities",
      sections: ["mcp"],
    }]);
    await disposeService();
    expect(messages.at(-1)).toEqual({
      kind: "settingsCapabilities",
      sections: [],
    });
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it.each([
    ["mcp", "MCP"],
    ["web-search", "Web Search"],
  ] as const)(
    "returns section-specific unavailable for deferred %s reads",
    async (section, label) => {
      const ctx = new Context();
      ctx.provide("agentPresets", {
        list: async () => [{
          id: "standard",
          trust: "system",
          path: "/system/standard/cordis.yml",
        }],
      } as never);
      const messages: OutboundMessage[] = [];
      const coordinator = createSettingsCoordinator(
        ctx,
        (message) => messages.push(message),
      );

      coordinator.getSection(section, section);
      await flush();

      expect(messages).toEqual([{
        kind: "settingsSection",
        requestId: section,
        error: {
          code: "settings-unavailable",
          message: `${label} settings are not available`,
        },
      }]);
      expect(messages.every((message) => (
        message.kind !== "settingsSection" || message.view === undefined
      ))).toBe(true);
      coordinator.dispose();
      await ctx.fiber.dispose();
    },
  );

  it("sends only the latest section read", async () => {
    const ctx = new Context();
    const first = deferred<unknown[]>();
    let calls = 0;
    ctx.provide("settings", {
      writable: true,
      describe: vi.fn(() => [descriptor("locale")]),
    } as never);
    ctx.provide("agentPresets", {
      list: () => calls++ === 0
        ? first.promise
        : Promise.resolve([{ id: "new", name: "New" }]),
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.getSection("old", "general");
    coordinator.getSection("new", "general");
    await flush();
    first.resolve([{ id: "old", name: "Old" }]);
    await flush();

    expect(messages.filter((message) => message.kind === "settingsSection"))
      .toEqual([expect.objectContaining({ requestId: "new" })]);
    await ctx.fiber.dispose();
  });

  it("suppresses pending replies after dispose and unregisters invalidation effects", async () => {
    const ctx = new Context();
    const pending = deferred<unknown[]>();
    ctx.provide("settings", {
      writable: true,
      describe: () => [descriptor("locale")],
    } as never);
    ctx.provide("agentPresets", { list: () => pending.promise } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.getSection("pending", "general");
    coordinator.dispose();
    pending.resolve([]);
    ctx.emit("settings/document-updated", settingsNamespace("locale"), 2);
    await flush();

    expect(messages).toEqual([]);
    await ctx.fiber.dispose();
  });

  it("returns explicit unavailable results when section services are absent", async () => {
    const ctx = new Context();
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.getSection("plugins", "plugins");
    coordinator.getSection("presets", "agent-presets");
    await flush();

    expect(messages).toEqual([
      {
        kind: "settingsSection",
        requestId: "plugins",
        error: {
          code: "settings-unavailable",
          message: "Plugins settings are not available",
        },
      },
      {
        kind: "settingsSection",
        requestId: "presets",
        error: {
          code: "settings-unavailable",
          message: "Agent Presets settings are not available",
        },
      },
    ]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("returns a projected Models section through the coordinator", async () => {
    const ctx = new Context();
    ctx.provide("settings", {
      writable: true,
      describe: () => [],
    } as never);
    ctx.provide("llm", {
      listConfigurableProviders: () => [{
        provider: "anthropic",
        displayName: "Anthropic",
        settingsNs: "llm-pi-ai",
        settingsPath: ["providers", "anthropic"],
        declared: true,
      }],
      listProviders: () => [],
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.getSection("models", "models");
    await flush();

    expect(messages).toEqual([{
      kind: "settingsSection",
      requestId: "models",
      view: {
        section: "models",
        namespaces: [],
        providers: [{
          id: "anthropic",
          namespace: "llm-pi-ai",
          label: "Anthropic",
          active: false,
          declared: true,
          catalog: { kind: "dormant" },
          credentialStatus: { kind: "none" },
          models: [],
          removable: false,
          fields: [],
        }],
        credentials: [],
      },
    }]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("mutates with the exact revision and returns a refreshed redacted namespace", async () => {
    const ctx = new Context();
    let revision = 3;
    const mutate = vi.fn(async () => {
      revision = 4;
    });
    const describe = vi.fn(() => [descriptor("locale", revision)]);
    ctx.provide("settings", {
      writable: true,
      mutate,
      describe,
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.mutate({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "locale",
      expectedRevision: 3,
      ops: [{ op: "set", path: ["preference"], value: "zh" }],
    });
    await flush();

    expect(mutate).toHaveBeenCalledWith(
      settingsNamespace("locale"),
      [{ op: "set", path: ["preference"], value: "zh" }],
      3,
    );
    expect(describe).toHaveBeenCalledWith({ redactSecrets: true });
    expect(messages).toContainEqual({
      kind: "settingsMutation",
      requestId: "m1",
      result: {
        ok: true,
        namespace: expect.objectContaining({ namespace: "locale", revision: 4 }),
        restartRequired: false,
      },
    });
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("maps conflicts to the actual revision", async () => {
    const ctx = new Context();
    ctx.provide("settings", {
      writable: true,
      mutate: async () => {
        throw new SettingsConflictError(settingsNamespace("locale"), 2, 6);
      },
      describe: () => [descriptor("locale", 6)],
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.mutate({
      kind: "mutateSettings",
      requestId: "conflict",
      namespace: "locale",
      expectedRevision: 2,
      ops: [{ op: "set", path: ["preference"], value: "zh" }],
    });
    await flush();

    expect(messages).toContainEqual({
      kind: "settingsMutation",
      requestId: "conflict",
      result: {
        ok: false,
        error: expect.objectContaining({
          code: "settings-conflict",
          namespace: "locale",
          currentRevision: 6,
        }),
      },
    });
    expect(messages.map((message) => message.kind)).toEqual([
      "settingsMutation",
      "settingsInvalidated",
    ]);
    expect(messages[1]).toEqual({
      kind: "settingsInvalidated",
      sections: ["general"],
      reason: "document",
    });
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("defers conflict invalidation until other section mutations settle", async () => {
    const ctx = new Context();
    const permission = deferred<void>();
    ctx.provide("settings", {
      writable: true,
      mutate: async (namespace: string) => {
        if (String(namespace) === "locale") {
          throw new SettingsConflictError(settingsNamespace("locale"), 2, 6);
        }
        return permission.promise;
      },
      describe: () => [descriptor("locale", 6), descriptor("permission", 2)],
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.mutate({
      kind: "mutateSettings",
      requestId: "permission",
      namespace: "permission",
      expectedRevision: 1,
      ops: [{ op: "set", path: ["defaultPreset"], value: "read-only" }],
    });
    coordinator.mutate({
      kind: "mutateSettings",
      requestId: "conflict",
      namespace: "locale",
      expectedRevision: 2,
      ops: [{ op: "set", path: ["preference"], value: "zh" }],
    });
    await flush();

    expect(messages).toEqual([
      expect.objectContaining({
        kind: "settingsMutation",
        requestId: "conflict",
        result: expect.objectContaining({ ok: false }),
      }),
    ]);

    permission.resolve(undefined);
    await flush();
    expect(messages.map((message) => message.kind)).toEqual([
      "settingsMutation",
      "settingsMutation",
      "settingsInvalidated",
    ]);
    expect(messages[2]).toEqual({
      kind: "settingsInvalidated",
      sections: ["general"],
      reason: "document",
    });
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("maps document invalidation to the exact owning sections", async () => {
    const ctx = new Context();
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    ctx.emit("settings/document-updated", settingsNamespace("locale"), 1);
    ctx.emit("settings/document-updated", settingsNamespace("llm-deepseek"), 1);
    ctx.emit("settings/document-updated", settingsNamespace("agent-loop"), 1);
    ctx.emit("settings/document-updated", settingsNamespace("unrelated"), 1);

    expect(messages).toEqual([
      {
        kind: "settingsInvalidated",
        sections: ["general"],
        reason: "document",
      },
      {
        kind: "settingsInvalidated",
        sections: ["models"],
        reason: "document",
      },
      {
        kind: "settingsInvalidated",
        sections: ["plugins"],
        reason: "document",
      },
    ]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("sends a mutation result before its deferred document invalidation", async () => {
    const ctx = new Context();
    const pending = deferred<void>();
    ctx.provide("settings", {
      writable: true,
      mutate: () => pending.promise,
      describe: () => [descriptor("locale", 2)],
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.mutate({
      kind: "mutateSettings",
      requestId: "locale",
      namespace: "locale",
      expectedRevision: 1,
      ops: [{ op: "set", path: ["preference"], value: "zh" }],
    });
    ctx.emit("settings/document-updated", settingsNamespace("locale"), 2);
    pending.resolve(undefined);
    await flush();

    expect(messages.map((message) => message.kind)).toEqual([
      "settingsMutation",
      "settingsInvalidated",
    ]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("waits for section quiescence across different General namespaces", async () => {
    const ctx = new Context();
    const locale = deferred<void>();
    const permission = deferred<void>();
    const pending = new Map([
      ["locale", locale.promise],
      ["permission", permission.promise],
    ]);
    ctx.provide("settings", {
      writable: true,
      mutate: (namespace: string) => pending.get(String(namespace)),
      describe: () => [
        descriptor("locale", 2),
        descriptor("permission", 2),
      ],
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.mutate({
      kind: "mutateSettings",
      requestId: "locale",
      namespace: "locale",
      expectedRevision: 1,
      ops: [{ op: "set", path: ["preference"], value: "zh" }],
    });
    coordinator.mutate({
      kind: "mutateSettings",
      requestId: "permission",
      namespace: "permission",
      expectedRevision: 1,
      ops: [{ op: "set", path: ["defaultPreset"], value: "read-only" }],
    });
    ctx.emit("settings/document-updated", settingsNamespace("locale"), 2);
    ctx.emit("settings/document-updated", settingsNamespace("permission"), 2);

    locale.resolve(undefined);
    await flush();
    expect(messages.map((message) => message.kind)).toEqual([
      "settingsMutation",
    ]);

    permission.resolve(undefined);
    await flush();
    expect(messages.map((message) => message.kind)).toEqual([
      "settingsMutation",
      "settingsMutation",
      "settingsInvalidated",
    ]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("settles overlapping cross-section writes and invalidations independently", async () => {
    const ctx = new Context();
    const models = deferred<void>();
    const plugins = deferred<void>();
    ctx.provide("settings", {
      writable: true,
      mutate: (namespace: string) =>
        String(namespace) === "llm-pi-ai" ? models.promise : plugins.promise,
      describe: () => [
        descriptor("llm-pi-ai", 2),
        descriptor("agent-loop", 4),
      ],
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.mutate({
      kind: "mutateSettings",
      requestId: "models-write",
      namespace: "llm-pi-ai",
      expectedRevision: 1,
      ops: [{ op: "set", path: ["providers", "openai"], value: {} }],
    });
    coordinator.mutate({
      kind: "mutateSettings",
      requestId: "plugins-write",
      namespace: "agent-loop",
      expectedRevision: 3,
      ops: [{ op: "set", path: ["maxParallelToolCalls"], value: 8 }],
    });
    ctx.emit("settings/document-updated", settingsNamespace("llm-pi-ai"), 2);
    ctx.emit("settings/document-updated", settingsNamespace("agent-loop"), 4);

    plugins.resolve(undefined);
    await flush();
    expect(messages).toEqual([
      expect.objectContaining({
        kind: "settingsMutation",
        requestId: "plugins-write",
      }),
      {
        kind: "settingsInvalidated",
        sections: ["plugins"],
        reason: "document",
      },
    ]);

    models.resolve(undefined);
    await flush();
    expect(messages.slice(2)).toEqual([
      expect.objectContaining({
        kind: "settingsMutation",
        requestId: "models-write",
      }),
      {
        kind: "settingsInvalidated",
        sections: ["models"],
        reason: "models",
      },
    ]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("refreshes Models after a live provider write reaches section quiescence", async () => {
    const ctx = new Context();
    const pending = deferred<void>();
    ctx.provide("settings", {
      writable: true,
      mutate: () => pending.promise,
      describe: () => [descriptor("llm-pi-ai", 2)],
    } as never);
    const order: string[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => order.push(message.kind),
      () => order.push("catalogRefresh"),
    );

    coordinator.mutate({
      kind: "mutateSettings",
      requestId: "models",
      namespace: "llm-pi-ai",
      expectedRevision: 1,
      ops: [{
        op: "set",
        path: ["providers", "openai", "baseURL"],
        value: "https://gateway.example/v1",
      }],
    });
    ctx.emit("settings/document-updated", settingsNamespace("llm-pi-ai"), 2);
    pending.resolve(undefined);
    await flush();

    expect(order).toEqual([
      "settingsMutation",
      "settingsInvalidated",
      "catalogRefresh",
    ]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("defers adapter invalidation until a failing Models mutation settles", async () => {
    const ctx = new Context();
    const pending = deferred<void>();
    ctx.provide("settings", {
      writable: true,
      mutate: () => pending.promise,
      describe: () => [descriptor("llm-pi-ai", 1)],
    } as never);
    const messages: OutboundMessage[] = [];
    const order: string[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => {
        messages.push(message);
        order.push(message.kind);
      },
      () => order.push("catalogRefresh"),
    );

    coordinator.mutate({
      kind: "mutateSettings",
      requestId: "models-failed",
      namespace: "llm-pi-ai",
      expectedRevision: 1,
      ops: [{
        op: "set",
        path: ["providers", "openai", "baseURL"],
        value: "https://gateway.example/v1",
      }],
    });
    ctx.emit("llm/adapters-updated");
    await flush();
    expect(messages).toEqual([]);

    pending.reject(new Error("write failed"));
    await flush();

    expect(order).toEqual([
      "settingsMutation",
      "settingsInvalidated",
      "catalogRefresh",
    ]);
    expect(messages[1]).toEqual({
      kind: "settingsInvalidated",
      sections: ["models"],
      reason: "models",
    });
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("sends only the latest mutation for one namespace", async () => {
    const ctx = new Context();
    const first = deferred<void>();
    const second = deferred<void>();
    let calls = 0;
    ctx.provide("settings", {
      writable: true,
      mutate: () => calls++ === 0 ? first.promise : second.promise,
      describe: () => [descriptor("locale", 2)],
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));
    const mutate = (requestId: string) => coordinator.mutate({
      kind: "mutateSettings",
      requestId,
      namespace: "locale",
      expectedRevision: 1,
      ops: [{ op: "set", path: ["preference"], value: "zh" }],
    });

    mutate("old");
    mutate("new");
    second.resolve(undefined);
    await flush();
    first.resolve(undefined);
    await flush();

    expect(messages.filter((message) => message.kind === "settingsMutation"))
      .toEqual([expect.objectContaining({ requestId: "new" })]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("suppresses an in-flight mutation result after dispose", async () => {
    const ctx = new Context();
    const pending = deferred<void>();
    ctx.provide("settings", {
      writable: true,
      mutate: () => pending.promise,
      describe: () => [descriptor("locale", 2)],
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.mutate({
      kind: "mutateSettings",
      requestId: "disposed",
      namespace: "locale",
      expectedRevision: 1,
      ops: [{ op: "set", path: ["preference"], value: "zh" }],
    });
    coordinator.dispose();
    pending.resolve(undefined);
    await flush();

    expect(messages).toEqual([]);
    await ctx.fiber.dispose();
  });

  it("names the requested section and namespace when settings are unavailable", async () => {
    const ctx = new Context();
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.mutate({
      kind: "mutateSettings",
      requestId: "plugin",
      namespace: "agent-loop",
      expectedRevision: 1,
      ops: [{ op: "set", path: ["maxParallelToolCalls"], value: 2 }],
    });
    await flush();

    expect(messages).toEqual([{
      kind: "settingsMutation",
      requestId: "plugin",
      result: {
        ok: false,
        error: {
          code: "settings-unavailable",
          message: "Plugins settings are not available",
          namespace: "agent-loop",
        },
      },
    }]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("correlates independent preset and document path targets", async () => {
    const ctx = new Context();
    const firstPreset = deferred<{ id: string; trust: "user"; path: string }>();
    const secondPreset = deferred<{ id: string; trust: "user"; path: string }>();
    const prepared = deferred<string>();
    ctx.provide("agentPresets", {
      resolve: (id: string) => id === "first"
        ? firstPreset.promise
        : secondPreset.promise,
    } as never);
    ctx.provide("settings", {
      documentPath: "/tmp/settings.yaml",
      prepareDocument: () => prepared.promise,
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.resolvePath({
      kind: "resolveSettingsPath",
      requestId: "first",
      target: { kind: "agent-preset", presetId: "first" },
    });
    coordinator.resolvePath({
      kind: "resolveSettingsPath",
      requestId: "second",
      target: { kind: "agent-preset", presetId: "second" },
    });
    coordinator.resolvePath({
      kind: "resolveSettingsPath",
      requestId: "prepared",
      target: { kind: "settings-document", prepare: true },
    });
    coordinator.resolvePath({
      kind: "resolveSettingsPath",
      requestId: "existing",
      target: { kind: "settings-document", prepare: false },
    });
    firstPreset.resolve({ id: "first", trust: "user", path: "/tmp/first.yml" });
    secondPreset.resolve({ id: "second", trust: "user", path: "/tmp/second.yml" });
    prepared.resolve("/tmp/settings.yaml");
    await flush();

    expect(messages.filter((message) => message.kind === "settingsPath")
      .map((message) => message.requestId)).toEqual([
      "existing",
      "first",
      "second",
      "prepared",
    ]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("correlates concurrent same-target path requests by request id", async () => {
    const ctx = new Context();
    const first = deferred<{ id: string; trust: "user"; path: string }>();
    const second = deferred<{ id: string; trust: "user"; path: string }>();
    const pending = [first, second];
    ctx.provide("agentPresets", {
      resolve: () => pending.shift()!.promise,
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.resolvePath({
      kind: "resolveSettingsPath",
      requestId: "first-home",
      target: { kind: "agent-preset", presetId: "mine" },
    });
    coordinator.resolvePath({
      kind: "resolveSettingsPath",
      requestId: "second-home",
      target: { kind: "agent-preset", presetId: "mine" },
    });
    second.resolve({ id: "mine", trust: "user", path: "/tmp/second.yml" });
    first.resolve({ id: "mine", trust: "user", path: "/tmp/first.yml" });
    await flush();

    expect(messages.filter((message) => message.kind === "settingsPath")).toEqual([
      {
        kind: "settingsPath",
        requestId: "second-home",
        result: { ok: true, target: "agent-preset", path: "/tmp/second.yml" },
      },
      {
        kind: "settingsPath",
        requestId: "first-home",
        result: { ok: true, target: "agent-preset", path: "/tmp/first.yml" },
      },
    ]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("returns explicit unavailable results for remaining Task 5 operations", async () => {
    const ctx = new Context();
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.readPreset({
      kind: "readAgentPreset",
      requestId: "preset",
      presetId: "standard",
    });
    await flush();

    expect(messages).toEqual([
      expect.objectContaining({
        kind: "agentPresetContent",
        requestId: "preset",
        result: { ok: false, error: expect.objectContaining({ code: "settings-unavailable" }) },
      }),
    ]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("returns projected Plugins and Agent Presets sections", async () => {
    const ctx = new Context();
    const pluginSchema = {
      uid: 1,
      refs: {
        "1": {
          type: "object",
          meta: {},
          dict: {
            maxParallelToolCalls: 2,
            apiKeyEnv: 3,
            baseURL: 4,
            maxUses: 5,
          },
        },
        "2": { type: "number", meta: { min: 1, step: 1 } },
        "3": { type: "string", meta: { role: "credential-ref" } },
        "4": { type: "string", meta: {} },
        "5": { type: "number", meta: { min: 1, step: 1 } },
      },
    };
    ctx.provide("settings", {
      writable: true,
      describe: () => [
        {
          ...descriptor("agent-loop"),
          schema: pluginSchema,
          value: { maxParallelToolCalls: 4 },
        },
        {
          ...descriptor("web-search-deepseek"),
          schema: pluginSchema,
          value: {
            apiKeyEnv: "DEEPSEEK_API_KEY",
            baseURL: "https://search.example/v1",
            maxUses: 5,
          },
        },
        {
          ...descriptor("agent-presets"),
          base: { default: "standard" },
          value: { default: "standard" },
        },
      ],
    } as never);
    ctx.provide("pluginInventory", {
      list: () => ({
        entries: [{
          entryId: "agent-loop",
          moduleName: "@deepseek-ai/dsh-agent-loop",
          enabled: true,
          fiberPhase: "active",
        }],
      }),
    } as never);
    ctx.provide("credentials", {
      describe: async () => ({
        configured: true,
        source: "env",
        writable: false,
      }),
    } as never);
    ctx.provide("agentPresets", {
      list: async () => [{
        id: "standard",
        trust: "system",
        path: "/system/standard/cordis.yml",
      }],
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.getSection("plugins", "plugins");
    coordinator.getSection("presets", "agent-presets");
    await flush();

    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "settingsSection",
        requestId: "plugins",
        view: expect.objectContaining({
          section: "plugins",
          inventory: [expect.objectContaining({ entryId: "agent-loop" })],
          configurable: [
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
            {
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
            },
          ],
        }),
      }),
      expect.objectContaining({
        kind: "settingsSection",
        requestId: "presets",
        view: expect.objectContaining({
          section: "agent-presets",
          presets: [expect.objectContaining({ id: "standard" })],
        }),
      }),
    ]));
    expect(messages).toHaveLength(2);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("copies presets and invalidates roster consumers after the response", async () => {
    const ctx = new Context();
    const copy = vi.fn(async () => {});
    ctx.provide("agentPresets", {
      list: async () => [{
        id: "standard",
        trust: "system",
        path: "/system/standard/cordis.yml",
      }],
      copy,
    } as never);
    const order: string[] = [];
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => {
      messages.push(message);
      order.push(message.kind);
    });

    coordinator.copyPreset({
      kind: "copyAgentPreset",
      requestId: "copy",
      fromPresetId: "standard",
      presetId: "my-copy",
      name: "My Copy",
    });
    await flush();

    expect(copy).toHaveBeenCalledWith("standard", "my-copy", "My Copy");
    expect(order).toEqual([
      "settingsMutation",
      "settingsInvalidated",
      "settingsInvalidated",
    ]);
    expect(messages.slice(1)).toEqual([
      {
        kind: "settingsInvalidated",
        sections: ["general"],
        reason: "presets",
      },
      {
        kind: "settingsInvalidated",
        sections: ["agent-presets"],
        reason: "presets",
      },
    ]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("keeps preset delete quiescent with the default document mutation", async () => {
    const ctx = new Context();
    const pending = deferred<void>();
    const presetDescriptor = {
      ...descriptor("agent-presets"),
      base: { default: "standard" },
      user: { default: "mine" },
      value: { default: "mine" },
    };
    ctx.provide("settings", {
      writable: true,
      describe: () => [presetDescriptor],
    } as never);
    ctx.provide("agentPresets", {
      defaultId: "mine",
      list: async () => [
        { id: "standard", trust: "system", path: "/system/standard/cordis.yml" },
        { id: "mine", trust: "user", path: "/user/mine/cordis.yml" },
      ],
      remove: async () => {
        ctx.emit("settings/document-updated", settingsNamespace("agent-presets"), 4);
        await pending.promise;
      },
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.deletePreset({
      kind: "deleteAgentPreset",
      requestId: "delete",
      presetId: "mine",
    });
    await flush();
    expect(messages).toEqual([]);

    pending.resolve(undefined);
    await flush();

    expect(messages.map((message) => message.kind)).toEqual([
      "settingsMutation",
      "settingsInvalidated",
      "settingsInvalidated",
    ]);
    expect(messages[0]).toEqual({
      kind: "settingsMutation",
      requestId: "delete",
      result: { ok: true },
    });
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("correlates latest preset reads and suppresses reads after dispose", async () => {
    const ctx = new Context();
    const first = deferred<string>();
    const disposed = deferred<string>();
    let calls = 0;
    ctx.provide("agentPresets", {
      resolve: async (id: string) => ({
        id,
        trust: "system",
        path: `/system/${id}/cordis.yml`,
      }),
      read: () => {
        const call = calls++;
        return call === 0
          ? first.promise
          : call === 1
            ? Promise.resolve("latest")
            : disposed.promise;
      },
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.readPreset({
      kind: "readAgentPreset",
      requestId: "old",
      presetId: "standard",
    });
    coordinator.readPreset({
      kind: "readAgentPreset",
      requestId: "new",
      presetId: "standard",
    });
    await flush();
    first.resolve("old");
    await flush();

    expect(messages).toEqual([{
      kind: "agentPresetContent",
      requestId: "new",
      result: {
        ok: true,
        presetId: "standard",
        trust: "system",
        content: "latest",
      },
    }]);

    coordinator.readPreset({
      kind: "readAgentPreset",
      requestId: "disposed",
      presetId: "other",
    });
    coordinator.dispose();
    disposed.resolve("disposed");
    await flush();
    expect(messages).toHaveLength(1);
    await ctx.fiber.dispose();
  });

  it("refreshes the external preset roster on every section open", async () => {
    const ctx = new Context();
    let calls = 0;
    ctx.provide("agentPresets", {
      list: async () => [{
        id: calls++ === 0 ? "first" : "second",
        trust: "system",
        path: "/system/preset/cordis.yml",
      }],
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.getSection("first", "agent-presets");
    await flush();
    coordinator.getSection("second", "agent-presets");
    await flush();

    expect(messages.map((message) => {
      if (message.kind !== "settingsSection" || message.view === undefined) {
        return undefined;
      }
      return message.view.section === "agent-presets"
        ? message.view.presets[0]?.id
        : undefined;
    })).toEqual(["first", "second"]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("invalidates Presets after a default mutation response", async () => {
    const ctx = new Context();
    let revision = 1;
    const current = () => ({
      ...descriptor("agent-presets", revision),
      base: { default: "standard" },
      user: { default: "mine" },
      value: { default: "mine" },
    });
    ctx.provide("settings", {
      writable: true,
      describe: () => [current()],
      mutate: async () => {
        revision = 2;
        ctx.emit("settings/document-updated", settingsNamespace("agent-presets"), 2);
      },
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.mutate({
      kind: "mutateSettings",
      requestId: "default",
      namespace: "agent-presets",
      expectedRevision: 1,
      ops: [{ op: "set", path: ["default"], value: "mine" }],
    });
    await flush();

    expect(messages.map((message) => message.kind)).toEqual([
      "settingsMutation",
      "settingsInvalidated",
      "settingsInvalidated",
    ]);
    expect(messages.slice(1)).toEqual([
      {
        kind: "settingsInvalidated",
        sections: ["general"],
        reason: "document",
      },
      {
        kind: "settingsInvalidated",
        sections: ["agent-presets"],
        reason: "presets",
      },
    ]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("keeps preset copy/delete latest and disposal safe with closed results", async () => {
    const ctx = new Context();
    const firstCopy = deferred<void>();
    const pendingDelete = deferred<void>();
    let copies = 0;
    ctx.provide("settings", {
      writable: true,
      describe: () => [{
        ...descriptor("agent-presets"),
        base: { default: "standard" },
        value: { default: "standard" },
      }],
    } as never);
    ctx.provide("agentPresets", {
      defaultId: "standard",
      list: async () => [
        { id: "standard", trust: "system", path: "/system/standard/cordis.yml" },
        { id: "mine", trust: "user", path: "/user/mine/cordis.yml" },
      ],
      copy: async () => {
        if (copies++ === 0) await firstCopy.promise;
      },
      remove: () => pendingDelete.promise,
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    const copy = (requestId: string, name: string) => coordinator.copyPreset({
      kind: "copyAgentPreset",
      requestId,
      fromPresetId: "standard",
      presetId: "my-copy",
      name,
    });
    copy("old", "Old Copy");
    copy("new", "New Copy");
    await flush();
    expect(messages).toEqual([{
      kind: "settingsMutation",
      requestId: "new",
      result: { ok: true },
    }]);

    firstCopy.resolve(undefined);
    await flush();
    expect(messages.filter((message) => message.kind === "settingsMutation"))
      .toEqual([expect.objectContaining({ requestId: "new" })]);
    expect(messages.every(isSettingsOutboundMessage)).toBe(true);

    coordinator.deletePreset({
      kind: "deleteAgentPreset",
      requestId: "disposed",
      presetId: "mine",
    });
    coordinator.dispose();
    pendingDelete.resolve(undefined);
    await flush();

    expect(messages.filter((message) => (
      message.kind === "settingsMutation" && message.requestId === "disposed"
    ))).toEqual([]);
    await ctx.fiber.dispose();
  });

  it("sets and unsets credentials before invalidation and catalog refresh", async () => {
    const ctx = new Context();
    const set = vi.fn(async (ref: string, value: string) => {
      ctx.emit("credentials/updated", credentialRef(ref));
      expect(value).toBe("fixture-secret");
    });
    const unset = vi.fn(async (ref: string) => {
      ctx.emit("credentials/updated", credentialRef(ref));
    });
    ctx.provide("credentials", { set, unset } as never);
    const order: string[] = [];
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => {
        order.push(message.kind);
        messages.push(message);
      },
      () => {
        order.push("catalogRefresh");
      },
    );

    coordinator.setCredential({
      kind: "setCredential",
      requestId: "set",
      ref: "DEEPSEEK_API_KEY",
      value: "fixture-secret",
    });
    await flush();
    coordinator.unsetCredential({
      kind: "unsetCredential",
      requestId: "unset",
      ref: "DEEPSEEK_API_KEY",
    });
    await flush();

    expect(set).toHaveBeenCalledWith(
      credentialRef("DEEPSEEK_API_KEY"),
      "fixture-secret",
    );
    expect(unset).toHaveBeenCalledWith(credentialRef("DEEPSEEK_API_KEY"));
    expect(order).toEqual([
      "settingsMutation",
      "settingsInvalidated",
      "catalogRefresh",
      "settingsInvalidated",
      "settingsMutation",
      "settingsInvalidated",
      "catalogRefresh",
      "settingsInvalidated",
    ]);
    expect(messages).toContainEqual({
      kind: "settingsInvalidated",
      sections: ["models"],
      reason: "credentials",
    });
    expect(messages).toContainEqual({
      kind: "settingsInvalidated",
      sections: ["plugins"],
      reason: "credentials",
    });
    expect(JSON.stringify(messages)).not.toContain("fixture-secret");
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("rejects invalid refs, empty values, and provider write refusals", async () => {
    const ctx = new Context();
    const set = vi.fn(async () => {
      throw new Error("read-only environment shadows this credential");
    });
    ctx.provide("credentials", { set, unset: vi.fn() } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.setCredential({
      kind: "setCredential",
      requestId: "invalid-ref",
      ref: "bad-ref",
      value: "fixture-secret",
    });
    coordinator.setCredential({
      kind: "setCredential",
      requestId: "empty",
      ref: "EMPTY_API_KEY",
      value: "",
    });
    coordinator.setCredential({
      kind: "setCredential",
      requestId: "read-only",
      ref: "READ_ONLY_API_KEY",
      value: "fixture-secret",
    });
    await flush();

    expect(messages).toEqual([
      {
        kind: "settingsMutation",
        requestId: "invalid-ref",
        result: {
          ok: false,
          error: expect.objectContaining({ code: "credentials-rejected" }),
        },
      },
      {
        kind: "settingsMutation",
        requestId: "empty",
        result: {
          ok: false,
          error: expect.objectContaining({ code: "credentials-rejected" }),
        },
      },
      {
        kind: "settingsMutation",
        requestId: "read-only",
        result: {
          ok: false,
          error: {
            code: "credentials-rejected",
            message: "read-only environment shadows this credential",
          },
        },
      },
    ]);
    expect(set).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(messages)).not.toContain("fixture-secret");
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("returns settings-unavailable when credential storage is absent", async () => {
    const ctx = new Context();
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.unsetCredential({
      kind: "unsetCredential",
      requestId: "missing",
      ref: "DEEPSEEK_API_KEY",
    });
    await flush();

    expect(messages).toEqual([{
      kind: "settingsMutation",
      requestId: "missing",
      result: {
        ok: false,
        error: {
          code: "settings-unavailable",
          message: "Credential storage settings are not available",
        },
      },
    }]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("defers credential invalidation until a failing credential mutation settles", async () => {
    const ctx = new Context();
    const pending = deferred<void>();
    ctx.provide("credentials", {
      set: () => pending.promise,
    } as never);
    const messages: OutboundMessage[] = [];
    const order: string[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => {
        messages.push(message);
        order.push(message.kind);
      },
      () => order.push("catalogRefresh"),
    );

    coordinator.setCredential({
      kind: "setCredential",
      requestId: "credential-failed",
      ref: "DEEPSEEK_API_KEY",
      value: "fixture-secret",
    });
    ctx.emit("credentials/updated", credentialRef("DEEPSEEK_API_KEY"));
    await flush();
    expect(messages).toEqual([]);

    pending.reject(new Error("write failed"));
    await flush();

    expect(order).toEqual([
      "settingsMutation",
      "settingsInvalidated",
      "catalogRefresh",
      "settingsInvalidated",
    ]);
    expect(messages[1]).toEqual({
      kind: "settingsInvalidated",
      sections: ["models"],
      reason: "credentials",
    });
    expect(JSON.stringify(messages)).not.toContain("fixture-secret");
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("correlates the latest credential request and suppresses settlement after dispose", async () => {
    const ctx = new Context();
    const first = deferred<void>();
    const disposed = deferred<void>();
    let calls = 0;
    ctx.provide("credentials", {
      set: () => calls++ === 0 ? first.promise : Promise.resolve(),
      unset: () => disposed.promise,
    } as never);
    const messages: OutboundMessage[] = [];
    const refresh = vi.fn();
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
      refresh,
    );

    coordinator.setCredential({
      kind: "setCredential",
      requestId: "old",
      ref: "DEEPSEEK_API_KEY",
      value: "old-secret",
    });
    coordinator.setCredential({
      kind: "setCredential",
      requestId: "new",
      ref: "DEEPSEEK_API_KEY",
      value: "new-secret",
    });
    await flush();
    first.resolve(undefined);
    await flush();

    expect(messages.filter((message) => message.kind === "settingsMutation"))
      .toEqual([expect.objectContaining({ requestId: "new" })]);
    messages.length = 0;
    refresh.mockClear();

    coordinator.unsetCredential({
      kind: "unsetCredential",
      requestId: "disposed",
      ref: "OTHER_API_KEY",
    });
    coordinator.dispose();
    disposed.resolve(undefined);
    await flush();

    expect(messages).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
    await ctx.fiber.dispose();
  });

  it("invalidates Models and refreshes the catalog for topology and external credential changes", async () => {
    const ctx = new Context();
    const messages: OutboundMessage[] = [];
    const refresh = vi.fn();
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
      refresh,
    );

    ctx.emit("llm/adapters-updated");
    ctx.emit("credentials/updated", credentialRef("DEEPSEEK_API_KEY"));

    expect(messages).toEqual([
      {
        kind: "settingsInvalidated",
        sections: ["models"],
        reason: "models",
      },
      {
        kind: "settingsInvalidated",
        sections: ["models"],
        reason: "credentials",
      },
      {
        kind: "settingsInvalidated",
        sections: ["plugins"],
        reason: "credentials",
      },
    ]);
    expect(refresh).toHaveBeenCalledTimes(2);
    coordinator.dispose();
    ctx.emit("llm/adapters-updated");
    expect(refresh).toHaveBeenCalledTimes(2);
    await ctx.fiber.dispose();
  });

  it("aborts settings-owned catalog refresh work on dispose", async () => {
    const ctx = new Context();
    let refreshSignal: AbortSignal | undefined;
    const coordinator = createSettingsCoordinator(
      ctx,
      () => {},
      (signal) => {
        refreshSignal = signal;
      },
    );

    ctx.emit("llm/adapters-updated");
    expect(refreshSignal?.aborted).toBe(false);

    coordinator.dispose();

    expect(refreshSignal?.aborted).toBe(true);
    await ctx.fiber.dispose();
  });

  it("returns Web Search views only while its service is ready", async () => {
    const ctx = new Context();
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.getSection("missing", "web-search");
    await flush();
    expect(messages.at(-1)).toEqual({
      kind: "settingsSection",
      requestId: "missing",
      error: {
        code: "settings-unavailable",
        message: "Web Search settings are not available",
      },
    });

    ctx.provide("webSearchManager", {
      getCatalog: () => ({ engine: "tavily", engines: {} }),
      putCatalog: async (catalog: WebSearchCatalogLike) => catalog,
      describeSecrets: async () => ({
        TAVILY_API_KEY: { configured: true },
        BRAVE_API_KEY: { configured: false },
      }),
      putSecrets: async () => {},
      available: () => true,
    } as never);
    coordinator.getSection("ready", "web-search");
    await flush();

    expect(messages.at(-1)).toEqual(expect.objectContaining({
      kind: "settingsSection",
      requestId: "ready",
      view: expect.objectContaining({
        section: "web-search",
        engine: "tavily",
        available: true,
      }),
    }));
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("routes the MCP section, detail, and incremental logs", async () => {
    const ctx = new Context();
    const getLogs = vi.fn(() => ({
      next: 5,
      entries: [{ at: "now", level: "info" as const, message: "ready" }],
    }));
    ctx.provide("mcp", mcpService({ getLogs }) as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.getSection("list", "mcp");
    coordinator.getMcpServer({
      kind: "getMcpServer",
      requestId: "detail",
      serverId: "server-1",
    });
    coordinator.getMcpLogs({
      kind: "getMcpLogs",
      requestId: "logs",
      serverId: "server-1",
      after: 3,
    });
    await flush();

    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "settingsSection",
        requestId: "list",
        view: expect.objectContaining({ section: "mcp" }),
      }),
      expect.objectContaining({
        kind: "mcpServer",
        requestId: "detail",
        result: expect.objectContaining({ ok: true }),
      }),
      {
        kind: "mcpLogs",
        requestId: "logs",
        result: {
          ok: true,
          serverId: "server-1",
          next: 5,
          entries: [{ at: "now", level: "info", message: "ready" }],
        },
      },
    ]));
    expect(getLogs).toHaveBeenCalledWith("server-1", 3);
    expect(messages.every(isSettingsOutboundMessage)).toBe(true);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("returns settings-unavailable for every MCP read without a service", async () => {
    const ctx = new Context();
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.getSection("list", "mcp");
    coordinator.getMcpServer({
      kind: "getMcpServer",
      requestId: "detail",
      serverId: "server-1",
    });
    coordinator.getMcpLogs({
      kind: "getMcpLogs",
      requestId: "logs",
      serverId: "server-1",
    });
    await flush();

    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "settingsSection",
        requestId: "list",
        error: expect.objectContaining({ code: "settings-unavailable" }),
      }),
      expect.objectContaining({
        kind: "mcpServer",
        requestId: "detail",
        result: {
          ok: false,
          error: expect.objectContaining({ code: "settings-unavailable" }),
        },
      }),
      expect.objectContaining({
        kind: "mcpLogs",
        requestId: "logs",
        result: {
          ok: false,
          error: expect.objectContaining({ code: "settings-unavailable" }),
        },
      }),
    ]));
    expect(messages).toHaveLength(3);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("keeps MCP detail latest per server while independent servers proceed", async () => {
    const ctx = new Context();
    const first = deferred<Record<string, { configured: boolean }>>();
    let firstCalls = 0;
    ctx.provide("mcp", mcpService({
      list: () => [mcpRecord("first"), mcpRecord("second")],
      get: (id) => mcpRecord(id),
      describeSecrets: (id) => {
        if (id === "first" && firstCalls++ === 0) return first.promise;
        return Promise.resolve({});
      },
    }) as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );
    const detail = (requestId: string, serverId: string) =>
      coordinator.getMcpServer({
        kind: "getMcpServer",
        requestId,
        serverId,
      });

    detail("first-old", "first");
    detail("first-new", "first");
    detail("second", "second");
    await flush();

    expect(messages.filter((message) => message.kind === "mcpServer")
      .map((message) => message.requestId)).toEqual(["first-new", "second"]);
    first.resolve({});
    await flush();
    expect(messages.filter((message) => message.kind === "mcpServer")
      .map((message) => message.requestId)).toEqual(["first-new", "second"]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("suppresses an in-flight MCP detail after disposal", async () => {
    const ctx = new Context();
    const pending = deferred<Record<string, { configured: boolean }>>();
    ctx.provide("mcp", mcpService({
      describeSecrets: () => pending.promise,
    }) as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.getMcpServer({
      kind: "getMcpServer",
      requestId: "disposed",
      serverId: "server-1",
    });
    coordinator.dispose();
    pending.resolve({});
    await flush();

    expect(messages).toEqual([]);
    await ctx.fiber.dispose();
  });

  it("maps MCP projection failures to bounded mcp-rejected errors", async () => {
    const ctx = new Context();
    ctx.provide("mcp", mcpService({
      getStatus: () => ({
        state: "failed",
        error: "x".repeat(513),
        at: "now",
      }),
      getTools: () => [{ name: "bad", enabled: true }],
      describeSecrets: async () => {
        throw new Error("degraded");
      },
    }) as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.getMcpServer({
      kind: "getMcpServer",
      requestId: "detail",
      serverId: "missing",
    });
    await flush();

    expect(messages).toEqual([{
      kind: "mcpServer",
      requestId: "detail",
      result: {
        ok: false,
        error: {
          code: "mcp-rejected",
          message: expect.stringMatching(/^MCP server "missing"/),
        },
      },
    }]);
    expect((messages[0] as { result: { error: { message: string } } })
      .result.error.message.length).toBeLessThanOrEqual(512);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("emits a valid MCP detail when failed status error text is empty", async () => {
    const ctx = new Context();
    ctx.provide("mcp", mcpService({
      getStatus: () => ({ state: "failed", error: "", at: "now" }),
    }) as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.getMcpServer({
      kind: "getMcpServer",
      requestId: "empty-failure",
      serverId: "server-1",
    });
    await flush();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(expect.objectContaining({
      kind: "mcpServer",
      requestId: "empty-failure",
      result: {
        ok: true,
        detail: expect.objectContaining({
          status: {
            state: "failed",
            error: "MCP connection failed",
            at: "now",
          },
        }),
      },
    }));
    expect(messages.every(isSettingsOutboundMessage)).toBe(true);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("bounds foreign MCP section failure text before wire", async () => {
    const ctx = new Context();
    ctx.provide("mcp", mcpService({
      list: () => {
        throw new Error("x".repeat(513));
      },
    }) as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.getSection("mcp", "mcp");
    await flush();

    const response = messages[0];
    expect(response).toEqual(expect.objectContaining({
      kind: "settingsSection",
      requestId: "mcp",
      error: expect.objectContaining({ code: "settings-rejected" }),
    }));
    if (response?.kind !== "settingsSection" || response.error === undefined) {
      throw new TypeError("expected MCP settings section error");
    }
    expect(response.error.message).toHaveLength(512);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("registers, replaces, and disposes MCP catalog listeners", async () => {
    const ctx = new Context();
    const messages: OutboundMessage[] = [];
    const listeners: (() => void)[] = [];
    const disposers: ReturnType<typeof vi.fn>[] = [];
    const service = (): McpManagementService => mcpService({
      onCatalogChanged: (listener) => {
        listeners.push(listener);
        const dispose = vi.fn();
        disposers.push(dispose);
        return dispose;
      },
    });
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    const removeFirst = ctx.provide("mcp", service() as never);
    expect(listeners).toHaveLength(1);
    listeners[0]!();
    expect(messages.at(-1)).toEqual({
      kind: "settingsInvalidated",
      sections: ["mcp"],
      reason: "mcp",
    });

    await removeFirst();
    expect(disposers[0]).toHaveBeenCalledOnce();
    const beforeLateCall = messages.length;
    listeners[0]!();
    expect(messages).toHaveLength(beforeLateCall);

    ctx.provide("mcp", service() as never);
    expect(listeners).toHaveLength(2);
    coordinator.dispose();
    expect(disposers[1]).toHaveBeenCalledOnce();
    listeners[1]!();
    expect(messages).toHaveLength(beforeLateCall + 1);
    await ctx.fiber.dispose();
  });

  it("returns settings-unavailable for an MCP operation without a service", async () => {
    const ctx = new Context();
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.runMcpOperation({
      kind: "runMcpOperation",
      requestId: "missing",
      operation: { kind: "connectServer", serverId: "server-1" },
    });
    await flush();

    expect(messages).toEqual([{
      kind: "mcpOperation",
      requestId: "missing",
      result: {
        ok: false,
        error: {
          code: "settings-unavailable",
          message: "MCP settings are not available",
        },
      },
    }]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("returns settings-unavailable for OAuth discovery without a service", async () => {
    const ctx = new Context();
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.discoverMcpOAuth({
      kind: "discoverMcpOAuth",
      requestId: "missing",
      url: "https://mcp.example/rpc",
    });
    await flush();

    expect(messages).toEqual([{
      kind: "mcpOAuthDiscovery",
      requestId: "missing",
      result: {
        ok: false,
        error: {
          code: "settings-unavailable",
          message: "MCP settings are not available",
        },
      },
    }]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("returns discovered OAuth endpoints and reports an unsupported plugin", async () => {
    const ctx = new Context();
    ctx.provide("mcp", mcpService({
      discoverOAuth: async () => ({
        clientId: "issued",
        authorizeUrl: "https://auth.example/authorize",
        tokenUrl: "https://auth.example/token",
        scopes: ["docs:read"],
        registered: true,
      }),
    }) as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.discoverMcpOAuth({
      kind: "discoverMcpOAuth",
      requestId: "found",
      url: "https://mcp.example/rpc",
    });
    await flush();

    expect(messages).toEqual([{
      kind: "mcpOAuthDiscovery",
      requestId: "found",
      result: {
        ok: true,
        discovery: {
          clientId: "issued",
          authorizeUrl: "https://auth.example/authorize",
          tokenUrl: "https://auth.example/token",
          scopes: ["docs:read"],
          registered: true,
          clientSecretIssued: false,
        },
      },
    }]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("reports a plugin without a discovery entry point as mcp-rejected", async () => {
    const ctx = new Context();
    ctx.provide("mcp", mcpService() as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.discoverMcpOAuth({
      kind: "discoverMcpOAuth",
      requestId: "unsupported",
      url: "https://mcp.example/rpc",
    });
    await flush();

    expect(messages).toEqual([{
      kind: "mcpOAuthDiscovery",
      requestId: "unsupported",
      result: {
        ok: false,
        error: {
          code: "mcp-rejected",
          message: "The mounted MCP plugin does not support OAuth discovery",
        },
      },
    }]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("keeps only the latest OAuth discovery reply", async () => {
    const ctx = new Context();
    const first = deferred<void>();
    let calls = 0;
    ctx.provide("mcp", mcpService({
      discoverOAuth: async () => {
        if (calls++ === 0) await first.promise;
        return {
          clientId: "issued",
          authorizeUrl: "https://auth.example/authorize",
          tokenUrl: "https://auth.example/token",
          scopes: [],
          registered: false,
        };
      },
    }) as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.discoverMcpOAuth({
      kind: "discoverMcpOAuth",
      requestId: "stale",
      url: "https://mcp.example/rpc",
    });
    coordinator.discoverMcpOAuth({
      kind: "discoverMcpOAuth",
      requestId: "fresh",
      url: "https://mcp.example/rpc",
    });
    await flush();
    first.resolve(undefined);
    await flush();

    expect(messages.filter((message) => message.kind === "mcpOAuthDiscovery"))
      .toEqual([expect.objectContaining({ requestId: "fresh" })]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("returns settings-unavailable for a structurally incomplete MCP service", async () => {
    const ctx = new Context();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ctx.provide("mcp", { list: () => [] } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.runMcpOperation({
      kind: "runMcpOperation",
      requestId: "incomplete",
      operation: { kind: "connectServer", serverId: "server-1" },
    });
    await flush();

    expect(messages.at(-1)).toEqual({
      kind: "mcpOperation",
      requestId: "incomplete",
      result: {
        ok: false,
        error: expect.objectContaining({ code: "settings-unavailable" }),
      },
    });
    coordinator.dispose();
    await ctx.fiber.dispose();
    warn.mockRestore();
  });

  it("keeps MCP operations latest per server while different servers proceed", async () => {
    const ctx = new Context();
    const first = deferred<void>();
    let firstCalls = 0;
    ctx.provide("mcp", mcpService({
      list: () => [mcpRecord("first"), mcpRecord("second")],
      get: (id) => mcpRecord(id),
      connect: (id) => (
        id === "first" && firstCalls++ === 0 ? first.promise : Promise.resolve()
      ),
    }) as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );
    const connect = (requestId: string, serverId: string) =>
      coordinator.runMcpOperation({
        kind: "runMcpOperation",
        requestId,
        operation: { kind: "connectServer", serverId },
      });

    connect("first-old", "first");
    connect("first-new", "first");
    connect("second", "second");
    await flush();

    expect(messages.filter((message) => message.kind === "mcpOperation")
      .map((message) => message.requestId)).toEqual(["first-new", "second"]);
    first.resolve(undefined);
    await flush();
    expect(messages.filter((message) => message.kind === "mcpOperation")
      .map((message) => message.requestId)).toEqual(["first-new", "second"]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("uses one latest-request key for MCP creates", async () => {
    const ctx = new Context();
    const first = deferred<McpServerRecordLike>();
    let calls = 0;
    const records = new Map<string, McpServerRecordLike>();
    ctx.provide("mcp", mcpService({
      list: () => [...records.values()],
      get: (id) => records.get(id),
      upsert: async (record) => {
        if (calls++ === 0) return first.promise;
        records.set(record.id, record);
        return record;
      },
    }) as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );
    const create = (requestId: string, serverName: string) =>
      coordinator.runMcpOperation({
        kind: "runMcpOperation",
        requestId,
        operation: {
          kind: "upsertServer",
          server: {
            serverName,
            enabled: true,
            transport: "stdio",
            command: "node",
            auth: { kind: "none" },
            toolCallTimeoutMs: 30_000,
            reconnect: {
              enabled: true,
              initialDelayMs: 100,
              maxDelayMs: 1_000,
              maxAttempts: 3,
            },
          },
        },
      });

    create("old", "Old");
    create("new", "New");
    await flush();
    first.resolve(mcpRecord("old"));
    await flush();

    expect(messages.filter((message) => message.kind === "mcpOperation"))
      .toEqual([expect.objectContaining({ requestId: "new" })]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("uses one latest-request key for OAuth provisions", async () => {
    const ctx = new Context();
    const first = deferred<void>();
    let discoveries = 0;
    const records = new Map<string, McpServerRecordLike>();
    ctx.provide("mcp", mcpService({
      list: () => [...records.values()],
      get: (id) => records.get(id),
      discoverOAuth: async () => {
        if (discoveries++ === 0) await first.promise;
        return {
          clientId: "issued",
          authorizeUrl: "https://auth.example/authorize",
          tokenUrl: "https://auth.example/token",
          scopes: [],
          registered: true,
        };
      },
      oauthRedirectOrigin: () => "http://127.0.0.1:9",
      upsert: async (record) => {
        records.set(record.id, record);
        return record;
      },
      startOAuth: async () => ({
        authorizeUrl: "https://auth.example/authorize?client_id=issued",
      }),
    }) as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );
    const provision = (requestId: string, serverName: string) =>
      coordinator.runMcpOperation({
        kind: "runMcpOperation",
        requestId,
        operation: {
          kind: "provisionOAuthServer",
          serverName,
          url: "https://mcp.example/rpc",
          enabled: true,
        },
      });

    provision("old", "Old");
    provision("new", "New");
    await flush();
    first.resolve(undefined);
    await flush();

    expect(messages.filter((message) => message.kind === "mcpOperation"))
      .toEqual([{
        kind: "mcpOperation",
        requestId: "new",
        result: {
          ok: true,
          detail: expect.objectContaining({
            server: expect.objectContaining({ serverName: "New" }),
          }),
          authorizeUrl: "https://auth.example/authorize?client_id=issued",
        },
      }]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("allows OAuth provision and a named-server operation to overlap", async () => {
    const ctx = new Context();
    const discovery = deferred<void>();
    const records = new Map([["server-1", mcpRecord()]]);
    const connect = vi.fn(async () => {});
    ctx.provide("mcp", mcpService({
      list: () => [...records.values()],
      get: (id) => records.get(id),
      discoverOAuth: async () => {
        await discovery.promise;
        return {
          clientId: "issued",
          authorizeUrl: "https://auth.example/authorize",
          tokenUrl: "https://auth.example/token",
          scopes: [],
          registered: true,
        };
      },
      oauthRedirectOrigin: () => "http://127.0.0.1:9",
      upsert: async (record) => {
        records.set(record.id, record);
        return record;
      },
      startOAuth: async () => ({
        authorizeUrl: "https://auth.example/authorize",
      }),
      connect,
    }) as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.runMcpOperation({
      kind: "runMcpOperation",
      requestId: "provision",
      operation: {
        kind: "provisionOAuthServer",
        serverName: "New",
        url: "https://mcp.example/rpc",
        enabled: true,
      },
    });
    coordinator.runMcpOperation({
      kind: "runMcpOperation",
      requestId: "connect",
      operation: { kind: "connectServer", serverId: "server-1" },
    });
    await flush();

    expect(connect).toHaveBeenCalledWith("server-1");
    expect(messages).toContainEqual(expect.objectContaining({
      kind: "mcpOperation",
      requestId: "connect",
    }));
    discovery.resolve(undefined);
    await flush();
    expect(messages).toContainEqual(expect.objectContaining({
      kind: "mcpOperation",
      requestId: "provision",
    }));
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("rejects startOAuth when the plugin has no loopback origin", async () => {
    const ctx = new Context();
    const startOAuth = vi.fn(async () => ({
      authorizeUrl: "https://auth.example/authorize",
    }));
    ctx.provide("mcp", mcpService({ startOAuth }) as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.runMcpOperation({
      kind: "runMcpOperation",
      requestId: "authorize",
      operation: { kind: "startOAuth", serverId: "server-1" },
    });
    await flush();

    expect(messages).toEqual([{
      kind: "mcpOperation",
      requestId: "authorize",
      result: {
        ok: false,
        error: {
          code: "mcp-rejected",
          message: "The mounted MCP plugin cannot authorize OAuth servers in this profile",
        },
      },
    }]);
    expect(startOAuth).not.toHaveBeenCalled();
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("redacts MCP secret failures in the coordinator response", async () => {
    const ctx = new Context();
    const literal = "fixture-secret";
    const pluginText = `plugin echoed ${literal}`;
    const record = mcpRecord();
    record.auth = { kind: "headers", headerNames: ["Authorization"] };
    ctx.provide("mcp", mcpService({
      get: () => record,
      setSecrets: async () => {
        throw new Error(pluginText);
      },
    }) as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.runMcpOperation({
      kind: "runMcpOperation",
      requestId: "secret",
      operation: {
        kind: "setServerSecrets",
        serverId: record.id,
        secrets: [{ name: "Authorization", value: literal }],
      },
    });
    await flush();

    expect(messages).toEqual([{
      kind: "mcpOperation",
      requestId: "secret",
      result: {
        ok: false,
        error: {
          code: "mcp-rejected",
          message: expect.stringContaining("Authorization"),
        },
      },
    }]);
    expect(JSON.stringify(messages)).not.toContain(literal);
    expect(JSON.stringify(messages)).not.toContain(pluginText);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it.each<{
    label: string;
    operation: McpOperationWire;
    overrides: Partial<McpManagementService>;
    expected: string;
  }>([
    {
      label: "remove",
      operation: { kind: "removeServer", serverId: "server-1" },
      overrides: { remove: async () => { throw new Error(""); } },
      expected: 'MCP server "server-1" could not be removed',
    },
    {
      label: "set enabled",
      operation: {
        kind: "setServerEnabled",
        serverId: "server-1",
        enabled: false,
      },
      overrides: {
        setEnabled: async () => {
          throw { message: "", detail: "plugin echoed fixture-secret" };
        },
      },
      expected: 'MCP server "server-1" could not be disabled',
    },
    {
      label: "connect",
      operation: { kind: "connectServer", serverId: "server-1" },
      overrides: { connect: async () => { throw new Error(""); } },
      expected: 'MCP server "server-1" could not connect',
    },
    {
      label: "disconnect",
      operation: { kind: "disconnectServer", serverId: "server-1" },
      overrides: {
        disconnect: async () => {
          throw { message: "", detail: "plugin echoed fixture-secret" };
        },
      },
      expected: 'MCP server "server-1" could not disconnect',
    },
    {
      label: "tool toggle",
      operation: {
        kind: "setToolEnabled",
        serverId: "server-1",
        toolName: "known",
        enabled: false,
      },
      overrides: {
        getTools: () => [{ name: "known", enabled: true }],
        setToolEnabled: async () => { throw new Error(""); },
      },
      expected: 'MCP tool "known" on server "server-1" could not be disabled',
    },
    {
      label: "clear OAuth",
      operation: { kind: "clearOAuthTokens", serverId: "server-1" },
      overrides: {
        clearOAuth: async () => {
          throw { message: "", detail: "plugin echoed fixture-secret" };
        },
      },
      expected: 'OAuth tokens for MCP server "server-1" could not be cleared',
    },
  ])(
    "settles an empty $label rejection with a valid bounded MCP response",
    async ({ operation, overrides, expected }) => {
      const ctx = new Context();
      ctx.provide("mcp", mcpService(overrides) as never);
      const messages: OutboundMessage[] = [];
      const coordinator = createSettingsCoordinator(
        ctx,
        (message) => messages.push(message),
      );

      coordinator.runMcpOperation({
        kind: "runMcpOperation",
        requestId: `empty-${operation.kind}`,
        operation,
      });
      await flush();

      expect(messages).toEqual([{
        kind: "mcpOperation",
        requestId: `empty-${operation.kind}`,
        result: {
          ok: false,
          error: { code: "mcp-rejected", message: expected },
        },
      }]);
      expect(messages.every(isSettingsOutboundMessage)).toBe(true);
      expect(JSON.stringify(messages)).not.toContain("fixture-secret");
      expect(JSON.stringify(messages)).not.toContain("plugin echoed");
      expect(expected.length).toBeGreaterThan(0);
      expect(expected.length).toBeLessThanOrEqual(512);
      coordinator.dispose();
      await ctx.fiber.dispose();
    },
  );

  it("defers MCP catalog invalidation until an operation settles", async () => {
    const ctx = new Context();
    const pending = deferred<void>();
    let listener: (() => void) | undefined;
    ctx.provide("mcp", mcpService({
      connect: () => pending.promise,
      onCatalogChanged: (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    }) as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.runMcpOperation({
      kind: "runMcpOperation",
      requestId: "connect",
      operation: { kind: "connectServer", serverId: "server-1" },
    });
    listener?.();
    await flush();
    expect(messages).toEqual([]);

    pending.resolve(undefined);
    await flush();
    expect(messages.map((message) => message.kind)).toEqual([
      "mcpOperation",
      "settingsInvalidated",
    ]);
    expect(messages[1]).toEqual({
      kind: "settingsInvalidated",
      sections: ["mcp"],
      reason: "mcp",
    });
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("suppresses an in-flight MCP operation reply after disposal", async () => {
    const ctx = new Context();
    const pending = deferred<void>();
    ctx.provide("mcp", mcpService({ connect: () => pending.promise }) as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(
      ctx,
      (message) => messages.push(message),
    );

    coordinator.runMcpOperation({
      kind: "runMcpOperation",
      requestId: "disposed",
      operation: { kind: "connectServer", serverId: "server-1" },
    });
    coordinator.dispose();
    pending.resolve(undefined);
    await flush();

    expect(messages).toEqual([]);
    await ctx.fiber.dispose();
  });

  it.each([
    [
      {
        engine: "unknown" as never,
        engines: {},
      },
      'Web Search catalog engine "unknown" is not supported',
    ],
    [
      {
        engine: "searxng" as const,
        engines: { searxng: { baseURL: "x".repeat(2_049) } },
      },
      "Web Search catalog engines.searxng.baseURL exceeds 2048 characters",
    ],
  ])(
    "returns a valid explicit error for malformed Web Search catalog projection",
    async (catalog, expectedMessage) => {
      const ctx = new Context();
      ctx.provide("webSearchManager", {
        getCatalog: () => catalog,
        putCatalog: async (candidate: WebSearchCatalogLike) => candidate,
        describeSecrets: async () => ({}),
        putSecrets: async () => {},
        available: () => false,
      } as never);
      const messages: OutboundMessage[] = [];
      const coordinator = createSettingsCoordinator(
        ctx,
        (message) => messages.push(message),
      );

      coordinator.getSection("malformed", "web-search");
      await flush();

      expect(messages.at(-1)).toEqual({
        kind: "settingsSection",
        requestId: "malformed",
        error: {
          code: "settings-rejected",
          message: expectedMessage,
        },
      });
      expect(messages.every(isSettingsOutboundMessage)).toBe(true);
      coordinator.dispose();
      await ctx.fiber.dispose();
    },
  );

  it("keeps only the latest Web Search save result", async () => {
    const ctx = new Context();
    const first = deferred<WebSearchCatalogLike>();
    let calls = 0;
    let current: WebSearchCatalogLike = { engine: null, engines: {} };
    ctx.provide("webSearchManager", {
      getCatalog: () => current,
      putCatalog: async (catalog: WebSearchCatalogLike) => {
        if (calls++ === 0) return first.promise;
        current = catalog;
        return catalog;
      },
      describeSecrets: async () => ({
        TAVILY_API_KEY: { configured: false },
        BRAVE_API_KEY: { configured: false },
      }),
      putSecrets: async () => {},
      available: () => true,
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));
    const save = (requestId: string, engine: "tavily" | "brave") =>
      coordinator.setWebSearchConfig({
        kind: "setWebSearchConfig",
        requestId,
        catalog: { engine, engines: [] },
        secrets: [],
      });

    save("old", "tavily");
    save("new", "brave");
    await flush();
    first.resolve({ engine: "tavily", engines: {} });
    await flush();

    expect(messages.filter((message) => message.kind === "webSearchMutation"))
      .toEqual([expect.objectContaining({ requestId: "new" })]);
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("maps catalog rejection to web-search-rejected without calling secrets", async () => {
    const ctx = new Context();
    const putSecrets = vi.fn();
    ctx.provide("webSearchManager", {
      getCatalog: () => ({ engine: null, engines: {} }),
      putCatalog: async () => {
        throw new Error("invalid catalog");
      },
      describeSecrets: async () => ({}),
      putSecrets,
      available: () => false,
    } as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.setWebSearchConfig({
      kind: "setWebSearchConfig",
      requestId: "rejected",
      catalog: { engine: null, engines: [] },
      secrets: [{ ref: "TAVILY_API_KEY", value: "fixture-secret" }],
    });
    await flush();

    expect(messages).toEqual([{
      kind: "webSearchMutation",
      requestId: "rejected",
      result: {
        ok: false,
        error: {
          code: "web-search-rejected",
          message: "invalid catalog",
        },
      },
    }]);
    expect(putSecrets).not.toHaveBeenCalled();
    expect(JSON.stringify(messages)).not.toContain("fixture-secret");
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("defers Web Search change invalidation until its save settles", async () => {
    const ctx = new Context();
    const pending = deferred<WebSearchCatalogLike>();
    let listener: (() => void) | undefined;
    const service: WebSearchManagementService = {
      getCatalog: () => ({ engine: "tavily", engines: {} }),
      putCatalog: () => pending.promise,
      describeSecrets: async () => ({
        TAVILY_API_KEY: { configured: false },
        BRAVE_API_KEY: { configured: false },
      }),
      putSecrets: async () => {},
      available: () => true,
      onChanged: (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    };
    ctx.provide("webSearchManager", service as never);
    const messages: OutboundMessage[] = [];
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    coordinator.setWebSearchConfig({
      kind: "setWebSearchConfig",
      requestId: "save",
      catalog: { engine: "tavily", engines: [] },
      secrets: [],
    });
    listener?.();
    await flush();
    expect(messages).toEqual([]);

    pending.resolve({ engine: "tavily", engines: {} });
    await flush();
    expect(messages.map((message) => message.kind)).toEqual([
      "webSearchMutation",
      "settingsInvalidated",
    ]);
    expect(messages[1]).toEqual({
      kind: "settingsInvalidated",
      sections: ["web-search"],
      reason: "web-search",
    });
    coordinator.dispose();
    await ctx.fiber.dispose();
  });

  it("registers, replaces, and disposes Web Search change listeners", async () => {
    const ctx = new Context();
    const messages: OutboundMessage[] = [];
    const listeners: (() => void)[] = [];
    const disposers: ReturnType<typeof vi.fn>[] = [];
    const service = (): WebSearchManagementService => ({
      getCatalog: () => ({ engine: null, engines: {} }),
      putCatalog: async (catalog) => catalog,
      describeSecrets: async () => ({}),
      putSecrets: async () => {},
      available: () => false,
      onChanged: (listener) => {
        listeners.push(listener);
        const dispose = vi.fn();
        disposers.push(dispose);
        return dispose;
      },
    });
    const coordinator = createSettingsCoordinator(ctx, (message) => messages.push(message));

    const removeFirst = ctx.provide("webSearchManager", service() as never);
    expect(listeners).toHaveLength(1);
    listeners[0]!();
    expect(messages.at(-1)).toEqual({
      kind: "settingsInvalidated",
      sections: ["web-search"],
      reason: "web-search",
    });

    await removeFirst();
    expect(disposers[0]).toHaveBeenCalledOnce();
    const beforeLateCall = messages.length;
    listeners[0]!();
    expect(messages).toHaveLength(beforeLateCall);

    ctx.provide("webSearchManager", service() as never);
    expect(listeners).toHaveLength(2);
    coordinator.dispose();
    expect(disposers[1]).toHaveBeenCalledOnce();
    listeners[1]!();
    expect(messages).toHaveLength(beforeLateCall + 1);
    await ctx.fiber.dispose();
  });
});

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
  type OutboundMessage,
} from "@dsh-vscode/contract";
import { createSettingsCoordinator } from "./coordinator.js";

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

describe("settings coordinator", () => {
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
});

import { describe, expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import {
  settingsNamespace,
  type SettingsDescriptor,
} from "@deepseek-ai/dsh-settings";
import { isSettingsOutboundMessage } from "@dsh-vscode/contract";
import {
  buildModelsView,
  MAX_MODELS_PER_PROVIDER,
  MAX_PROVIDERS,
} from "./models.js";

/** `getBuiltinProviders()` from `@earendil-works/pi-ai/providers/all` at 0.82.1. */
const PI_AI_BUILTIN_PROVIDERS = [
  "amazon-bedrock", "ant-ling", "anthropic", "azure-openai-responses",
  "cerebras", "cloudflare-ai-gateway", "cloudflare-workers-ai", "deepseek",
  "fireworks", "github-copilot", "google", "google-vertex", "groq",
  "huggingface", "kimi-coding", "minimax", "minimax-cn", "mistral",
  "moonshotai", "moonshotai-cn", "nvidia", "openai", "openai-codex",
  "opencode", "opencode-go", "openrouter", "qwen-token-plan",
  "qwen-token-plan-cn", "together", "vercel-ai-gateway", "xai", "xiaomi",
  "xiaomi-token-plan-ams", "xiaomi-token-plan-cn", "xiaomi-token-plan-sgp",
  "zai", "zai-coding-cn",
];

const profileSchema = {
  uid: 1,
  refs: {
    "1": {
      type: "object",
      meta: {},
      dict: {
        apiKeyEnv: 2,
        displayName: 3,
        api: 4,
        baseURL: 7,
        models: 8,
      },
    },
    "2": { type: "string", meta: { role: "credential-ref" } },
    "3": { type: "string", meta: {} },
    "4": { type: "union", meta: {}, list: [5, 6] },
    "5": { type: "const", meta: {}, value: "openai-completions" },
    "6": { type: "const", meta: {}, value: "anthropic-messages" },
    "7": { type: "string", meta: {} },
    "8": { type: "array", meta: {}, inner: 9 },
    "9": { type: "object", meta: {}, dict: { id: 3 } },
  },
};

const piAiSchema = {
  uid: 10,
  refs: {
    ...profileSchema.refs,
    "10": { type: "object", meta: {}, dict: { providers: 11 } },
    "11": { type: "dict", meta: {}, inner: 1 },
  },
};

const deepseekSchema = {
  uid: 12,
  refs: {
    ...profileSchema.refs,
    "12": {
      type: "object",
      meta: {},
      dict: {
        apiKeyEnv: 2,
        baseURL: 7,
        models: 8,
      },
    },
  },
};

const descriptor = (
  namespace: string,
  schema: unknown,
  value: Record<string, unknown>,
  user: Record<string, unknown> = {},
  base: Record<string, unknown> = {},
): SettingsDescriptor => ({
  ns: settingsNamespace(namespace),
  schema,
  revision: 2,
  applies: "live",
  base,
  user,
  value,
  secrets: [],
});

describe("buildModelsView", () => {
  it("projects actual provider addresses, profiles, credentials, and catalogs", async () => {
    const ctx = new Context();
    const deepseek = descriptor(
      "llm-deepseek",
      deepseekSchema,
      {
        apiKeyEnv: "DEEPSEEK_API_KEY",
        baseURL: "https://api.deepseek.com",
      },
    );
    const piAi = descriptor(
      "llm-pi-ai",
      piAiSchema,
      {
        providers: {
          openai: {
            apiKeyEnv: "OPENAI_API_KEY",
            displayName: "OpenAI Team",
            api: "openai-completions",
            baseURL: "https://gateway.example/v1",
          },
        },
      },
      { providers: { openai: { apiKeyEnv: "OPENAI_API_KEY" } } },
    );
    ctx.provide("settings", {
      writable: true,
      describe: vi.fn(() => [deepseek, piAi]),
    } as never);
    const listModels = vi.fn(async (provider: string) => provider === "deepseek-official"
      ? [{ provider, id: "deepseek-chat", name: "DeepSeek Chat" }]
      : [{ provider, id: "gpt-5", name: "GPT-5" }]);
    ctx.provide("llm", {
      listConfigurableProviders: () => [
        {
          provider: "deepseek-official",
          displayName: "DeepSeek",
          settingsNs: "llm-deepseek",
          settingsPath: [],
        },
        {
          provider: "openai",
          displayName: "OpenAI",
          settingsNs: "llm-pi-ai",
          settingsPath: ["providers", "openai"],
          declared: false,
        },
      ],
      listProviders: () => [
        { id: "deepseek-official", name: "DeepSeek" },
        { id: "openai", name: "OpenAI Team" },
      ],
      listModels,
      resolveModelInfo: async (provider: string, model: string) => ({
        provider,
        id: model,
        name: model,
        context: { contextWindow: provider === "openai" ? 400_000 : 128_000 },
      }),
    } as never);
    const resolve = vi.fn(async () => ({
      value: "fixture-secret",
      source: "file",
    }));
    ctx.provide("credentials", {
      resolve,
      describe: async (ref: string) => ref === "DEEPSEEK_API_KEY"
        ? { configured: true, source: "env", writable: false }
        : { configured: true, source: "file", writable: true },
    } as never);

    const view = await buildModelsView(ctx);

    expect(view.providers).toEqual([
      {
        id: "deepseek-official",
        namespace: "llm-deepseek",
        label: "DeepSeek",
        active: true,
        catalog: { kind: "ready" },
        baseURL: "https://api.deepseek.com",
        credential: {
          ref: "DEEPSEEK_API_KEY",
          set: true,
          source: "env",
          writable: false,
        },
        credentialStatus: { kind: "ready" },
        models: [{
          id: "deepseek-chat",
          label: "DeepSeek Chat",
          contextWindow: 128_000,
        }],
        removable: false,
        fields: [
          {
            path: ["apiKeyEnv"],
            label: "API key reference",
            kind: "credential-ref",
          },
          { path: ["baseURL"], label: "Base URL", kind: "string" },
        ],
      },
      {
        id: "openai",
        namespace: "llm-pi-ai",
        label: "OpenAI",
        active: true,
        declared: false,
        catalog: { kind: "ready" },
        api: "openai-completions",
        baseURL: "https://gateway.example/v1",
        credential: {
          ref: "OPENAI_API_KEY",
          set: true,
          source: "file",
          writable: true,
        },
        credentialStatus: { kind: "ready" },
        models: [{ id: "gpt-5", label: "GPT-5", contextWindow: 400_000 }],
        removable: true,
        fields: [
          {
            path: ["providers", "openai", "apiKeyEnv"],
            label: "API key reference",
            kind: "credential-ref",
          },
          {
            path: ["providers", "openai", "displayName"],
            label: "Display name",
            kind: "string",
          },
          {
            path: ["providers", "openai", "api"],
            label: "API",
            kind: "union",
            options: [
              { value: "openai-completions", label: "openai-completions" },
              { value: "anthropic-messages", label: "anthropic-messages" },
            ],
          },
          {
            path: ["providers", "openai", "baseURL"],
            label: "Base URL",
            kind: "string",
          },
        ],
      },
    ]);
    expect(view.credentials).toEqual([
      {
        ref: "DEEPSEEK_API_KEY",
        set: true,
        source: "env",
        writable: false,
      },
      {
        ref: "OPENAI_API_KEY",
        set: true,
        source: "file",
        writable: true,
      },
    ]);
    expect(resolve).not.toHaveBeenCalled();
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "models",
      view,
    })).toBe(true);
    expect(JSON.stringify(view)).not.toContain("fixture-secret");
    await ctx.fiber.dispose();
  });

  it("isolates one provider catalog failure and keeps dormant providers", async () => {
    const ctx = new Context();
    const piAi = descriptor(
      "llm-pi-ai",
      piAiSchema,
      {
        providers: {
          openai: { apiKeyEnv: "OPENAI_API_KEY" },
          anthropic: {},
          broken: {},
        },
      },
    );
    ctx.provide("settings", {
      writable: true,
      describe: () => [piAi],
    } as never);
    const listModels = vi.fn(async (provider: string) => {
      if (provider === "broken") {
        throw new Error("catalog backend leaked fixture-secret");
      }
      return [{ provider, id: "usable", name: "Usable" }];
    });
    ctx.provide("llm", {
      listConfigurableProviders: () => ["openai", "anthropic", "broken"].map((provider) => ({
        provider,
        displayName: provider,
        settingsNs: "llm-pi-ai",
        settingsPath: ["providers", provider],
      })),
      listProviders: () => [
        { id: "openai", name: "openai" },
        { id: "broken", name: "broken" },
      ],
      listModels,
      resolveModelInfo: async (provider: string, model: string) => ({
        provider,
        id: model,
        name: model,
      }),
    } as never);
    ctx.provide("credentials", {
      describe: async () => ({
        configured: false,
        writable: true,
      }),
    } as never);

    const view = await buildModelsView(ctx);

    expect(view.providers.map((provider) => ({
      id: provider.id,
      active: provider.active,
      catalog: provider.catalog.kind,
      models: provider.models.map((model) => model.id),
    }))).toEqual([
      { id: "openai", active: true, catalog: "ready", models: ["usable"] },
      { id: "anthropic", active: false, catalog: "dormant", models: [] },
      { id: "broken", active: true, catalog: "failed", models: [] },
    ]);
    expect(view.providers[2]?.catalog).toEqual({
      kind: "failed",
      message: "Model catalog is unavailable",
    });
    expect(listModels).not.toHaveBeenCalledWith("anthropic");
    expect(JSON.stringify(view)).not.toContain("fixture-secret");
    await ctx.fiber.dispose();
  });

  it("isolates and sanitizes credential metadata failures", async () => {
    const ctx = new Context();
    const piAi = descriptor(
      "llm-pi-ai",
      piAiSchema,
      {
        providers: {
          openai: { apiKeyEnv: "OPENAI_API_KEY" },
          broken: { apiKeyEnv: "BROKEN_API_KEY" },
        },
      },
    );
    ctx.provide("settings", {
      writable: true,
      describe: () => [piAi],
    } as never);
    ctx.provide("llm", {
      listConfigurableProviders: () => ["openai", "broken"].map((provider) => ({
        provider,
        displayName: provider,
        settingsNs: "llm-pi-ai",
        settingsPath: ["providers", provider],
      })),
      listProviders: () => [],
      listModels: vi.fn(),
      resolveModelInfo: vi.fn(),
    } as never);
    ctx.provide("credentials", {
      describe: async (ref: string) => {
        if (ref === "BROKEN_API_KEY") {
          throw new Error("credential backend leaked fixture-secret");
        }
        return { configured: false, writable: true };
      },
    } as never);

    const view = await buildModelsView(ctx);

    expect(view.providers.map((provider) => ({
      id: provider.id,
      credential: provider.credential,
      status: provider.credentialStatus,
    }))).toEqual([
      {
        id: "openai",
        credential: {
          ref: "OPENAI_API_KEY",
          set: false,
          writable: true,
        },
        status: { kind: "ready" },
      },
      {
        id: "broken",
        credential: undefined,
        status: {
          kind: "failed",
          message: "Credential metadata is unavailable",
        },
      },
    ]);
    expect(JSON.stringify(view)).not.toContain("fixture-secret");
    await ctx.fiber.dispose();
  });

  it("marks referenced credentials failed when storage is absent", async () => {
    const ctx = new Context();
    const piAi = descriptor(
      "llm-pi-ai",
      piAiSchema,
      { providers: { openai: { apiKeyEnv: "OPENAI_API_KEY" } } },
    );
    ctx.provide("settings", {
      writable: true,
      describe: () => [piAi],
    } as never);
    ctx.provide("llm", {
      listConfigurableProviders: () => [{
        provider: "openai",
        displayName: "OpenAI",
        settingsNs: "llm-pi-ai",
        settingsPath: ["providers", "openai"],
      }],
      listProviders: () => [],
    } as never);

    const view = await buildModelsView(ctx);

    expect(view.providers[0]).toEqual(expect.objectContaining({
      credentialStatus: {
        kind: "failed",
        message: "Credential metadata is unavailable",
      },
    }));
    expect(view.providers[0]).not.toHaveProperty("credential");
    expect(view.credentials).toEqual([]);
    await ctx.fiber.dispose();
  });

  it("omits only models whose metadata cannot resolve", async () => {
    const ctx = new Context();
    ctx.provide("settings", {
      writable: true,
      describe: () => [],
    } as never);
    ctx.provide("llm", {
      listConfigurableProviders: () => [{
        provider: "openai",
        displayName: "OpenAI",
        settingsNs: "llm-pi-ai",
        settingsPath: ["providers", "openai"],
      }],
      listProviders: () => [{ id: "openai", name: "OpenAI" }],
      listModels: async () => [
        { provider: "openai", id: "usable", name: undefined },
        { provider: "openai", id: "broken", name: "Broken" },
      ],
      resolveModelInfo: async (_provider: string, model: string) => {
        if (model === "broken") {
          throw new Error("model metadata leaked fixture-secret");
        }
        return {
          provider: "openai",
          id: model,
          name: model,
          context: { contextWindow: 128_000 },
        };
      },
    } as never);

    const view = await buildModelsView(ctx);

    expect(view.providers[0]?.catalog).toEqual({ kind: "ready" });
    expect(view.providers[0]?.models).toEqual([{
      id: "usable",
      label: "usable",
      contextWindow: 128_000,
    }]);
    expect(JSON.stringify(view)).not.toContain("fixture-secret");
    await ctx.fiber.dispose();
  });

  it("renders the pi-ai builtin directory a real install exposes", async () => {
    const ctx = new Context();
    // `llm.listConfigurableProviders()` returns the pi-ai builtin catalog plus
    // declared routes; a stock install already exceeded the former cap of 24.
    const directory = [
      ...PI_AI_BUILTIN_PROVIDERS,
      "nvidia-inference-hub",
      "h200",
    ];
    ctx.provide("settings", { writable: true, describe: () => [] } as never);
    ctx.provide("llm", {
      listConfigurableProviders: () => directory.map((provider) => ({
        provider,
        displayName: provider,
        settingsNs: "llm-pi-ai",
        settingsPath: ["providers", provider],
      })),
      listProviders: () => [],
    } as never);

    const view = await buildModelsView(ctx);

    expect(view.providers).toHaveLength(directory.length);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "models",
      view,
    })).toBe(true);
    await ctx.fiber.dispose();
  });

  it("fails closed above the configurable provider cap", async () => {
    const providerEntries = (count: number) => Array.from(
      { length: count },
      (_, index) => ({
        provider: `provider-${index}`,
        displayName: `Provider ${index}`,
        settingsNs: "llm-pi-ai",
        settingsPath: ["providers", `provider-${index}`],
      }),
    );
    const contextFor = (count: number) => {
      const ctx = new Context();
      ctx.provide("settings", { writable: true, describe: () => [] } as never);
      ctx.provide("llm", {
        listConfigurableProviders: () => providerEntries(count),
        listProviders: () => [],
      } as never);
      return ctx;
    };

    const overflow = contextFor(MAX_PROVIDERS + 1);
    await expect(buildModelsView(overflow)).rejects.toThrow(
      `supports at most ${MAX_PROVIDERS} configurable providers`,
    );
    await overflow.fiber.dispose();

    const atCap = contextFor(MAX_PROVIDERS);
    await expect(buildModelsView(atCap)).resolves.toEqual(
      expect.objectContaining({ section: "models" }),
    );
    await atCap.fiber.dispose();
  });

  it("truncates an oversized catalog instead of reporting it unavailable", async () => {
    const ctx = new Context();
    ctx.provide("settings", { writable: true, describe: () => [] } as never);
    ctx.provide("llm", {
      listConfigurableProviders: () => [{
        provider: "openrouter",
        displayName: "OpenRouter",
        settingsNs: "llm-pi-ai",
        settingsPath: ["providers", "openrouter"],
      }],
      listProviders: () => [{ id: "openrouter", name: "OpenRouter" }],
      listModels: async () => Array.from(
        { length: MAX_MODELS_PER_PROVIDER + 3 },
        (_, index) => ({
          provider: "openrouter",
          id: `model-${index}`,
          name: `Model ${index}`,
        }),
      ),
      resolveModelInfo: async (provider: string, model: string) => ({
        provider,
        id: model,
        name: model,
      }),
    } as never);

    const view = await buildModelsView(ctx);

    expect(view.providers[0]?.catalog).toEqual({ kind: "ready" });
    expect(view.providers[0]?.models).toHaveLength(MAX_MODELS_PER_PROVIDER);
    expect(view.providers[0]?.models[0]?.id).toBe("model-0");
    expect(view.providers[0]?.models.at(-1)?.id).toBe(
      `model-${MAX_MODELS_PER_PROVIDER - 1}`,
    );
    await ctx.fiber.dispose();
  });
});

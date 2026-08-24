import { Context } from "@deepseek-ai/cordis";
import {
  isOutboundMessage,
  MAX_WIRE_URL_LENGTH,
  type WebSearchCatalogWire,
} from "@dsh-vscode/contract";
import { describe, expect, it, vi } from "vitest";
import type {
  WebSearchCatalogLike,
  WebSearchManagementService,
} from "./optional-services.js";
import {
  applyWebSearchConfig,
  buildWebSearchView,
  catalogFromWire,
  catalogToWire,
} from "./web-search.js";

const catalog: WebSearchCatalogLike = {
  engine: "brave",
  engines: {
    tavily: { baseURL: "https://tavily.example" },
    brave: { baseURL: "https://api.search.brave.com" },
    searxng: { baseURL: "https://searxng.example" },
  },
};

function mountService(
  ctx: Context,
  overrides: Partial<WebSearchManagementService> = {},
): WebSearchManagementService {
  const service: WebSearchManagementService = {
    getCatalog: () => catalog,
    putCatalog: async (candidate) => candidate,
    describeSecrets: async () => ({
      TAVILY_API_KEY: { configured: true },
      BRAVE_API_KEY: { configured: false },
    }),
    putSecrets: async () => {},
    available: () => true,
    onChanged: () => () => {},
    ...overrides,
  };
  ctx.provide("webSearchManager", service as never);
  return service;
}

describe("Web Search settings adapter", () => {
  it("projects the fixed engine directory and value-free secret state", async () => {
    const ctx = new Context();
    mountService(ctx);

    await expect(buildWebSearchView(ctx)).resolves.toEqual({
      section: "web-search",
      engine: "brave",
      engines: [
        {
          engine: "tavily",
          baseURL: "https://tavily.example",
          defaultBaseURL: "https://api.tavily.com",
          baseURLRequired: false,
          secretRef: "TAVILY_API_KEY",
        },
        {
          engine: "brave",
          defaultBaseURL: "https://api.search.brave.com",
          baseURLRequired: false,
          secretRef: "BRAVE_API_KEY",
        },
        {
          engine: "searxng",
          baseURL: "https://searxng.example",
          baseURLRequired: true,
        },
      ],
      secrets: [
        { ref: "TAVILY_API_KEY", configured: true, writable: true },
        { ref: "BRAVE_API_KEY", configured: false, writable: true },
      ],
      available: true,
    });
    await ctx.fiber.dispose();
  });

  it("reports an absent service as unavailable", async () => {
    const ctx = new Context();

    await expect(buildWebSearchView(ctx)).rejects.toThrow(
      "web-search management service is not available",
    );
    await ctx.fiber.dispose();
  });

  it("rejects an over-cap projected base URL with an explicit field error", async () => {
    const ctx = new Context();
    mountService(ctx, {
      getCatalog: () => ({
        engine: "searxng",
        engines: {
          searxng: { baseURL: "x".repeat(MAX_WIRE_URL_LENGTH + 1) },
        },
      }),
    });

    await expect(buildWebSearchView(ctx)).rejects.toThrow(
      `Web Search catalog engines.searxng.baseURL exceeds ${MAX_WIRE_URL_LENGTH} characters`,
    );
    await ctx.fiber.dispose();
  });

  it("rejects an unknown selected engine with an explicit catalog error", async () => {
    const ctx = new Context();
    mountService(ctx, {
      getCatalog: () => ({
        engine: "unknown" as never,
        engines: {},
      }),
    });

    await expect(buildWebSearchView(ctx)).rejects.toThrow(
      'Web Search catalog engine "unknown" is not supported',
    );
    await ctx.fiber.dispose();
  });

  it("writes catalog before secrets and refreshes through a fresh probe", async () => {
    const ctx = new Context();
    const order: string[] = [];
    let current = catalog;
    mountService(ctx, {
      getCatalog: () => {
        order.push("getCatalog");
        return current;
      },
      putCatalog: async (candidate) => {
        order.push("putCatalog");
        current = candidate;
        return candidate;
      },
      putSecrets: async () => {
        order.push("putSecrets");
      },
      describeSecrets: async () => {
        order.push("describeSecrets");
        return {
          TAVILY_API_KEY: { configured: true },
          BRAVE_API_KEY: { configured: true },
        };
      },
      available: () => {
        order.push("available");
        return true;
      },
    });

    const result = await applyWebSearchConfig(
      ctx,
      {
        engine: "tavily",
        engines: [{ engine: "tavily", baseURL: "https://other.example" }],
      },
      [{ ref: "TAVILY_API_KEY", value: "fixture-secret" }],
    );

    expect(order).toEqual([
      "putCatalog",
      "putSecrets",
      "getCatalog",
      "describeSecrets",
      "available",
    ]);
    expect(result.secretFailures).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    await ctx.fiber.dispose();
  });

  it("aborts secrets when the catalog is rejected and bounds its message", async () => {
    const ctx = new Context();
    const putSecrets = vi.fn();
    mountService(ctx, {
      putCatalog: async () => {
        throw new Error("x".repeat(513));
      },
      putSecrets,
    });

    await expect(applyWebSearchConfig(
      ctx,
      { engine: null, engines: [] },
      [{ ref: "TAVILY_API_KEY", value: "fixture-secret" }],
    )).rejects.toThrow("x".repeat(512));
    expect(putSecrets).not.toHaveBeenCalled();
    await ctx.fiber.dispose();
  });

  it("reports generic per-ref failures after a bulk secret rejection", async () => {
    const ctx = new Context();
    const calls: Record<string, string>[] = [];
    mountService(ctx, {
      putSecrets: async (partial) => {
        calls.push(partial);
        throw new Error(`plugin echoed ${Object.values(partial).join(",")}`);
      },
    });

    const result = await applyWebSearchConfig(
      ctx,
      { engine: "brave", engines: [] },
      [
        { ref: "TAVILY_API_KEY", value: "tavily-literal" },
        { ref: "BRAVE_API_KEY", value: "brave-literal" },
      ],
    );

    expect(calls).toEqual([
      {
        TAVILY_API_KEY: "tavily-literal",
        BRAVE_API_KEY: "brave-literal",
      },
      { TAVILY_API_KEY: "tavily-literal" },
      { BRAVE_API_KEY: "brave-literal" },
    ]);
    expect(result.secretFailures).toEqual([
      { ref: "TAVILY_API_KEY", message: "Could not store TAVILY_API_KEY" },
      { ref: "BRAVE_API_KEY", message: "Could not store BRAVE_API_KEY" },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /tavily-literal|brave-literal|plugin echoed/,
    );
    expect(result.view.engine).toBe("brave");
    await ctx.fiber.dispose();
  });

  it("drops empty secret values and skips an empty write", async () => {
    const ctx = new Context();
    const putSecrets = vi.fn(async () => {});
    mountService(ctx, { putSecrets });

    await applyWebSearchConfig(
      ctx,
      { engine: null, engines: [] },
      [
        { ref: "TAVILY_API_KEY", value: "" },
        { ref: "BRAVE_API_KEY", value: "brave-literal" },
      ],
    );
    expect(putSecrets).toHaveBeenCalledWith({
      BRAVE_API_KEY: "brave-literal",
    });

    putSecrets.mockClear();
    await applyWebSearchConfig(ctx, { engine: null, engines: [] }, []);
    expect(putSecrets).not.toHaveBeenCalled();
    await ctx.fiber.dispose();
  });

  it.each([
    {
      engine: "searxng",
      engines: [
        { engine: "tavily", baseURL: "https://tavily.example" },
        { engine: "brave", baseURL: "https://brave.example" },
        { engine: "searxng", baseURL: "https://searxng.example" },
      ],
    },
    { engine: null, engines: [] },
  ] satisfies WebSearchCatalogWire[])(
    "round-trips the catalog wire projection",
    (wire) => {
      expect(catalogToWire(catalogFromWire(wire))).toEqual(wire);
    },
  );

  it("emits a maximal view accepted by the outbound validator", async () => {
    const ctx = new Context();
    const baseURL = "x".repeat(MAX_WIRE_URL_LENGTH);
    mountService(ctx, {
      getCatalog: () => ({
        engine: "searxng",
        engines: {
          tavily: { baseURL },
          brave: { baseURL },
          searxng: { baseURL },
        },
      }),
      describeSecrets: async () => ({
        TAVILY_API_KEY: { configured: true },
        BRAVE_API_KEY: { configured: true },
      }),
    });

    const view = await buildWebSearchView(ctx);

    expect(isOutboundMessage({
      kind: "settingsSection",
      requestId: "web-search",
      view,
    })).toBe(true);
    await ctx.fiber.dispose();
  });
});

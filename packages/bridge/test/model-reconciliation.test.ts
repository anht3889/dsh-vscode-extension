import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { startMockLlmServer } from "@deepseek-ai/dsh-llm-mock-server";
import type { MockLlmServer } from "@deepseek-ai/dsh-llm-mock-server";
import type { AgentDefaultModelConfig } from "@deepseek-ai/dsh-agent-default-model";
import type { ModelRef, OutboundMessage } from "@dsh-vscode/contract";
import type { Io } from "../src/io.js";
import { bootTree } from "./boot.js";
import { createRunner, startupSelection } from "../src/runner.js";

interface FakeModel {
  id: string;
  /** Reject `resolveModelInfo`, standing in for an unreachable route. */
  unresolvable?: boolean;
}

interface FakeProvider {
  id: string;
  /** Reject `listModels`, standing in for a route whose list cannot be read. */
  unreadable?: boolean;
  models?: FakeModel[];
}

interface Harness {
  ctx: Context;
  defaultModel: AgentDefaultModelConfig;
  saved: ModelRef[];
}

/**
 * A context whose `llm` service reports exactly `providers`, paired with a
 * default-model service that records what gets persisted. `startupSelection`
 * reads only these members, so a fake keeps each case to its one variable.
 */
async function harness(
  providers: FakeProvider[],
  current: ModelRef,
): Promise<Harness> {
  const ctx = new Context();
  const llm = {
    listProviders: () => providers.map((p) => ({ id: p.id, name: p.id })),
    listModels: (provider: string) => {
      const found = providers.find((p) => p.id === provider);
      if (found?.unreadable === true) {
        return Promise.reject(new Error(`${provider}: route unreachable`));
      }
      return Promise.resolve(
        (found?.models ?? []).map((m) => ({ provider, id: m.id, name: m.id })),
      );
    },
    resolveModelInfo: (provider: string, id: string) => {
      const found = providers
        .find((p) => p.id === provider)
        ?.models?.find((m) => m.id === id);
      if (found?.unresolvable === true) {
        return Promise.reject(new Error(`${provider}/${id}: unreachable`));
      }
      return Promise.resolve({ provider, id, context: { contextWindow: 1000 } });
    },
  };
  // The fake implements only the members `readCatalog` calls; a real LlmRuntime
  // needs a plugin tree and live routes to reproduce these failure states.
  await ctx.provide("llm", llm);

  const saved: ModelRef[] = [];
  const defaultModel = {
    currentSelection: () => current,
    saveSelection(next: ModelRef) {
      saved.push({ provider: next.provider, model: next.model });
      return Promise.resolve();
    },
  } as unknown as AgentDefaultModelConfig;

  return { ctx, defaultModel, saved };
}

function capture(messages: OutboundMessage[]): Io {
  return {
    send(msg) {
      messages.push(msg);
    },
    onCommand() {},
    onDisconnect() {},
    close() {},
  };
}

describe("startupSelection", () => {
  it("keeps a selection its provider still lists", async () => {
    const { ctx, defaultModel, saved } = await harness(
      [{ id: "h200", models: [{ id: "flash-0731" }] }],
      { provider: "h200", model: "flash-0731" },
    );

    await expect(startupSelection(ctx, defaultModel)).resolves.toEqual({
      provider: "h200",
      model: "flash-0731",
    });
    expect(saved).toEqual([]);
  });

  it("replaces a retired model with one from the same provider", async () => {
    const { ctx, defaultModel, saved } = await harness(
      [
        { id: "hub", models: [{ id: "opus" }] },
        { id: "h200", models: [{ id: "flash-0731" }] },
      ],
      { provider: "h200", model: "/localhome/models/retired" },
    );

    await expect(startupSelection(ctx, defaultModel)).resolves.toEqual({
      provider: "h200",
      model: "flash-0731",
    });
    expect(saved).toEqual([{ provider: "h200", model: "flash-0731" }]);
  });

  it("replaces a selection whose provider is gone", async () => {
    const { ctx, defaultModel, saved } = await harness(
      [{ id: "hub", models: [{ id: "opus" }, { id: "kimi" }] }],
      { provider: "retired-box", model: "flash" },
    );

    await expect(startupSelection(ctx, defaultModel)).resolves.toEqual({
      provider: "hub",
      model: "opus",
    });
    expect(saved).toEqual([{ provider: "hub", model: "opus" }]);
  });

  it("keeps a listed model that cannot be resolved right now", async () => {
    const { ctx, defaultModel, saved } = await harness(
      [
        { id: "h200", models: [{ id: "flash-0731", unresolvable: true }] },
        { id: "hub", models: [{ id: "opus" }] },
      ],
      { provider: "h200", model: "flash-0731" },
    );

    await expect(startupSelection(ctx, defaultModel)).resolves.toEqual({
      provider: "h200",
      model: "flash-0731",
    });
    expect(saved).toEqual([]);
  });

  it("keeps the selection when its provider's list cannot be read", async () => {
    const { ctx, defaultModel, saved } = await harness(
      [
        { id: "h200", unreadable: true },
        { id: "hub", models: [{ id: "opus" }] },
      ],
      { provider: "h200", model: "flash-0731" },
    );

    await expect(startupSelection(ctx, defaultModel)).resolves.toEqual({
      provider: "h200",
      model: "flash-0731",
    });
    expect(saved).toEqual([]);
  });

  it("keeps the selection when no provider offers a usable model", async () => {
    const { ctx, defaultModel, saved } = await harness([], {
      provider: "h200",
      model: "flash-0731",
    });

    await expect(startupSelection(ctx, defaultModel)).resolves.toEqual({
      provider: "h200",
      model: "flash-0731",
    });
    expect(saved).toEqual([]);
  });
});

describe("createRunner model catalog", () => {
  let mock: MockLlmServer;

  beforeAll(async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    mock = await startMockLlmServer({
      sequence: ["success"],
      repeatLast: true,
      successText: "hello from the mock",
    });
  });

  afterAll(async () => {
    await mock.close();
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("offers no model the provider stopped listing", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "/localhome/models/retired",
      catalogModels: ["mock-model"],
    });

    await createRunner(ctx, capture(messages));

    const hello = messages.find((m) => m.kind === "hello");
    expect(hello?.kind === "hello" ? hello.model?.model : undefined).toBe(
      "mock-model",
    );
    const ready = messages.find((m) => m.kind === "ready");
    expect(ready?.kind).toBe("ready");
    if (ready?.kind === "ready") {
      expect(ready.models.current).toEqual({
        provider: "deepseek-official",
        model: "mock-model",
      });
      expect(ready.models.models.map((m) => m.model)).toEqual(["mock-model"]);
    }
  }, 60_000);

  it("still offers the saved model when the provider lists it", async () => {
    const messages: OutboundMessage[] = [];
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
      catalogModels: ["mock-model", "mock-model-pro"],
    });

    await createRunner(ctx, capture(messages));

    const ready = messages.find((m) => m.kind === "ready");
    if (ready?.kind === "ready") {
      expect(ready.models.current.model).toBe("mock-model");
      expect(ready.models.models.map((m) => m.model)).toEqual([
        "mock-model",
        "mock-model-pro",
      ]);
    }
  }, 60_000);
});

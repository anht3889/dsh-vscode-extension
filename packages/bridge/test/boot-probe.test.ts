import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startMockLlmServer } from "@deepseek-ai/dsh-llm-mock-server";
import type { MockLlmServer } from "@deepseek-ai/dsh-llm-mock-server";
import { bootTree } from "./boot.js";

// The boot probe proves the composition is correct before we wire `runVscode`:
// `ctx.get("agents")` and `ctx.get("agentDefaultModel")` must both be present,
// and the default selection must resolve to the provider route our adapter
// registered (`deepseek-official`), pointing at a model the mock serves.
describe("boot probe", () => {
  let mock: MockLlmServer;

  beforeAll(async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    mock = await startMockLlmServer({
      sequence: ["success"],
      repeatLast: true,
      successText: "hello",
    });
  });

  afterAll(async () => {
    await mock.close();
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("mounts agents + agentDefaultModel and selects deepseek-official", async () => {
    const ctx = await bootTree({
      baseURL: mock.baseURL,
      provider: "deepseek-official",
      model: "mock-model",
    });

    const agents = ctx.get("agents");
    const defaultModel = ctx.get("agentDefaultModel");
    expect(agents).toBeDefined();
    expect(defaultModel).toBeDefined();

    const selection = defaultModel!.currentSelection();
    expect(selection.provider).toBe("deepseek-official");
    expect(selection.model).toBe("mock-model");
  });
});

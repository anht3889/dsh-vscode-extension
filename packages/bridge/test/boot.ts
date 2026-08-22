// Shared boot fixture: composes a minimal in-process Cordis tree that is just
// enough for `runVscode` to create an Agent and drive a turn against the
// mock LLM server. This mirrors the plugin set that `dsh-base`'s
// `cordis.patch.yml` inserts (timer / llm / session / agent /
// agent-default-model / agent-loop / system-prompt / tools / llm-deepseek),
// registered programmatically with their real default exports and config
// schemas instead of going through the yml loader.
import { Context } from "@deepseek-ai/cordis";
import timer from "@deepseek-ai/cordis-plugin-timer";
import LlmRuntime from "@deepseek-ai/dsh-llm";
import SessionStore from "@deepseek-ai/dsh-session";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import AgentDefaultModelConfig from "@deepseek-ai/dsh-agent-default-model";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { apply as applyDeepseekAdapter } from "@deepseek-ai/dsh-llm-deepseek";
import JsonlSessionPersistence from "@deepseek-ai/dsh-session-persistence-jsonl";

export interface BootOptions {
  baseURL: string;
  provider: string;
  model: string;
  persistenceRoot?: string;
}

/**
 * Boot the composed tree and return the root context. Callers must close the
 * mock server and dispose the tree themselves when finished.
 */
export async function bootTree(opts: BootOptions): Promise<Context> {
  const ctx = new Context();

  // Plugins that have no cross-plugin dependencies, mounted first.
  await ctx.plugin(timer);
  await ctx.plugin(SystemPrompt, { persona: "" });
  await ctx.plugin(SessionStore);
  if (opts.persistenceRoot !== undefined) {
    await ctx.plugin(JsonlSessionPersistence, {
      root: opts.persistenceRoot,
      compression: "none",
    });
  }

  // The LLM runtime (ctx.llm) before anything that registers adapters on it.
  await ctx.plugin(LlmRuntime);

  // Tool runtime depends on systemPrompt.
  await ctx.plugin(ToolRuntime);

  // The agent registry (ctx.agents) and the default-model service.
  await ctx.plugin(AgentRegistry);
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: opts.provider,
    model: opts.model,
  });

  // The agent loop registers the AgentFactory that `agents.create()` needs.
  await ctx.plugin(AgentLoop);

  // The DeepSeek adapter: registers the `deepseek-official` route at baseURL.
  ctx.plugin(
    { name: "llm-deepseek", inject: ["llm"], apply: applyDeepseekAdapter },
    {
      baseURL: opts.baseURL,
      apiKeyEnv: "DEEPSEEK_API_KEY",
      models: [{ id: opts.model, contextWindow: 128_000 }],
    },
  );

  return ctx;
}

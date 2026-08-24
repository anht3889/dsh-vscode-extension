// Shared boot fixture: composes a minimal in-process Cordis tree that is just
// enough for `runVscode` to create an Agent and drive a turn against the
// mock LLM server. This mirrors the plugin set that `dsh-base`'s
// `cordis.patch.yml` inserts (timer / llm / session / agent /
// agent-default-model / agent-loop / system-prompt / tools / llm-deepseek),
// plus the vscode profile's Host settings registrars and inventory, registered
// programmatically with their real exports and config schemas.
import { Context } from "@deepseek-ai/cordis";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import timer from "@deepseek-ai/cordis-plugin-timer";
import z from "@deepseek-ai/schemastery";
import LlmRuntime from "@deepseek-ai/dsh-llm";
import SessionStore from "@deepseek-ai/dsh-session";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import AgentDefaultModelConfig from "@deepseek-ai/dsh-agent-default-model";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { apply as applyDeepseekAdapter } from "@deepseek-ai/dsh-llm-deepseek";
import JsonlSessionPersistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import SettingsProvider, {
  settingsNamespace,
  type SettingsNamespace,
} from "@deepseek-ai/dsh-settings";
import CredentialProvider, {
  type CredentialInfo,
  type CredentialRef,
  type ResolvedCredential,
} from "@deepseek-ai/dsh-credentials";
/** Host registrar package names mounted through Loader in the vscode profile patch. */
export const HOST_REGISTRAR_PACKAGES = [
  "@deepseek-ai/dsh-agent-presets",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-theme",
  "@deepseek-ai/dsh-client-ui-conversation",
  "@deepseek-ai/dsh-host-plugin-inventory",
] as const;

class ProbeSettingsProvider extends SettingsProvider {
  readonly writable = true;

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve({});
  }

  protected persist(
    _namespace: SettingsNamespace,
    _section: Record<string, unknown>,
  ): Promise<void> {
    return Promise.resolve();
  }
}

class ProbeCredentialProvider extends CredentialProvider {
  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = process.env[String(ref)];
    return Promise.resolve(
      value === undefined || value.length === 0
        ? undefined
        : { value, source: "env" },
    );
  }

  describe(ref: CredentialRef): Promise<CredentialInfo> {
    const value = process.env[String(ref)];
    const configured = value !== undefined && value.length > 0;
    return Promise.resolve({
      configured,
      ...(configured ? { source: "env" } : {}),
      writable: !configured,
    });
  }

  set(_ref: CredentialRef, _value: string): Promise<void> {
    return Promise.resolve();
  }

  unset(_ref: CredentialRef): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Structural stand-in for an optional plugin service.
 * @param members - required member names the probe checks for.
 * @param omit - members to leave out so the probe reports `incomplete`.
 * @returns a record whose present members are inert functions.
 */
export function optionalServiceStub(
  members: readonly string[],
  omit: readonly string[] = [],
): Record<string, unknown> {
  const skipped = new Set(omit);
  return Object.fromEntries(
    members
      .filter((member) => !skipped.has(member))
      .map((member) => [member, () => {}]),
  );
}

export interface BootOptions {
  baseURL: string;
  provider: string;
  model: string;
  persistenceRoot?: string;
  /**
   * Model ids the DeepSeek adapter advertises. Defaults to `[model]`; pass a
   * list that omits `model` to reproduce a saved default that its provider no
   * longer advertises.
   */
  catalogModels?: string[];
}

/**
 * Boot the composed tree and return the root context. Callers must close the
 * mock server and dispose the tree themselves when finished.
 */
export async function bootTree(opts: BootOptions): Promise<Context> {
  const ctx = new Context();

  // Plugins that have no cross-plugin dependencies, mounted first.
  await ctx.plugin(Loader);
  await ctx.plugin(timer);
  await ctx.plugin(ProbeSettingsProvider);
  await ctx.plugin(ProbeCredentialProvider);
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

  // Host-only registrars from the vscode profile. The production base supplies
  // the permission service; this focused fixture registers only its namespace
  // because it intentionally omits the shell and approval service graph.
  ctx.get("settings")!.register(
    settingsNamespace("permission"),
    z.object({ defaultPreset: z.string() }),
  );
  // Host registrars from the vscode profile patch. Loader entries use the same
  // package names as `cordis.patch.yml` so `pluginInventory.list()` projects
  // authoritative entry records.
  await ctx.loader.create({
    name: HOST_REGISTRAR_PACKAGES[0],
    config: { default: "standard", roots: [], includeUserRoot: true },
  });
  await ctx.loader.create({ name: HOST_REGISTRAR_PACKAGES[1] });
  await ctx.loader.create({ name: HOST_REGISTRAR_PACKAGES[2] });
  await ctx.loader.create({ name: HOST_REGISTRAR_PACKAGES[3] });
  await ctx.loader.create({ name: HOST_REGISTRAR_PACKAGES[4] });
  await ctx.loader.await();

  // The DeepSeek adapter: registers the `deepseek-official` route at baseURL.
  await ctx.plugin(
    { name: "llm-deepseek", inject: ["llm"], apply: applyDeepseekAdapter },
    {
      baseURL: opts.baseURL,
      apiKeyEnv: "DEEPSEEK_API_KEY",
      models: (opts.catalogModels ?? [opts.model]).map((id) => ({
        id,
        contextWindow: 128_000,
      })),
    },
  );

  return ctx;
}

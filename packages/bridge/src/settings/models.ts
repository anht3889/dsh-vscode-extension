import type { Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import type { LlmConfigurableProvider } from "@deepseek-ai/dsh-llm";
import type { SettingsDescriptor } from "@deepseek-ai/dsh-settings";
import type {
  CredentialStateWire,
  ModelProviderSettingsWire,
  ModelsSettingsView,
} from "@dsh-vscode/contract";
import { projectNamespace } from "./project.js";
import { projectSchemaFields } from "./schema.js";

const MAX_PROVIDERS = 24;
const MAX_MODELS_PER_PROVIDER = 24;
const MAX_VIEW_NODES = 3_000;
const MAX_VIEW_DEPTH = 20;
const EDITABLE_PROFILE_FIELDS = [
  { name: "apiKeyEnv", label: "API key reference" },
  { name: "displayName", label: "Display name" },
  { name: "api", label: "API" },
  { name: "baseURL", label: "Base URL" },
] as const;

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function valueAt(root: unknown, path: readonly string[]): unknown {
  let value = root;
  for (const segment of path) {
    value = recordOf(value)?.[segment];
  }
  return value;
}

function hasPath(root: unknown, path: readonly string[]): boolean {
  if (path.length === 0) return recordOf(root) !== undefined;
  let value = root;
  for (const segment of path) {
    const record = recordOf(value);
    if (record === undefined || !Object.hasOwn(record, segment)) return false;
    value = record[segment];
  }
  return true;
}

function profileStrings(
  descriptor: SettingsDescriptor | undefined,
  path: readonly string[],
): { api?: string; baseURL?: string; ref?: string } {
  const profile = recordOf(valueAt(descriptor?.value, path));
  if (profile === undefined) return {};
  return {
    ...(typeof profile.api === "string" ? { api: profile.api } : {}),
    ...(typeof profile.baseURL === "string" ? { baseURL: profile.baseURL } : {}),
    ...(typeof profile.apiKeyEnv === "string" ? { ref: profile.apiKeyEnv } : {}),
  };
}

async function catalogFor(
  ctx: Context,
  provider: string,
  active: ReadonlySet<string>,
): Promise<Pick<ModelProviderSettingsWire, "catalog" | "models">> {
  if (!active.has(provider)) {
    return { catalog: { kind: "dormant" }, models: [] };
  }
  try {
    const listed = await ctx.llm.listModels(provider);
    if (listed.length > MAX_MODELS_PER_PROVIDER) {
      throw new Error(`provider "${provider}" exceeds the Models catalog limit`);
    }
    const resolved = await Promise.all(listed.map(async (model) => {
      try {
        const info = await ctx.llm.resolveModelInfo(provider, model.id);
        return {
          id: model.id,
          label: model.name ?? model.id,
          ...(info.context?.contextWindow === undefined
            ? {}
            : { contextWindow: info.context.contextWindow }),
        };
      } catch {
        return undefined;
      }
    }));
    const models = resolved.filter(
      (model): model is Exclude<typeof model, undefined> => model !== undefined,
    );
    return { catalog: { kind: "ready" }, models };
  } catch {
    return {
      catalog: {
        kind: "failed",
        message: "Model catalog is unavailable",
      },
      models: [],
    };
  }
}

function assertBounded(value: unknown): void {
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_VIEW_NODES || depth > MAX_VIEW_DEPTH) {
      throw new Error("Models settings view exceeds bridge projection limits");
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    const record = recordOf(candidate);
    if (record === undefined) return;
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(value, 0);
}

/** Build a bounded Models view without resolving or serializing credential values. */
export async function buildModelsView(ctx: Context): Promise<ModelsSettingsView> {
  const settings = ctx.get("settings");
  const llm = ctx.get("llm");
  if (settings === undefined || llm === undefined) {
    throw new Error("Models settings require settings and llm services");
  }
  const directory = llm.listConfigurableProviders();
  if (directory.length > MAX_PROVIDERS) {
    throw new Error(`Models settings supports at most ${MAX_PROVIDERS} configurable providers`);
  }
  const descriptors = settings.describe({ redactSecrets: true });
  const descriptorByNamespace = new Map(
    descriptors.map((descriptor) => [String(descriptor.ns), descriptor]),
  );
  const active = new Set(llm.listProviders().map((provider) => provider.id));
  const profiles = directory.map((entry) => ({
    entry,
    descriptor: descriptorByNamespace.get(entry.settingsNs),
    values: profileStrings(
      descriptorByNamespace.get(entry.settingsNs),
      entry.settingsPath,
    ),
  }));
  const refs = [...new Set(profiles.flatMap(({ values }) => (
    values.ref === undefined ? [] : [values.ref]
  )))];
  const credentials = ctx.get("credentials");
  const credentialStates = new Map<string, CredentialStateWire>();
  const credentialFailures = new Set<string>();
  if (credentials !== undefined) {
    await Promise.all(refs.map(async (ref) => {
      try {
        const info = await credentials.describe(credentialRef(ref));
        credentialStates.set(ref, {
          ref,
          set: info.configured,
          ...(info.source === undefined ? {} : { source: info.source }),
          writable: info.writable,
        });
      } catch {
        credentialFailures.add(ref);
      }
    }));
  } else {
    for (const ref of refs) credentialFailures.add(ref);
  }
  const providers = await Promise.all(profiles.map(async ({
    entry,
    descriptor,
    values,
  }): Promise<ModelProviderSettingsWire> => {
    const activeProvider = active.has(entry.provider);
    const catalog = await catalogFor(ctx, entry.provider, active);
    const credential = values.ref === undefined
      ? undefined
      : credentialStates.get(values.ref);
    return {
      id: entry.provider,
      namespace: entry.settingsNs,
      label: entry.displayName,
      active: activeProvider,
      ...(entry.declared === undefined ? {} : { declared: entry.declared }),
      ...catalog,
      ...(values.api === undefined ? {} : { api: values.api }),
      ...(values.baseURL === undefined ? {} : { baseURL: values.baseURL }),
      ...(credential === undefined ? {} : { credential: { ...credential } }),
      credentialStatus: values.ref === undefined
        ? { kind: "none" }
        : credentialFailures.has(values.ref)
          ? {
              kind: "failed",
              message: "Credential metadata is unavailable",
            }
          : { kind: "ready" },
      removable: descriptor !== undefined
        && entry.settingsPath.length > 0
        && hasPath(descriptor.user, entry.settingsPath)
        && !hasPath(descriptor.base, entry.settingsPath),
      fields: descriptor === undefined
        ? []
        : projectSchemaFields(
            descriptor,
            entry.settingsPath,
            EDITABLE_PROFILE_FIELDS,
          ),
    };
  }));
  const namespaces = [...new Set(
    directory.map((entry) => entry.settingsNs),
  )].flatMap((namespace) => {
    const descriptor = descriptorByNamespace.get(namespace);
    return descriptor === undefined
      ? []
      : [projectNamespace(descriptor, settings.writable)];
  });
  const view: ModelsSettingsView = {
    section: "models",
    namespaces,
    providers,
    credentials: [...credentialStates.values()],
  };
  assertBounded(view);
  return view;
}

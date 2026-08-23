import type { Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import type { PluginInventoryEntry } from "@deepseek-ai/dsh-host-plugin-inventory";
import type { SettingsDescriptor } from "@deepseek-ai/dsh-settings";
import type {
  ConfigurablePluginWire,
  CredentialStateWire,
  PluginsSettingsView,
} from "@dsh-vscode/contract";
import { projectNamespace } from "./project.js";
import { projectSchemaFields } from "./schema.js";

/**
 * Loader inventory entries one Plugins view may project before it fails closed.
 * `@deepseek-ai/dsh-base` alone composes 79 entries and the bridge patch plus
 * user bundles add more, so this leaves room for several times a stock install.
 */
export const MAX_INVENTORY_ENTRIES = 512;
/**
 * Aggregate node ceiling for one emitted Plugins view: the inventory cap at
 * 5 nodes per record plus the three configurable-card namespaces at their
 * projection ceiling.
 */
export const MAX_VIEW_NODES = 16_384;
/**
 * Depth ceiling for one emitted Plugins view. A namespace layer sits three
 * levels below the view root and may itself nest to the projection depth.
 */
const MAX_VIEW_DEPTH = 24;
const DEFAULT_WEB_SEARCH_CREDENTIAL = "DEEPSEEK_API_KEY";

const CARDS = [
  {
    namespace: "shell",
    label: "Shell",
    fields: [
      { name: "timeoutMs", label: "Command timeout" },
      { name: "maxOutputBytes", label: "Maximum output bytes" },
    ],
  },
  {
    namespace: "agent-loop",
    label: "Agent Loop",
    fields: [{
      name: "maxParallelToolCalls",
      label: "Maximum parallel tool calls",
    }],
  },
  {
    namespace: "web-search-deepseek",
    label: "Web Search",
    fields: [
      { name: "baseURL", label: "Base URL" },
      { name: "maxUses", label: "Maximum uses" },
    ],
  },
] as const;

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function assertBounded(value: unknown): void {
  let nodes = 0;
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_VIEW_NODES || depth > MAX_VIEW_DEPTH) {
      throw new Error("Plugins settings view exceeds bridge projection limits");
    }
    if (typeof candidate !== "object" || candidate === null) return;
    if (seen.has(candidate)) {
      throw new Error("Plugins settings view contains a cycle");
    }
    seen.add(candidate);
    for (const child of Array.isArray(candidate)
      ? candidate
      : Object.values(candidate)) {
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
}

async function webSearchCredential(
  ctx: Context,
  descriptor: SettingsDescriptor,
): Promise<Pick<ConfigurablePluginWire, "credential" | "credentialStatus">> {
  const configuredRef = recordOf(descriptor.value)?.apiKeyEnv;
  const ref = typeof configuredRef === "string" && configuredRef.length > 0
    ? configuredRef
    : DEFAULT_WEB_SEARCH_CREDENTIAL;
  const credentials = ctx.get("credentials");
  if (credentials === undefined) {
    return {
      credentialStatus: {
        kind: "failed",
        message: "Credential metadata is unavailable",
      },
    };
  }
  try {
    const info = await credentials.describe(credentialRef(ref));
    const credential: CredentialStateWire = {
      ref,
      set: info.configured,
      ...(info.source === undefined ? {} : { source: info.source }),
      writable: info.writable,
    };
    return { credential, credentialStatus: { kind: "ready" } };
  } catch {
    return {
      credentialStatus: {
        kind: "failed",
        message: "Credential metadata is unavailable",
      },
    };
  }
}

/** Build specialized mounted plugin cards and the closed Loader inventory projection. */
export async function buildPluginsView(ctx: Context): Promise<PluginsSettingsView> {
  const settings = ctx.get("settings");
  const pluginInventory = ctx.get("pluginInventory");
  if (settings === undefined || pluginInventory === undefined) {
    throw new Error("Plugins settings require settings and plugin inventory services");
  }
  const descriptors = settings.describe({ redactSecrets: true });
  const descriptorByNamespace = new Map(
    descriptors.map((descriptor) => [String(descriptor.ns), descriptor]),
  );
  const mounted = CARDS.flatMap((card) => {
    const descriptor = descriptorByNamespace.get(card.namespace);
    return descriptor === undefined ? [] : [{ card, descriptor }];
  });
  const configurable = await Promise.all(mounted.map(async ({
    card,
    descriptor,
  }): Promise<ConfigurablePluginWire> => ({
    namespace: card.namespace,
    label: card.label,
    fields: projectSchemaFields(descriptor, [], card.fields),
    ...(card.namespace === "web-search-deepseek"
      ? await webSearchCredential(ctx, descriptor)
      : {}),
  })));
  const snapshot = pluginInventory.list();
  if (snapshot.entries.length > MAX_INVENTORY_ENTRIES) {
    throw new Error(
      `Plugins settings supports at most ${MAX_INVENTORY_ENTRIES} inventory entries`,
    );
  }
  const inventory = snapshot.entries.map((entry: PluginInventoryEntry) => ({
    entryId: String(entry.entryId),
    moduleName: entry.moduleName,
    enabled: entry.enabled,
    fiberPhase: entry.fiberPhase,
  }));
  const view: PluginsSettingsView = {
    section: "plugins",
    namespaces: mounted.map(({ descriptor }) => (
      projectNamespace(descriptor, settings.writable)
    )),
    configurable,
    inventory,
  };
  assertBounded(view);
  return view;
}

import type { Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import {
  settingsNamespace,
  type SettingsNamespace,
} from "@deepseek-ai/dsh-settings";
import {
  type OutboundMessage,
  type SettingsErrorWire,
  type SettingsSectionId,
} from "@dsh-vscode/contract";
import { buildGeneralView } from "./general.js";
import { GENERAL_NAMESPACES } from "./general-namespaces.js";
import { buildModelsView } from "./models.js";
import { resolveSettingsTarget } from "./paths.js";
import { buildPluginsView } from "./plugins.js";
import {
  buildAgentPresetsView,
  copyAgentPreset,
  deleteAgentPreset,
  readAgentPreset,
} from "./presets.js";
import { projectNamespace, projectSettingsError } from "./project.js";
import type { SettingsCoordinator } from "./types.js";

const PLUGIN_NAMESPACES = new Set([
  "shell",
  "agent-loop",
  "web-search-deepseek",
]);

function sectionForNamespace(namespace: string): SettingsSectionId | undefined {
  if (GENERAL_NAMESPACES.some((candidate) => candidate === namespace)) {
    return "general";
  }
  if (PLUGIN_NAMESPACES.has(namespace)) return "plugins";
  if (namespace.startsWith("llm-")) return "models";
  return undefined;
}

function unavailable(label: string): SettingsErrorWire {
  return {
    code: "settings-unavailable",
    message: `${label} settings are not available`,
  };
}

function unavailableForNamespace(namespace: string): SettingsErrorWire {
  const section = sectionForNamespace(namespace);
  const label = section === "general"
    ? "General"
    : section === "models"
    ? "Models"
    : section === "plugins"
    ? "Plugins"
    : section === "agent-presets"
    ? "Agent Presets"
    : undefined;
  return {
    code: "settings-unavailable",
    message: label === undefined
      ? `Settings namespace "${namespace}" is not available`
      : `${label} settings are not available`,
    namespace,
  };
}

function pathRequestKey(
  message: Parameters<SettingsCoordinator["resolvePath"]>[0],
): string {
  return `path:${message.requestId}`;
}

/** Create the one process-lifetime settings request and invalidation owner. */
export function createSettingsCoordinator(
  ctx: Context,
  send: (message: OutboundMessage) => void,
  refreshModelsCatalog: (signal: AbortSignal) => void = () => {},
): SettingsCoordinator {
  let generation = 0;
  let active = true;
  const catalogRefreshAbort = new AbortController();
  const latest = new Map<string, number>();
  const sectionMutationCounts = new Map<SettingsSectionId, number>();
  const pendingInvalidations = new Map<
    SettingsSectionId,
    {
      reason: "document" | "credentials" | "models" | "plugins" | "presets";
      refreshCatalog: boolean;
    }
  >();

  const begin = (key: string): { generation: number; request: number } => {
    const request = (latest.get(key) ?? 0) + 1;
    latest.set(key, request);
    return { generation, request };
  };
  const isCurrent = (
    key: string,
    token: { generation: number; request: number },
  ): boolean => (
    active
    && token.generation === generation
    && latest.get(key) === token.request
  );
  const sendCurrent = (
    key: string,
    token: { generation: number; request: number },
    message: OutboundMessage,
  ): void => {
    if (isCurrent(key, token)) send(message);
  };

  const sendInvalidation = (
    section: SettingsSectionId,
    reason: "document" | "credentials" | "models" | "plugins" | "presets",
    refreshCatalog: boolean,
  ): void => {
    if (!active) return;
    send({
      kind: "settingsInvalidated",
      sections: [section],
      reason,
    });
    if (refreshCatalog) refreshModelsCatalog(catalogRefreshAbort.signal);
  };
  const invalidate = (
    section: SettingsSectionId,
    reason: "document" | "credentials" | "models" | "plugins" | "presets",
    refreshCatalog = false,
  ): void => {
    if ((sectionMutationCounts.get(section) ?? 0) > 0) {
      pendingInvalidations.set(section, { reason, refreshCatalog });
      return;
    }
    sendInvalidation(section, reason, refreshCatalog);
  };
  const beginSectionMutation = (section: SettingsSectionId | undefined): void => {
    if (section === undefined) return;
    sectionMutationCounts.set(
      section,
      (sectionMutationCounts.get(section) ?? 0) + 1,
    );
  };
  const finishSectionMutation = (section: SettingsSectionId | undefined): void => {
    if (section === undefined) return;
    const remaining = (sectionMutationCounts.get(section) ?? 1) - 1;
    if (remaining === 0) sectionMutationCounts.delete(section);
    else sectionMutationCounts.set(section, remaining);
    if (remaining !== 0) return;
    const pending = pendingInvalidations.get(section);
    if (pending === undefined) return;
    pendingInvalidations.delete(section);
    sendInvalidation(section, pending.reason, pending.refreshCatalog);
  };
  const disposeDocumentListener = ctx.on(
    "settings/document-updated",
    (namespace: SettingsNamespace) => {
      const section = sectionForNamespace(String(namespace));
      if (section === undefined) return;
      const refreshCatalog = section === "models"
        && ctx.get("settings")?.describe({ redactSecrets: true }).some(
          (descriptor) => (
            descriptor.ns === namespace && descriptor.applies === "live"
          ),
        ) === true;
      invalidate(section, "document", refreshCatalog);
    },
  );
  const disposeCredentialListener = ctx.on("credentials/updated", () => {
    invalidate("models", "credentials", true);
    invalidate("plugins", "credentials");
  });
  const disposeLlmListener = ctx.on("llm/adapters-updated", () => {
    invalidate("models", "models", true);
  });

  const getSection: SettingsCoordinator["getSection"] = (requestId, section) => {
    const key = `section:${section}`;
    const token = begin(key);
    void (async () => {
      try {
        const view = section === "general"
          ? await buildGeneralView(ctx)
          : section === "models"
          ? await buildModelsView(ctx)
          : section === "plugins"
          ? await buildPluginsView(ctx)
          : await buildAgentPresetsView(ctx);
        sendCurrent(key, token, { kind: "settingsSection", requestId, view });
      } catch (error) {
        const label = section === "agent-presets"
          ? "Agent Presets"
          : section[0]!.toUpperCase() + section.slice(1);
        const requiredServiceMissing = section === "general"
          ? ctx.get("settings") === undefined
          : section === "models"
          ? ctx.get("settings") === undefined || ctx.get("llm") === undefined
          : section === "plugins"
          ? ctx.get("settings") === undefined
            || ctx.get("pluginInventory") === undefined
          : ctx.get("agentPresets") === undefined;
        sendCurrent(key, token, {
          kind: "settingsSection",
          requestId,
          error: requiredServiceMissing
            ? unavailable(label)
            : projectSettingsError(error),
        });
      }
    })();
  };

  const mutate: SettingsCoordinator["mutate"] = (message) => {
    const key = `mutation:${message.namespace}`;
    const token = begin(key);
    void (async () => {
      const settings = ctx.get("settings");
      if (settings === undefined) {
        sendCurrent(key, token, {
          kind: "settingsMutation",
          requestId: message.requestId,
          result: {
            ok: false,
            error: unavailableForNamespace(message.namespace),
          },
        });
        return;
      }
      const namespace = settingsNamespace(message.namespace);
      const section = sectionForNamespace(message.namespace);
      const sections: (SettingsSectionId | undefined)[] =
        message.namespace === "agent-presets"
          ? ["general", "agent-presets"]
          : [section];
      for (const section of sections) beginSectionMutation(section);
      try {
        await settings.mutate(namespace, message.ops, message.expectedRevision);
        const descriptor = settings
          .describe({ redactSecrets: true })
          .find((item) => item.ns === namespace);
        if (descriptor === undefined) {
          throw new Error(`settings namespace "${message.namespace}" is not registered`);
        }
        const projected = projectNamespace(descriptor, settings.writable);
        sendCurrent(key, token, {
          kind: "settingsMutation",
          requestId: message.requestId,
          result: {
            ok: true,
            namespace: projected,
            restartRequired: projected.applies === "restart",
          },
        });
        if (section === "models" && projected.applies === "live") {
          invalidate("models", "models", true);
        }
        if (message.namespace === "agent-presets") {
          invalidate("agent-presets", "presets");
        }
      } catch (error) {
        const projectedError = projectSettingsError(error, message.namespace);
        sendCurrent(key, token, {
          kind: "settingsMutation",
          requestId: message.requestId,
          result: {
            ok: false,
            error: projectedError,
          },
        });
        if (projectedError.code === "settings-conflict") {
          for (const owning of sections) {
            if (owning !== undefined) invalidate(owning, "document");
          }
        }
      } finally {
        for (const section of sections) finishSectionMutation(section);
      }
    })();
  };

  const mutateCredential = (
    message: Parameters<SettingsCoordinator["setCredential"]>[0]
      | Parameters<SettingsCoordinator["unsetCredential"]>[0],
  ): void => {
    const key = `credential:${message.ref}`;
    const token = begin(key);
    beginSectionMutation("models");
    beginSectionMutation("plugins");
    void (async () => {
      try {
        const credentials = ctx.get("credentials");
        if (credentials === undefined) {
          throw unavailable("Credential storage");
        }
        const ref = credentialRef(message.ref);
        if (message.kind === "setCredential") {
          if (message.value.length === 0) {
            throw new TypeError(`credential "${message.ref}" cannot be empty`);
          }
          await credentials.set(ref, message.value);
        } else {
          await credentials.unset(ref);
        }
        sendCurrent(key, token, {
          kind: "settingsMutation",
          requestId: message.requestId,
          result: { ok: true },
        });
        invalidate("models", "credentials", true);
        invalidate("plugins", "credentials");
      } catch (error) {
        const unavailableError = (
          typeof error === "object"
          && error !== null
          && "code" in error
          && error.code === "settings-unavailable"
        ) ? error as SettingsErrorWire : undefined;
        sendCurrent(key, token, {
          kind: "settingsMutation",
          requestId: message.requestId,
          result: {
            ok: false,
            error: unavailableError ?? {
              code: "credentials-rejected",
              message: error instanceof Error ? error.message : String(error),
            },
          },
        });
      } finally {
        finishSectionMutation("models");
        finishSectionMutation("plugins");
      }
    })();
  };
  const setCredential: SettingsCoordinator["setCredential"] = (message) => {
    mutateCredential(message);
  };
  const unsetCredential: SettingsCoordinator["unsetCredential"] = (message) => {
    mutateCredential(message);
  };
  const mutatePresetRoster = (
    key: string,
    requestId: string,
    operation: () => Promise<void>,
  ): void => {
    const token = begin(key);
    beginSectionMutation("general");
    beginSectionMutation("agent-presets");
    void (async () => {
      try {
        if (ctx.get("agentPresets") === undefined) {
          throw unavailable("Agent Presets");
        }
        await operation();
        sendCurrent(key, token, {
          kind: "settingsMutation",
          requestId,
          result: { ok: true },
        });
        invalidate("general", "presets");
        invalidate("agent-presets", "presets");
      } catch (error) {
        const unavailableError = (
          typeof error === "object"
          && error !== null
          && "code" in error
          && error.code === "settings-unavailable"
        ) ? error as SettingsErrorWire : undefined;
        sendCurrent(key, token, {
          kind: "settingsMutation",
          requestId,
          result: {
            ok: false,
            error: unavailableError ?? {
              code: "preset-rejected",
              message: error instanceof Error ? error.message : String(error),
            },
          },
        });
      } finally {
        finishSectionMutation("general");
        finishSectionMutation("agent-presets");
      }
    })();
  };
  const copyPreset: SettingsCoordinator["copyPreset"] = (message) => {
    mutatePresetRoster(
      `preset-copy:${message.presetId}`,
      message.requestId,
      () => copyAgentPreset(
        ctx,
        message.fromPresetId,
        message.presetId,
        message.name,
      ),
    );
  };
  const deletePreset: SettingsCoordinator["deletePreset"] = (message) => {
    mutatePresetRoster(
      `preset-delete:${message.presetId}`,
      message.requestId,
      () => deleteAgentPreset(ctx, message.presetId),
    );
  };
  const readPreset: SettingsCoordinator["readPreset"] = (message) => {
    const key = `preset-read:${message.presetId}`;
    const token = begin(key);
    void (async () => {
      try {
        if (ctx.get("agentPresets") === undefined) {
          throw unavailable("Agent Presets");
        }
        const result = await readAgentPreset(ctx, message.presetId);
        sendCurrent(key, token, {
          kind: "agentPresetContent",
          requestId: message.requestId,
          result: { ok: true, ...result },
        });
      } catch (error) {
        const unavailableError = (
          typeof error === "object"
          && error !== null
          && "code" in error
          && error.code === "settings-unavailable"
        ) ? error as SettingsErrorWire : undefined;
        sendCurrent(key, token, {
          kind: "agentPresetContent",
          requestId: message.requestId,
          result: {
            ok: false,
            error: unavailableError ?? {
              code: "preset-rejected",
              message: error instanceof Error ? error.message : String(error),
            },
          },
        });
      }
    })();
  };
  const resolvePath: SettingsCoordinator["resolvePath"] = (message) => {
    const key = pathRequestKey(message);
    const token = begin(key);
    void (async () => {
      try {
        const result = await resolveSettingsTarget(ctx, message.target);
        sendCurrent(key, token, {
          kind: "settingsPath",
          requestId: message.requestId,
          result: { ok: true, ...result },
        });
      } catch (error) {
        sendCurrent(key, token, {
          kind: "settingsPath",
          requestId: message.requestId,
          result: {
            ok: false,
            error: {
              ...projectSettingsError(error),
              code: message.target.kind === "agent-preset"
                ? "preset-rejected"
                : "settings-rejected",
            },
          },
        });
      }
    })();
  };

  const dispose = (): void => {
    if (!active) return;
    active = false;
    catalogRefreshAbort.abort();
    generation += 1;
    latest.clear();
    pendingInvalidations.clear();
    disposeDocumentListener();
    disposeCredentialListener();
    disposeLlmListener();
  };

  return {
    getSection,
    mutate,
    setCredential,
    unsetCredential,
    copyPreset,
    deletePreset,
    readPreset,
    resolvePath,
    dispose,
  };
}

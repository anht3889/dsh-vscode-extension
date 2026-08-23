import type { Context } from "@deepseek-ai/cordis";
import type { AgentPreset } from "@deepseek-ai/dsh-agent-presets";
import type { GeneralSettingsView } from "@dsh-vscode/contract";
import { GENERAL_NAMESPACES } from "./general-namespaces.js";
import { projectNamespace } from "./project.js";

const MAX_GENERAL_CHOICES = 64;

/** Build the mounted, redacted settings and choice lists shown by General. */
export async function buildGeneralView(
  ctx: Context,
): Promise<GeneralSettingsView> {
  const settings = ctx.get("settings");
  if (settings === undefined) {
    throw new Error("settings service is not available");
  }
  const descriptors = settings.describe({ redactSecrets: true });
  const descriptorByNamespace = new Map(
    descriptors.map((descriptor) => [String(descriptor.ns), descriptor]),
  );
  const namespaces = GENERAL_NAMESPACES.flatMap((namespace) => {
    const descriptor = descriptorByNamespace.get(namespace);
    return descriptor === undefined
      ? []
      : [projectNamespace(descriptor, settings.writable)];
  });

  const agentPresets = ctx.get("agentPresets");
  const agentChoices = agentPresets === undefined
    ? []
    : (await agentPresets.list())
      .slice(0, MAX_GENERAL_CHOICES)
      .map((preset: AgentPreset) => ({
        id: preset.id,
        label: preset.name ?? preset.id,
        trust: preset.trust,
      }));

  const permissionPresets = ctx.get("permissionPresets");
  const permissionChoices = permissionPresets === undefined
    ? []
    : permissionPresets.names
      .slice(0, MAX_GENERAL_CHOICES)
      .map((id: string) => {
        const option = permissionPresets.optionOf(id);
        return {
          id,
          label: option.name,
          dangerous:
            permissionPresets.resolve(id).sandbox === "danger-full-access",
        };
      });

  return {
    section: "general",
    namespaces,
    agentPresets: agentChoices,
    permissionPresets: permissionChoices,
  };
}

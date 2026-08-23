import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent-presets";
import type { SettingsDescriptor } from "@deepseek-ai/dsh-settings";
import type {
  AgentPresetContentMessage,
  AgentPresetsSettingsView,
} from "@dsh-vscode/contract";
import { projectNamespace } from "./project.js";

const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;
/**
 * Agent presets one roster view may project before it fails closed. General
 * lists the same roster, so `MAX_GENERAL_CHOICES` matches this value.
 */
export const MAX_PRESETS = 256;
const MAX_PRESET_ID_LENGTH = 64;
const MAX_PRESET_NAME_LENGTH = 128;
const MAX_PRESET_CONTENT_BYTES = 256 * 1024;

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function presetService(ctx: Context) {
  const presets = ctx.get("agentPresets");
  if (presets === undefined) {
    throw new Error("Agent Presets settings require the agent presets service");
  }
  return presets;
}

function validatePresetId(value: string, label: string): void {
  if (
    value.length === 0
    || value.length > MAX_PRESET_ID_LENGTH
    || !PRESET_ID.test(value)
  ) {
    throw new Error(`${label} must be a kebab-case preset id`);
  }
}

function presetDescriptor(ctx: Context): SettingsDescriptor | undefined {
  return ctx.get("settings")
    ?.describe({ redactSecrets: true })
    .find((descriptor) => String(descriptor.ns) === "agent-presets");
}

/** Build the current unmemoized preset roster and optional default namespace. */
export async function buildAgentPresetsView(
  ctx: Context,
): Promise<AgentPresetsSettingsView> {
  const presets = presetService(ctx);
  const listed = await presets.list();
  if (listed.length > MAX_PRESETS) {
    throw new Error(`Agent Presets settings supports at most ${MAX_PRESETS} presets`);
  }
  const descriptor = presetDescriptor(ctx);
  return {
    section: "agent-presets",
    ...(descriptor === undefined || ctx.get("settings") === undefined
      ? {}
      : { namespace: projectNamespace(descriptor, ctx.get("settings")!.writable) }),
    presets: listed.map((preset) => ({
      id: preset.id,
      trust: preset.trust,
      ...(preset.name === undefined ? {} : { name: preset.name }),
      ...(preset.description === undefined
        ? {}
        : { description: preset.description }),
      ...(preset.broken === undefined ? {} : { broken: preset.broken }),
      removable: preset.trust === "user",
      openable: preset.trust === "user",
    })),
  };
}

/** Read one preset composition exactly as stored, with its authoritative trust. */
export async function readAgentPreset(
  ctx: Context,
  id: string,
): Promise<Extract<
  AgentPresetContentMessage["result"],
  { ok: true }
> extends infer Result
  ? Result extends { presetId: string; trust: "system" | "user"; content: string }
    ? Omit<Result, "ok">
    : never
  : never> {
  validatePresetId(id, "preset id");
  const presets = presetService(ctx);
  const preset = await presets.resolve(id);
  const content = await presets.read(preset.id);
  if (Buffer.byteLength(content, "utf8") > MAX_PRESET_CONTENT_BYTES) {
    throw new Error("agent preset content exceeds the bridge read limit");
  }
  return { presetId: preset.id, trust: preset.trust, content };
}

/** Copy one preset after validating every caller-controlled authoring field. */
export async function copyAgentPreset(
  ctx: Context,
  from: string,
  id: string,
  name: string,
): Promise<void> {
  validatePresetId(from, "source preset id");
  validatePresetId(id, "new preset id");
  const displayName = name.trim();
  if (
    displayName.length === 0
    || displayName.length > MAX_PRESET_NAME_LENGTH
  ) {
    throw new Error("display name must contain 1 to 128 characters");
  }
  const presets = presetService(ctx);
  const listed = await presets.list();
  if (listed.some((preset) => preset.id === id)) {
    throw new Error(`agent preset "${id}" already exists`);
  }
  if (listed.length >= MAX_PRESETS) {
    throw new Error(`Agent Presets settings supports at most ${MAX_PRESETS} presets`);
  }
  await presets.copy(from, id, displayName);
}

/** Delete a user preset while preserving a valid default selection. */
export async function deleteAgentPreset(ctx: Context, id: string): Promise<void> {
  validatePresetId(id, "preset id");
  const presets = presetService(ctx);
  const listed = await presets.list();
  const preset = listed.find((candidate) => candidate.id === id);
  if (preset === undefined) throw new Error(`agent preset "${id}" was not found`);
  if (preset.trust !== "user") {
    throw new Error(`cannot delete system preset "${id}"`);
  }
  const descriptor = presetDescriptor(ctx);
  const currentDefault = recordOf(descriptor?.value)?.default
    ?? presets.defaultId;
  if (currentDefault === id) {
    const fallback = recordOf(descriptor?.base)?.default;
    if (
      typeof fallback !== "string"
      || fallback === id
      || !listed.some((candidate) => candidate.id === fallback)
    ) {
      throw new Error(
        `select a replacement default before deleting preset "${id}"`,
      );
    }
  }
  await presets.remove(id);
}

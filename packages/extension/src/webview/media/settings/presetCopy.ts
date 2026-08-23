import type { SettingsLocale } from "./types.js";

/**
 * English display copy for DSH's bundled system presets.
 *
 * DSH ships `name` and `description` untranslated in preset.yml, so the
 * extension owns this English projection. User-authored presets and the
 * Chinese locale keep the DSH-provided text. Override is keyed on both
 * id and `trust === "system"` because preset ids are not unique across
 * trust roots.
 */
const SYSTEM_PRESET_COPY = {
  standard: {
    name: "Standard Mode",
    description:
      "A full-featured coding agent with file editing, shell, file and web search, skills, plan, goals, subagents, and workflows.",
  },
  code: {
    name: "PTC Mode",
    description:
      "Has all Standard Mode capabilities, and presents tools through the Code Mode SDK so the model can compose multi-step operations as one TypeScript program.",
  },
  minimal: {
    name: "Minimal Mode",
    description:
      "A two-tool coding agent with persistent bash and str_replace_editor only.",
  },
  cordis: {
    name: "Creation Mode",
    description:
      "For creating custom Agent presets: has all Standard Mode capabilities, plus runtime inspection, plugin experiments, and preset-authoring guidance.",
  },
} as const;

export interface PresetDisplayCopy {
  name?: string;
  description?: string;
}

/**
 * Resolve the displayed name and description for a preset.
 *
 * @param locale - settings locale
 * @param trust - preset trust root; only `"system"` is eligible for override
 * @param id - preset id; not unique across trust roots
 * @param upstream - DSH-provided copy; omitted fields stay omitted on passthrough
 * @returns English copy when `locale` is `en`, `trust` is `"system"`, and `id` is a known bundled preset; otherwise `upstream` unchanged
 */
export function resolvePresetDisplayCopy(
  locale: SettingsLocale,
  trust: "system" | "user",
  id: string,
  upstream: PresetDisplayCopy,
): PresetDisplayCopy {
  if (locale !== "en" || trust !== "system") return upstream;
  const copy = Object.hasOwn(SYSTEM_PRESET_COPY, id)
    ? SYSTEM_PRESET_COPY[id as keyof typeof SYSTEM_PRESET_COPY]
    : undefined;
  return copy ?? upstream;
}

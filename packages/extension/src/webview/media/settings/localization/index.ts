import { en } from "./en.js";
import { zh } from "./zh.js";
import type { SettingsLocale } from "../types.js";

export type SettingsCopyKey = keyof typeof en;

export function settingsText(
  locale: SettingsLocale,
  key: SettingsCopyKey,
): string {
  return locale === "zh" ? zh[key] : en[key];
}

export function formatSettingsText(
  locale: SettingsLocale,
  key: SettingsCopyKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return settingsText(locale, key).replace(
    /\{([^}]+)\}/g,
    (_match, name: string) => String(values[name] ?? `{${name}}`),
  );
}

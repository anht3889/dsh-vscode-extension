import type { SettingsLocale } from "./types.js";

/** Read only a closed locale tag from retained webview state. */
export function readRetainedLocale(state: unknown): SettingsLocale | undefined {
  if (typeof state !== "object" || state === null) return undefined;
  const locale = (state as { locale?: unknown }).locale;
  return locale === "en" || locale === "zh" ? locale : undefined;
}

/** Persist the last authoritative locale without any other settings data. */
export function retainedLocaleState(
  locale: SettingsLocale,
): { locale: SettingsLocale } {
  return { locale };
}

import React from "react";
import type { OptionalSettingsSectionId } from "@dsh-vscode/contract";
import { settingsText, type SettingsCopyKey } from "./localization/index.js";
import type {
  SettingsLocale,
  SettingsUiSectionId,
} from "./types.js";

const SECTIONS: readonly {
  id: SettingsUiSectionId;
  label: SettingsCopyKey;
  optional?: OptionalSettingsSectionId;
}[] = [
  { id: "general", label: "general" },
  { id: "models", label: "models" },
  { id: "plugins", label: "plugins" },
  { id: "mcp", label: "mcp", optional: "mcp" },
  { id: "web-search", label: "webSearch", optional: "web-search" },
  { id: "agent-presets", label: "agentPresets" },
  { id: "extension", label: "extension" },
];

interface SettingsNavProps {
  active: SettingsUiSectionId;
  capabilities: readonly OptionalSettingsSectionId[];
  locale: SettingsLocale;
  onSelect(section: SettingsUiSectionId): void;
}

export function SettingsNav({
  active,
  capabilities,
  locale,
  onSelect,
}: SettingsNavProps): JSX.Element {
  return (
    <nav
      className="dsh-settings-nav dsh-settings-nav-responsive"
      aria-label={settingsText(locale, "settingsSections")}
    >
      <div className="dsh-settings-nav-list">
        {SECTIONS.filter(
          (section) =>
            section.optional === undefined ||
            capabilities.includes(section.optional),
        ).map((section) => (
          <button
            className="dsh-settings-nav-item"
            type="button"
            key={section.id}
            aria-current={section.id === active ? "page" : undefined}
            onClick={() => onSelect(section.id)}
          >
            <span className="dsh-settings-nav-icon" aria-hidden="true">
              {section.id === "general"
                ? "⚙"
                : section.id === "models"
                ? "◫"
                : section.id === "plugins"
                ? "◇"
                : section.id === "mcp"
                ? "⇄"
                : section.id === "web-search"
                ? "⌕"
                : section.id === "agent-presets"
                ? "◎"
                : "▣"}
            </span>
            <span>{settingsText(locale, section.label)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

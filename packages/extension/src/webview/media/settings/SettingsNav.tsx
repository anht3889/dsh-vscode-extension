import React from "react";
import { settingsText, type SettingsCopyKey } from "./localization/index.js";
import type {
  SettingsLocale,
  SettingsUiSectionId,
} from "./types.js";

const SECTIONS: readonly {
  id: SettingsUiSectionId;
  label: SettingsCopyKey;
}[] = [
  { id: "general", label: "general" },
  { id: "models", label: "models" },
  { id: "plugins", label: "plugins" },
  { id: "agent-presets", label: "agentPresets" },
  { id: "extension", label: "extension" },
];

interface SettingsNavProps {
  active: SettingsUiSectionId;
  locale: SettingsLocale;
  onSelect(section: SettingsUiSectionId): void;
}

export function SettingsNav({
  active,
  locale,
  onSelect,
}: SettingsNavProps): JSX.Element {
  return (
    <nav
      className="dsh-settings-nav dsh-settings-nav-responsive"
      aria-label={settingsText(locale, "settingsSections")}
    >
      <div className="dsh-settings-nav-list">
        {SECTIONS.map((section) => (
          <button
            className="dsh-settings-nav-item"
            type="button"
            key={section.id}
            aria-current={section.id === active ? "page" : undefined}
            onClick={() => onSelect(section.id)}
          >
            <span className="dsh-settings-nav-icon" aria-hidden="true">
              {section.id === "general" ? "⚙" : section.id === "models" ? "◫" : section.id === "plugins" ? "◇" : section.id === "agent-presets" ? "◎" : "▣"}
            </span>
            <span>{settingsText(locale, section.label)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

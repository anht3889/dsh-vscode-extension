import React from "react";
import type { McpLogEntryWire } from "@dsh-vscode/contract";
import {
  settingsText,
  type SettingsCopyKey,
} from "../../localization/index.js";
import type { SettingsLocale } from "../../types.js";

const LEVEL_KEYS: Record<McpLogEntryWire["level"], SettingsCopyKey> = {
  info: "mcpLogInfo",
  warn: "mcpLogWarn",
  error: "mcpLogError",
};

/** Incremental MCP log rows in a bounded polite live region. */
export function McpLogView({
  locale,
  entries,
}: {
  locale: SettingsLocale;
  entries: McpLogEntryWire[];
}): JSX.Element {
  return (
    <div
      className="dsh-mcp-log"
      role="log"
      aria-live="polite"
      aria-label={settingsText(locale, "mcpLogs")}
    >
      {entries.length === 0 ? (
        <p className="dsh-settings-empty">
          {settingsText(locale, "mcpLogsEmpty")}
        </p>
      ) : entries.map((entry, index) => (
        <div className="dsh-mcp-log-row" key={`${entry.at}-${index}`}>
          <span className={`dsh-mcp-log-level dsh-mcp-log-level-${entry.level}`}>
            {settingsText(locale, LEVEL_KEYS[entry.level])}
          </span>
          <time>{entry.at}</time>
          <span>{entry.message}</span>
          {entry.detail === undefined ? null : <pre>{entry.detail}</pre>}
        </div>
      ))}
    </div>
  );
}

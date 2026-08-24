import React, {
  useEffect,
  useReducer,
  useRef,
} from "react";
import type { McpStatusWire } from "@dsh-vscode/contract";
import {
  formatSettingsText,
  settingsText,
} from "../../localization/index.js";
import type { SettingsLocale } from "../../types.js";
import { McpController, type McpSnapshot } from "./McpController.js";
import { McpSwitch } from "./McpSwitch.js";

/** Localized summary of one MCP connection status. */
export function statusText(locale: SettingsLocale, status: McpStatusWire): string {
  switch (status.state) {
    case "disconnected":
      return settingsText(locale, "mcpStatusDisconnected");
    case "connecting":
      return formatSettingsText(locale, "mcpStatusConnecting", {
        attempt: status.attempt,
      });
    case "connected":
      return formatSettingsText(locale, "mcpStatusConnected", {
        count: status.toolCount,
        at: status.connectedAt,
      });
    case "reconnecting":
      return formatSettingsText(locale, "mcpStatusReconnecting", {
        attempt: status.attempt,
        delay: status.nextDelayMs,
      });
    case "failed":
      return formatSettingsText(locale, "mcpStatusFailed", {
        error: status.error,
      });
  }
}

/** Selectable MCP server rows and their per-server operations. */
export function McpServerList({
  controller,
  locale,
}: {
  controller: McpController;
  locale: SettingsLocale;
  snapshot: McpSnapshot;
}): JSX.Element {
  const [, render] = useReducer((value: number) => value + 1, 0);
  useEffect(() => controller.subscribe(() => render()), [controller]);
  const snapshot = controller.snapshot();
  const addRef = useRef<HTMLButtonElement>(null);
  const editorOwner = snapshot.editor?.serverId ??
    (snapshot.editor?.mode === "create" ? "create" : undefined);
  const editorSaving = snapshot.secretRequest !== undefined ||
    (editorOwner !== undefined && snapshot.pending.includes(editorOwner));

  if (snapshot.servers.length === 0) {
    return (
      <div className="dsh-mcp-empty" role="status">
        <p>{settingsText(locale, "mcpEmpty")}</p>
        <button
          ref={addRef}
          type="button"
          disabled={editorSaving || !snapshot.connected}
          onClick={() => controller.openCreate()}
        >
          {settingsText(locale, "mcpAddServer")}
        </button>
      </div>
    );
  }

  return (
    <div
      className="dsh-mcp-server-list"
      role="list"
      aria-label={settingsText(locale, "mcpServers")}
    >
      <div className="dsh-mcp-list-heading">
        <h3>{settingsText(locale, "mcpServers")}</h3>
        <button
          ref={addRef}
          type="button"
          disabled={editorSaving || !snapshot.connected}
          onClick={() => controller.openCreate()}
        >
          {settingsText(locale, "mcpAddServer")}
        </button>
      </div>
      {snapshot.servers.map((item) => {
        const { server, status } = item;
        const busy = snapshot.pending.includes(server.id);
        const selected = snapshot.selectedServerId === server.id;
        const transport = settingsText(
          locale,
          server.transport === "stdio" ? "mcpTransportStdio" : "mcpTransportHttp",
        );
        const tools = formatSettingsText(locale, "mcpToolsCount", {
          count: item.toolCount,
        });
        return (
          <article
            id={`mcp-server-${server.id}`}
            className="dsh-mcp-server-row"
            role="listitem"
            aria-label={server.serverName}
            aria-current={selected ? "true" : undefined}
            aria-busy={busy}
            key={server.id}
          >
            <button
              className="dsh-mcp-server-select"
              type="button"
              onClick={() => controller.select(server.id)}
            >
              <strong>{server.serverName}</strong>
              <span>{`${transport} · ${statusText(locale, status)} · ${tools}`}</span>
            </button>
            <McpSwitch
              checked={server.enabled}
              label={settingsText(locale, "mcpEnabled")}
              disabled={busy || editorSaving || !snapshot.connected}
              onChange={(enabled) => controller.setEnabled(server.id, enabled)}
            />
          </article>
        );
      })}
    </div>
  );
}

import React, {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
} from "react";
import type { McpStatusWire } from "@dsh-vscode/contract";
import { SettingsConfirmation } from "../../SettingsConfirmation.js";
import {
  formatSettingsText,
  settingsText,
} from "../../localization/index.js";
import type { SettingsLocale } from "../../types.js";
import { McpController, type McpSnapshot } from "./McpController.js";

function statusText(locale: SettingsLocale, status: McpStatusWire): string {
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
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement>();
  const deleting = snapshot.confirmation?.kind === "delete";
  const confirmationServerId = deleting
    ? snapshot.confirmation?.serverId
    : undefined;
  const confirmationBusy = confirmationServerId !== undefined &&
    snapshot.pending.includes(confirmationServerId);
  const canConfirmDelete = confirmationServerId !== undefined &&
    snapshot.connected &&
    !confirmationBusy &&
    snapshot.servers.some((item) => item.server.id === confirmationServerId);
  const editorOwner = snapshot.editor?.serverId ??
    (snapshot.editor?.mode === "create" ? "create" : undefined);
  const editorSaving = snapshot.secretRequest !== undefined ||
    (editorOwner !== undefined && snapshot.pending.includes(editorOwner));

  const dismiss = useCallback((): void => {
    controller.cancelConfirmation();
    returnFocusRef.current?.focus();
  }, [controller]);

  const runDelete = (): void => {
    if (!canConfirmDelete) return;
    if (!controller.runConfirmed()) {
      cancelRef.current?.focus();
      return;
    }
    addRef.current?.focus();
  };

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
    <>
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
          const connected = status.state === "connected" ||
            status.state === "connecting" ||
            status.state === "reconnecting";
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
                <span>
                  {settingsText(
                    locale,
                    server.transport === "stdio"
                      ? "mcpTransportStdio"
                      : "mcpTransportHttp",
                  )}
                  {" · "}
                  {settingsText(locale, server.enabled ? "mcpEnabled" : "mcpDisabled")}
                </span>
              </button>
              <span
                className={`dsh-mcp-status dsh-mcp-status-${status.state}`}
                role="status"
                aria-live="polite"
              >
                {statusText(locale, status)}
              </span>
              <span className="dsh-settings-badge">
                {formatSettingsText(locale, "mcpToolsCount", {
                  count: item.toolCount,
                })}
              </span>
              <div className="dsh-mcp-row-actions">
                <button
                  type="button"
                  disabled={busy || !snapshot.connected}
                  aria-label={`${settingsText(locale, connected ? "mcpDisconnect" : "mcpConnect")} ${server.serverName}`}
                  onClick={() => connected
                    ? controller.disconnectServer(server.id)
                    : controller.connectServer(server.id)}
                >
                  {settingsText(locale, connected ? "mcpDisconnect" : "mcpConnect")}
                </button>
                <button
                  type="button"
                  disabled={busy || !snapshot.connected}
                  aria-label={`${settingsText(locale, server.enabled ? "mcpDisable" : "mcpEnable")} ${server.serverName}`}
                  onClick={() => controller.setEnabled(server.id, !server.enabled)}
                >
                  {settingsText(locale, server.enabled ? "mcpDisable" : "mcpEnable")}
                </button>
                <button
                  type="button"
                  disabled={busy || editorSaving || !snapshot.connected}
                  aria-label={`${settingsText(locale, "mcpEdit")} ${server.serverName}`}
                  onClick={() => controller.openEdit(server.id)}
                >
                  {settingsText(locale, "mcpEdit")}
                </button>
                <button
                  type="button"
                  disabled={busy || !snapshot.connected}
                  aria-label={`${settingsText(locale, "mcpDeleteServer")} ${server.serverName}`}
                  onClick={(event) => {
                    returnFocusRef.current = event.currentTarget;
                    controller.confirm("delete", server.id);
                  }}
                >
                  {settingsText(locale, "mcpDeleteServer")}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!deleting ? null : (
        <SettingsConfirmation
          labelledBy={titleId}
          initialRef={cancelRef}
          saving={confirmationBusy}
          onEscape={dismiss}
        >
          <h4 id={titleId}>{settingsText(locale, "mcpDeleteTitle")}</h4>
          <p>{settingsText(locale, "mcpDeleteDetail")}</p>
          <div className="dsh-settings-inline-actions">
            <button ref={cancelRef} type="button" onClick={dismiss}>
              {settingsText(locale, "cancel")}
            </button>
            <button
              type="button"
              disabled={!canConfirmDelete}
              onClick={runDelete}
            >
              {settingsText(locale, "mcpDeleteServer")}
            </button>
          </div>
        </SettingsConfirmation>
      )}
    </>
  );
}

import React, {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import { SettingsConfirmation } from "../../SettingsConfirmation.js";
import { SettingsNestedDialog } from "../../SettingsNestedDialog.js";
import { settingsText } from "../../localization/index.js";
import type { SettingsLocale } from "../../types.js";
import { McpController, type McpSnapshot } from "./McpController.js";
import { McpLogView } from "./McpLogView.js";
import { statusText } from "./McpServerList.js";
import { McpSwitch } from "./McpSwitch.js";

/** Selected MCP server tools, secret state, OAuth guidance, and logs. */
export function McpServerDetail({
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
  const detail = snapshot.detail;
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement>();
  const [logsVisible, setLogsVisible] = useState(false);
  const clearing = snapshot.confirmation?.kind === "clear-oauth";
  const deleting = snapshot.confirmation?.kind === "delete";
  const closeDetails = useCallback((): void => {
    controller.select(undefined);
  }, [controller]);
  const dismiss = useCallback((): void => {
    controller.cancelConfirmation();
    returnFocusRef.current?.focus();
  }, [controller]);

  if (detail === undefined) {
    return <div className="dsh-settings-loading">{settingsText(locale, "loading")}</div>;
  }

  const serverId = detail.server.id;
  const busy = snapshot.pending.includes(serverId);
  const canConfirmClear = clearing &&
    snapshot.confirmation?.serverId === serverId &&
    snapshot.connected &&
    !busy &&
    snapshot.servers.some((item) => item.server.id === serverId);
  const canConfirmDelete = deleting &&
    snapshot.confirmation?.serverId === serverId &&
    snapshot.connected &&
    !busy &&
    snapshot.servers.some((item) => item.server.id === serverId);

  const runConfirmed = (): void => {
    if (!canConfirmClear && !canConfirmDelete) return;
    if (!controller.runConfirmed()) {
      cancelRef.current?.focus();
      return;
    }
    detailHeadingRef.current?.focus();
  };

  return (
    <>
      <SettingsNestedDialog
        labelledBy={`${titleId}-title`}
        initialRef={detailHeadingRef}
        active={!clearing && !deleting}
        saving={busy}
        onEscape={closeDetails}
      >
        <section className="dsh-mcp-detail">
          <header className="dsh-mcp-detail-header">
            <div>
              <h3 id={`${titleId}-title`} ref={detailHeadingRef} tabIndex={-1}>
                {detail.server.serverName}
              </h3>
              <p className="dsh-mcp-detail-meta">
                {statusText(locale, detail.status)}
              </p>
            </div>
            <McpSwitch
              checked={detail.server.enabled}
              label={settingsText(locale, "mcpEnabled")}
              disabled={busy || !snapshot.connected}
              onChange={(enabled) => controller.setEnabled(serverId, enabled)}
            />
          </header>
          <div className="dsh-mcp-detail-body">
            <section aria-labelledby={`${titleId}-tools`}>
              <h4 id={`${titleId}-tools`}>{settingsText(locale, "mcpTools")}</h4>
              {detail.tools.length === 0 ? (
                <p className="dsh-settings-empty">
                  {settingsText(locale, "mcpNoTools")}
                </p>
              ) : (
                <ul className="dsh-mcp-tools">
                  {detail.tools.map((tool) => (
                    <li key={tool.name}>
                      <McpSwitch
                        checked={tool.enabled}
                        label={tool.name}
                        disabled={busy || !snapshot.connected}
                        onChange={(enabled) =>
                          controller.toggleTool(serverId, tool.name, enabled)}
                      />
                      <small>{tool.description}</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby={`${titleId}-secrets`}>
              <h4 id={`${titleId}-secrets`}>{settingsText(locale, "mcpSecrets")}</h4>
              {snapshot.secretStates === "unavailable" ||
                  detail.secrets.kind === "unknown" ? (
                <p className="dsh-settings-hint">
                  {settingsText(locale, "mcpSecretUnknown")}
                </p>
              ) : (
                <ul className="dsh-mcp-secrets">
                  {detail.secrets.secrets.map((secret) => (
                    <li key={secret.name}>
                      <code>{secret.name}</code>
                      <span>
                        {settingsText(
                          locale,
                          secret.configured
                            ? "mcpSecretConfigured"
                            : "mcpSecretNotConfigured",
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {detail.server.auth.kind !== "oauth" ||
                snapshot.oauthAuthorization === "available" ? null : (
              <div className="dsh-mcp-oauth-note">
                <p>{settingsText(locale, "mcpOAuthNote")}</p>
              </div>
            )}
            <button
              className="dsh-mcp-disclosure"
              type="button"
              aria-expanded={logsVisible}
              onClick={() => setLogsVisible((visible) => !visible)}
            >
              {settingsText(locale, "mcpLogs")}
            </button>
            {logsVisible ? <McpLogView locale={locale} entries={snapshot.logs} /> : null}
          </div>
          <footer className="dsh-mcp-detail-footer">
            <div className="dsh-settings-inline-actions">
              <button
                type="button"
                disabled={busy || !snapshot.connected}
                aria-label={`${settingsText(locale, "mcpEdit")} ${detail.server.serverName}`}
                onClick={() => controller.openEdit(serverId)}
              >
                {settingsText(locale, "mcpEdit")}
              </button>
              <button
                type="button"
                disabled={busy || !snapshot.connected}
                onClick={() => detail.status.state === "connected" ||
                    detail.status.state === "connecting" ||
                    detail.status.state === "reconnecting"
                  ? controller.disconnectServer(serverId)
                  : controller.connectServer(serverId)}
              >
                {settingsText(
                  locale,
                  detail.status.state === "connected" ||
                      detail.status.state === "connecting" ||
                      detail.status.state === "reconnecting"
                    ? "mcpDisconnect"
                    : "mcpConnect",
                )}
              </button>
              {detail.server.auth.kind !== "oauth" ||
                  snapshot.oauthAuthorization === "unavailable" ? null : (
                <button
                  type="button"
                  disabled={busy || !snapshot.connected || snapshot.authorizing}
                  onClick={() => controller.startOAuth()}
                >
                  {settingsText(
                    locale,
                    snapshot.authorizing
                      ? busy
                        ? "mcpAuthorizing"
                        : "mcpWaitingAuthorization"
                      : "mcpAuthorize",
                  )}
                </button>
              )}
              {detail.server.auth.kind !== "oauth" ? null : (
                <button
                  type="button"
                  disabled={busy || !snapshot.connected}
                  onClick={(event) => {
                    returnFocusRef.current = event.currentTarget;
                    controller.confirm("clear-oauth", serverId);
                  }}
                >
                  {settingsText(locale, "mcpClearOAuth")}
                </button>
              )}
              <button
                type="button"
                disabled={busy || !snapshot.connected}
                aria-label={`${settingsText(locale, "mcpDeleteServer")} ${detail.server.serverName}`}
                onClick={(event) => {
                  returnFocusRef.current = event.currentTarget;
                  controller.confirm("delete", serverId);
                }}
              >
                {settingsText(locale, "mcpDeleteServer")}
              </button>
            </div>
            <button type="button" onClick={closeDetails}>
              {settingsText(locale, "mcpDone")}
            </button>
          </footer>
        </section>
      </SettingsNestedDialog>
      {!clearing && !deleting ? null : (
        <SettingsConfirmation
          labelledBy={titleId}
          initialRef={cancelRef}
          saving={busy}
          onEscape={dismiss}
        >
          <h4 id={titleId}>
            {settingsText(locale, clearing ? "mcpClearOAuthTitle" : "mcpDeleteTitle")}
          </h4>
          <p>
            {settingsText(locale, clearing ? "mcpClearOAuthDetail" : "mcpDeleteDetail")}
          </p>
          <div className="dsh-settings-inline-actions">
            <button ref={cancelRef} type="button" onClick={dismiss}>
              {settingsText(locale, "cancel")}
            </button>
            <button
              type="button"
              disabled={!canConfirmClear && !canConfirmDelete}
              onClick={runConfirmed}
            >
              {settingsText(locale, clearing ? "mcpClearOAuth" : "mcpDeleteServer")}
            </button>
          </div>
        </SettingsConfirmation>
      )}
    </>
  );
}

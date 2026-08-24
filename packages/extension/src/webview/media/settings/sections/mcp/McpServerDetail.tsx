import React, {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
} from "react";
import { SettingsConfirmation } from "../../SettingsConfirmation.js";
import { settingsText } from "../../localization/index.js";
import type { SettingsLocale } from "../../types.js";
import { McpController, type McpSnapshot } from "./McpController.js";
import { McpLogView } from "./McpLogView.js";

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
  const clearing = snapshot.confirmation?.kind === "clear-oauth";
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

  const runClear = (): void => {
    if (!canConfirmClear) return;
    if (!controller.runConfirmed()) {
      cancelRef.current?.focus();
      return;
    }
    detailHeadingRef.current?.focus();
  };

  return (
    <>
      <section
        className="dsh-mcp-detail"
        role="region"
        aria-labelledby={`mcp-server-${serverId}`}
        aria-label={detail.server.serverName}
      >
        <h3 ref={detailHeadingRef} tabIndex={-1}>
          {detail.server.serverName}
        </h3>
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
                  <label>
                    <input
                      type="checkbox"
                      checked={tool.enabled}
                      disabled={busy || !snapshot.connected}
                      aria-busy={busy}
                      aria-label={tool.name}
                      onChange={(event) =>
                        controller.toggleTool(
                          serverId,
                          tool.name,
                          event.currentTarget.checked,
                        )}
                    />
                    <span>
                      <strong>{tool.name}</strong>
                      <small>{tool.description}</small>
                    </span>
                  </label>
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

        {detail.server.auth.kind !== "oauth" ? null : (
          <div className="dsh-mcp-oauth-note">
            <p>{settingsText(locale, "mcpOAuthNote")}</p>
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
          </div>
        )}

        <section aria-labelledby={`${titleId}-logs`}>
          <h4 id={`${titleId}-logs`}>{settingsText(locale, "mcpLogs")}</h4>
          <McpLogView locale={locale} entries={snapshot.logs} />
        </section>
      </section>
      {!clearing ? null : (
        <SettingsConfirmation
          labelledBy={titleId}
          initialRef={cancelRef}
          saving={busy}
          onEscape={dismiss}
        >
          <h4 id={titleId}>{settingsText(locale, "mcpClearOAuthTitle")}</h4>
          <p>{settingsText(locale, "mcpClearOAuthDetail")}</p>
          <div className="dsh-settings-inline-actions">
            <button ref={cancelRef} type="button" onClick={dismiss}>
              {settingsText(locale, "cancel")}
            </button>
            <button
              type="button"
              disabled={!canConfirmClear}
              onClick={runClear}
            >
              {settingsText(locale, "mcpClearOAuth")}
            </button>
          </div>
        </SettingsConfirmation>
      )}
    </>
  );
}

import React, { useEffect, useReducer } from "react";
import { settingsText } from "../../localization/index.js";
import type {
  SettingsLocale,
  SettingsSectionState,
} from "../../types.js";
import { McpController } from "./McpController.js";
import { McpServerDetail } from "./McpServerDetail.js";
import { McpServerEditor } from "./McpServerEditor.js";
import { McpServerList } from "./McpServerList.js";

/**
 * MCP settings section composed from controller-owned value-free state.
 *
 * `state` supplies availability, read status, and staleness only. The App owns
 * hydration: it routes every accepted section read into the controller, whose
 * list already includes locally applied operation results. Writing `state.view`
 * back on mount would restore a superseded list.
 */
export function McpSection({
  controller,
  locale,
  state,
  onConfirmationChange,
}: {
  controller: McpController;
  locale: SettingsLocale;
  state: SettingsSectionState;
  onConfirmationChange?: (open: boolean) => void;
}): JSX.Element {
  const [, render] = useReducer((value: number) => value + 1, 0);
  useEffect(() => controller.subscribe(() => render()), [controller]);
  const snapshot = controller.snapshot();
  const confirmationOpen = snapshot.confirmation !== undefined;
  useEffect(() => {
    onConfirmationChange?.(confirmationOpen);
    return () => onConfirmationChange?.(false);
  }, [confirmationOpen, onConfirmationChange]);

  if (!state.available) {
    return <p role="status">{settingsText(locale, "unavailable")}</p>;
  }
  if (state.status === "loading" && state.view === undefined) {
    return <p className="dsh-settings-loading">{settingsText(locale, "loading")}</p>;
  }
  if (state.status === "error" && state.view === undefined) {
    return (
      <div className="dsh-settings-error" role="alert">
        <p>{state.detail ?? settingsText(locale, "operationFailed")}</p>
        <button type="button" onClick={() => controller.poll()}>
          {settingsText(locale, "retry")}
        </button>
      </div>
    );
  }

  return (
    <section className="dsh-settings-mcp" aria-label={settingsText(locale, "mcp")}>
      <p className="dsh-settings-section-intro">
        {settingsText(locale, "mcpIntro")}
      </p>
      {state.stale ? (
        <p className="dsh-settings-loading">{settingsText(locale, "refreshing")}</p>
      ) : null}
      {snapshot.errorKey === undefined ? null : (
        <p className="dsh-settings-error" role="alert">
          {settingsText(locale, snapshot.errorKey)}
        </p>
      )}
      {snapshot.noticeKey === undefined ? null : (
        <p role="status">{settingsText(locale, snapshot.noticeKey)}</p>
      )}
      <div className="dsh-mcp-layout">
        <McpServerList
          controller={controller}
          locale={locale}
          snapshot={snapshot}
        />
        <div className="dsh-mcp-secondary">
          {snapshot.editor !== undefined ? (
            <McpServerEditor
              controller={controller}
              locale={locale}
              draft={snapshot.editor}
              secretStates={snapshot.secretStates}
            />
          ) : snapshot.selectedServerId !== undefined ? (
            <McpServerDetail
              controller={controller}
              locale={locale}
              snapshot={snapshot}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

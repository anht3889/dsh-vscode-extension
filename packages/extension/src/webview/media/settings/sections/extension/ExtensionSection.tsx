import React, { useEffect, useReducer } from "react";
import { settingsText } from "../../localization/index.js";
import type { SettingsLocale } from "../../types.js";
import { ExtensionController } from "./ExtensionController.js";

interface ExtensionSectionProps {
  controller: ExtensionController;
  locale: SettingsLocale;
  restartDisabled: boolean;
}

export function ExtensionSection({
  controller,
  locale,
  restartDisabled,
}: ExtensionSectionProps): JSX.Element {
  const [, render] = useReducer((value: number) => value + 1, 0);
  useEffect(() => controller.subscribe(() => render()), [controller]);
  useEffect(() => {
    controller.load();
  }, [controller]);
  const snapshot = controller.snapshot();
  const formPending =
    snapshot.status === "loading" || snapshot.status === "saving";
  const validation =
    snapshot.validation === "integer"
      ? settingsText(locale, "validationInteger")
      : snapshot.validation === "range"
        ? settingsText(locale, "validationTimeout")
        : undefined;

  return (
    <section
      className="dsh-settings-extension"
      aria-label={settingsText(locale, "extension")}
    >
      <div className="dsh-settings-row">
        <div className="dsh-settings-row-copy">
          <label htmlFor="extension-binary-path">
            {settingsText(locale, "extensionBinaryPath")}
          </label>
          <p>{settingsText(locale, "extensionBinaryPathHint")}</p>
        </div>
        <div className="dsh-settings-row-control">
          <input
            id="extension-binary-path"
            aria-label={settingsText(locale, "extensionBinaryPath")}
            type="text"
            value={snapshot.binaryPath}
            disabled={!snapshot.loaded || snapshot.status === "saving"}
            onChange={(event) => controller.setBinaryPath(event.target.value)}
          />
        </div>
      </div>
      <div className="dsh-settings-row">
        <div className="dsh-settings-row-copy">
          <label htmlFor="extension-handshake-timeout">
            {settingsText(locale, "extensionHandshakeTimeout")}
          </label>
          {validation === undefined ? null : <p role="alert">{validation}</p>}
        </div>
        <div className="dsh-settings-row-control">
          <input
            id="extension-handshake-timeout"
            aria-label={settingsText(locale, "extensionHandshakeTimeout")}
            type="number"
            min={1000}
            max={300000}
            step={1}
            value={snapshot.handshakeTimeoutInput}
            disabled={!snapshot.loaded || snapshot.status === "saving"}
            onChange={(event) =>
              controller.setHandshakeTimeout(event.target.value)
            }
          />
        </div>
      </div>
      {snapshot.error === undefined ? null : (
        <div role="alert">
          <span>{snapshot.error}</span>
          {snapshot.readError ? (
            <button type="button" onClick={() => controller.load()}>
              {settingsText(locale, "retry")}
            </button>
          ) : null}
        </div>
      )}
      <div
        className="dsh-settings-actions"
        data-testid="extension-native-actions"
        aria-busy={snapshot.nativeActionPending}
      >
        <button
          type="button"
          disabled={!snapshot.loaded || !snapshot.dirty || formPending}
          onClick={() => controller.save()}
        >
          {settingsText(locale, "save")}
        </button>
        <button
          type="button"
          disabled={formPending || snapshot.nativeActionPending}
          onClick={() => controller.openExtensionSettings()}
        >
          {settingsText(locale, "extensionOpenEditorSettings")}
        </button>
        <button
          type="button"
          disabled={formPending || snapshot.nativeActionPending}
          onClick={() => controller.openSettingsDocument()}
        >
          {settingsText(locale, "extensionOpenDocument")}
        </button>
        <button
          type="button"
          disabled={formPending || snapshot.nativeActionPending}
          onClick={() => controller.revealDshHome()}
        >
          {settingsText(locale, "extensionRevealHome")}
        </button>
        <button
          type="button"
          disabled={
            formPending ||
            snapshot.nativeActionPending ||
            snapshot.restartPending ||
            restartDisabled
          }
          onClick={() => controller.restart()}
        >
          {settingsText(locale, "restartDsh")}
        </button>
        {snapshot.nativeActionPending ? (
          <span role="status">
            {settingsText(locale, "extensionActionPending")}
          </span>
        ) : null}
      </div>
    </section>
  );
}

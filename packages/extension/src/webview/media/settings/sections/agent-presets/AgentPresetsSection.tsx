import React, {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
} from "react";
import type { AgentPresetsSettingsView } from "@dsh-vscode/contract";
import {
  formatSettingsText,
  settingsText,
} from "../../localization/index.js";
import type { SettingsLocale } from "../../types.js";
import { resolvePresetDisplayCopy } from "../../presetCopy.js";
import { SettingsConfirmation } from "../../SettingsConfirmation.js";
import { AgentPresetsController } from "./AgentPresetsController.js";
import { useNestedDialogFocus } from "./dialogFocus.js";
import { PresetViewer } from "./PresetViewer.js";

interface AgentPresetsSectionProps {
  controller: AgentPresetsController;
  view: AgentPresetsSettingsView;
  locale: SettingsLocale;
  onConfirmationChange?(active: boolean): void;
}

function displayedPresetName(
  locale: SettingsLocale,
  row: { id: string; trust: "system" | "user"; name?: string } | undefined,
  fallback: string,
): string {
  if (row === undefined) return fallback;
  return resolvePresetDisplayCopy(locale, row.trust, row.id, { name: row.name }).name
    ?? row.id;
}

export function AgentPresetsSection({
  controller,
  view,
  locale,
  onConfirmationChange,
}: AgentPresetsSectionProps): JSX.Element {
  const [, render] = useReducer((value: number) => value + 1, 0);
  const deleteTitleId = useId();
  const copyTitleId = useId();
  const copyDialogRef = useRef<HTMLDivElement>(null);
  const copyFirstRef = useRef<HTMLInputElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const copyReturnRef = useRef<HTMLButtonElement>();
  const deleteReturnRef = useRef<HTMLButtonElement>();
  const viewerReturnRef = useRef<HTMLButtonElement>();
  const dialogOpenRef = useRef({ copy: false, deletion: false, viewer: false });
  useEffect(() => controller.subscribe(() => render()), [controller]);
  useEffect(() => controller.updateView(view), [controller, view]);
  const snapshot = controller.snapshot();
  const copySource = snapshot.copy === undefined
    ? undefined
    : snapshot.rows.find((row) => row.id === snapshot.copy?.fromPresetId);
  const viewerRow = snapshot.viewer === undefined
    ? undefined
    : snapshot.rows.find((row) => row.id === snapshot.viewer?.presetId);
  const closeCopy = useCallback(() => controller.cancelCopy(), [controller]);
  const closeDelete = useCallback(() => controller.cancelDelete(), [controller]);
  const closeViewer = useCallback(() => controller.closeViewer(), [controller]);

  useEffect(() => {
    const previous = dialogOpenRef.current;
    const closedAll =
      snapshot.copy === undefined &&
      snapshot.deletion === undefined &&
      snapshot.viewer === undefined;
    if (closedAll) {
      if (previous.copy) copyReturnRef.current?.focus();
      else if (previous.deletion) deleteReturnRef.current?.focus();
      else if (previous.viewer) viewerReturnRef.current?.focus();
    }
    dialogOpenRef.current = {
      copy: snapshot.copy !== undefined,
      deletion: snapshot.deletion !== undefined,
      viewer: snapshot.viewer !== undefined,
    };
  }, [snapshot.copy, snapshot.deletion, snapshot.viewer]);

  useNestedDialogFocus(
    snapshot.copy !== undefined,
    copyDialogRef,
    copyFirstRef,
    snapshot.copy?.status === "saving",
    closeCopy,
  );
  useEffect(() => {
    onConfirmationChange?.(snapshot.deletion !== undefined);
    return () => onConfirmationChange?.(false);
  }, [onConfirmationChange, snapshot.deletion]);

  return (
    <section
      className="dsh-settings-presets"
      aria-label={settingsText(locale, "agentPresets")}
    >
      <p className="dsh-settings-section-intro">
        {settingsText(locale, "presetsIntro")}
      </p>
      {snapshot.error === undefined ? null : (
        <p role="alert">{snapshot.error}</p>
      )}
      {snapshot.defaultChange === undefined ? null : (
        <div className="dsh-settings-notice" role="status">
          {snapshot.defaultChange.error ?? settingsText(locale, "loading")}
          {snapshot.defaultChange.status === "conflict" ? (
            <span className="dsh-settings-inline-actions">
              <button
                type="button"
                disabled={!snapshot.defaultChange.retryable}
                onClick={() => controller.retryDefault()}
              >
                {settingsText(locale, "retry")}
              </button>
              <button type="button" onClick={() => controller.discardDefault()}>
                {settingsText(locale, "discard")}
              </button>
            </span>
          ) : null}
        </div>
      )}
      {snapshot.opening ? (
        <p aria-live="polite">{settingsText(locale, "presetsOpening")}</p>
      ) : null}
      {snapshot.rows.length === 0 ? (
        <p className="dsh-settings-empty">{settingsText(locale, "presetsEmpty")}</p>
      ) : (
        (["system", "user"] as const).map((trust) => {
          const rows = snapshot.rows.filter((row) => row.trust === trust);
          if (rows.length === 0) return null;
          return (
            <section className="dsh-preset-group" key={trust}>
              <h3>
                {settingsText(
                  locale,
                  trust === "system" ? "presetsBuiltInGroup" : "presetsUserGroup",
                )}
              </h3>
              <ul className="dsh-preset-cards">
                {rows.map((row) => {
                  const display = resolvePresetDisplayCopy(
                    locale,
                    row.trust,
                    row.id,
                    { name: row.name, description: row.description },
                  );
                  const name = display.name ?? row.id;
                  return (
                    <li className="dsh-preset-card" key={row.id}>
                      <button
                        type="button"
                        className="dsh-preset-main"
                        aria-pressed={row.isDefault}
                        aria-label={formatSettingsText(
                          locale,
                          "presetsSetDefault",
                          { name },
                        )}
                        disabled={
                          row.isDefault ||
                          row.broken !== undefined ||
                          !snapshot.writable
                        }
                        onClick={() => controller.makeDefault(row.id)}
                      >
                        <span className="dsh-preset-title">
                          <strong>{name}</strong>
                          <span>
                            {settingsText(
                              locale,
                              row.trust === "system" ? "presetsSystem" : "presetsUser",
                            )}
                          </span>
                          {row.isDefault ? (
                            <span>{settingsText(locale, "presetsDefault")}</span>
                          ) : null}
                        </span>
                        <span>
                          {display.description ?? settingsText(locale, "presetsNoDescription")}
                        </span>
                        {row.broken === undefined ? null : (
                          <span role="alert">
                            {settingsText(locale, "presetsBroken")}: {row.broken}
                          </span>
                        )}
                        <code>{row.id}</code>
                      </button>
                      <div className="dsh-preset-actions">
                        {row.trust === "system" ? (
                          <button
                            type="button"
                            disabled={row.broken !== undefined || !snapshot.connected}
                            aria-label={`${settingsText(locale, "presetsView")} ${name}`}
                            onClick={(event) => {
                              viewerReturnRef.current = event.currentTarget;
                              controller.view(row.id);
                            }}
                          >
                            {settingsText(locale, "presetsView")}
                          </button>
                        ) : row.openable ? (
                          <button
                            type="button"
                            disabled={!snapshot.connected || snapshot.opening}
                            aria-label={formatSettingsText(
                              locale,
                              "presetsOpen",
                              { name },
                            )}
                            onClick={() => controller.open(row.id)}
                          >
                            {settingsText(locale, "open")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={row.broken !== undefined || !snapshot.connected}
                          aria-label={formatSettingsText(
                            locale,
                            "presetsCopy",
                            { name },
                          )}
                          onClick={(event) => {
                            copyReturnRef.current = event.currentTarget;
                            controller.beginCopy(row.id);
                          }}
                        >
                          {settingsText(locale, "copy")}
                        </button>
                        {row.trust === "user" && row.removable ? (
                          <button
                            type="button"
                            disabled={!snapshot.connected}
                            aria-label={formatSettingsText(
                              locale,
                              "presetsDelete",
                              { name },
                            )}
                            onClick={(event) => {
                              deleteReturnRef.current = event.currentTarget;
                              controller.beginDelete(row.id);
                            }}
                          >
                            {settingsText(locale, "delete")}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
      {snapshot.copy === undefined ? null : (
        <div
          ref={copyDialogRef}
          className="dsh-settings-confirmation"
          role="dialog"
          aria-modal="true"
          aria-labelledby={copyTitleId}
        >
          <h4 id={copyTitleId}>
            {settingsText(locale, "presetsCopyTitle")} ·{" "}
            {displayedPresetName(locale, copySource, snapshot.copy.fromPresetId)}
          </h4>
          <p>{settingsText(locale, "presetsCopyIntro")}</p>
          <label>
            <span>{settingsText(locale, "presetsId")}</span>
            <input
              ref={copyFirstRef}
              value={snapshot.copy.id}
              spellCheck={false}
              onChange={(event) => controller.setCopyId(event.target.value)}
            />
          </label>
          {snapshot.copy.idError === undefined ? null : (
            <p role="alert">{settingsText(locale, snapshot.copy.idError)}</p>
          )}
          <label>
            <span>{settingsText(locale, "presetsName")}</span>
            <input
              value={snapshot.copy.name}
              spellCheck={false}
              onChange={(event) => controller.setCopyName(event.target.value)}
            />
          </label>
          {snapshot.copy.nameError === undefined ? null : (
            <p role="alert">{settingsText(locale, snapshot.copy.nameError)}</p>
          )}
          {snapshot.copy.error === undefined ? null : (
            <p role="alert">{snapshot.copy.error}</p>
          )}
          <button
            type="button"
            disabled={snapshot.copy.status === "saving"}
            onClick={() => controller.cancelCopy()}
          >
            {settingsText(locale, "cancel")}
          </button>
          <button
            type="button"
            disabled={
              snapshot.copy.status === "saving" ||
              snapshot.copy.id.trim() === "" ||
              snapshot.copy.name.trim() === "" ||
              snapshot.copy.idError !== undefined ||
              snapshot.copy.nameError !== undefined ||
              !snapshot.connected
            }
            onClick={() => controller.copy()}
          >
            {settingsText(
              locale,
              snapshot.copy.status === "saving"
                ? "presetsCreating"
                : "presetsCreate",
            )}
          </button>
        </div>
      )}
      {snapshot.deletion === undefined ? null : (
        <SettingsConfirmation
          labelledBy={deleteTitleId}
          initialRef={deleteCancelRef}
          saving={
            snapshot.deletion.status === "saving-default" ||
            snapshot.deletion.status === "deleting"
          }
          onEscape={closeDelete}
        >
          <h4 id={deleteTitleId}>{settingsText(locale, "presetsDeleteTitle")}</h4>
          <p>{settingsText(locale, "presetsDeleteDetail")}</p>
          {snapshot.deletion.fallbackRequired ? (
            <>
              <p>{settingsText(locale, "presetsDeleteFallbackDetail")}</p>
              <label>
                <span>{settingsText(locale, "presetsFallback")}</span>
                <select
                  value={snapshot.deletion.fallbackId}
                  onChange={(event) => controller.setDeleteFallback(event.target.value)}
                >
                  <option value="">{settingsText(locale, "presetsFallback")}</option>
                  {snapshot.deletion.fallbackOptions.map((row) => (
                    <option key={row.id} value={row.id}>
                      {displayedPresetName(locale, row, row.id)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          {snapshot.deletion.defaultChanged &&
          snapshot.deletion.status === "error" ? (
            <p role="alert">
              {settingsText(locale, "presetsDefaultChangedDeleteFailed")}
            </p>
          ) : null}
          {snapshot.deletion.error === undefined ? null : (
            <p role="alert">{snapshot.deletion.error}</p>
          )}
          {snapshot.deletion.status === "conflict" ? (
            <div className="dsh-settings-inline-actions">
              <button
                type="button"
                disabled={!snapshot.deletion.retryable}
                onClick={() => controller.retryDelete()}
              >
                {settingsText(locale, "retry")}
              </button>
              <button type="button" onClick={() => controller.cancelDelete()}>
                {settingsText(locale, "discard")}
              </button>
            </div>
          ) : null}
          <button
            ref={deleteCancelRef}
            type="button"
            disabled={
              snapshot.deletion.status === "saving-default" ||
              snapshot.deletion.status === "deleting"
            }
            onClick={() => controller.cancelDelete()}
          >
            {settingsText(locale, "cancel")}
          </button>
          <button
            type="button"
            disabled={
              !snapshot.connected ||
              snapshot.deletion.status === "saving-default" ||
              snapshot.deletion.status === "deleting" ||
              snapshot.deletion.status === "conflict" ||
              (snapshot.deletion.fallbackRequired &&
                snapshot.deletion.fallbackId === "")
            }
            onClick={() => controller.deletePreset()}
          >
            {settingsText(locale, "delete")}
          </button>
        </SettingsConfirmation>
      )}
      {snapshot.viewer === undefined ? null : (
        <PresetViewer
          locale={locale}
          viewer={snapshot.viewer}
          name={displayedPresetName(locale, viewerRow, snapshot.viewer.presetId)}
          onClose={closeViewer}
        />
      )}
    </section>
  );
}

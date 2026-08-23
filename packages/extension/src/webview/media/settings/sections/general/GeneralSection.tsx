import React, { useEffect, useReducer } from "react";
import type {
  GeneralSettingsView,
} from "@dsh-vscode/contract";
import { settingsText } from "../../localization/index.js";
import type { SettingsLocale } from "../../types.js";
import {
  GeneralController,
  type GeneralFieldId,
  type GeneralRowSnapshot,
} from "./GeneralController.js";

interface GeneralSectionProps {
  controller: GeneralController;
  view: GeneralSettingsView;
  locale: SettingsLocale;
  confirmFullAccess(): Promise<boolean>;
}

function label(locale: SettingsLocale, id: GeneralFieldId): string {
  switch (id) {
    case "agent-preset":
      return settingsText(locale, "generalDefaultPreset");
    case "permission":
      return settingsText(locale, "generalPermission");
    case "locale":
      return settingsText(locale, "generalLanguage");
    case "appearance":
      return settingsText(locale, "generalAppearance");
    case "busy-enter":
      return settingsText(locale, "generalBusyEnter");
  }
}

function options(
  locale: SettingsLocale,
  row: GeneralRowSnapshot,
  view: GeneralSettingsView,
): Array<{ value: string; label: string; dangerous?: boolean }> {
  switch (row.id) {
    case "agent-preset":
      return view.agentPresets.map((option) => ({
        value: option.id,
        label: option.label,
      }));
    case "permission":
      return view.permissionPresets.map((option) => ({
        value: option.id,
        label: option.label,
        dangerous: option.dangerous,
      }));
    case "locale":
      return [
        { value: "", label: settingsText(locale, "languageSystem") },
        { value: "en", label: settingsText(locale, "languageEnglish") },
        { value: "zh", label: settingsText(locale, "languageChinese") },
      ];
    case "appearance":
      return [
        { value: "system", label: settingsText(locale, "appearanceSystem") },
        { value: "light", label: settingsText(locale, "appearanceLight") },
        { value: "dark", label: settingsText(locale, "appearanceDark") },
      ];
    case "busy-enter":
      return [
        { value: "queue", label: settingsText(locale, "busyEnterQueue") },
        { value: "steer", label: settingsText(locale, "busyEnterSteer") },
      ];
  }
}

export function GeneralSection({
  controller,
  view,
  locale,
  confirmFullAccess,
}: GeneralSectionProps): JSX.Element {
  const [, render] = useReducer((value: number) => value + 1, 0);

  useEffect(() => controller.subscribe(() => render()), [controller]);
  useEffect(() => {
    controller.updateView(view);
  }, [controller, view]);
  const snapshot = controller.snapshot();
  return (
    <section className="dsh-settings-general" aria-label={settingsText(locale, "general")}>
      {snapshot.rows.map((row) => {
        const rowLabel = label(locale, row.id);
        const choices = options(locale, row, view);
        const raw = typeof row.value === "string" ? row.value : "";
        const unknownLocale =
          row.id === "locale" && raw !== "" && raw !== "en" && raw !== "zh";
        const current = row.id === "locale" && !unknownLocale && (raw === "" || !row.overridden)
          ? ""
          : raw;
        const known = choices.some((choice) => choice.value === current);
        return (
          <div
            className="dsh-settings-row"
            data-testid="general-row"
            data-row={row.id}
            key={row.id}
          >
            <div className="dsh-settings-row-copy">
              <label htmlFor={`general-${row.id}`}>{rowLabel}</label>
              {row.id === "appearance" ? (
                <p>{settingsText(locale, "editorThemeNote")}</p>
              ) : null}
              {row.id === "busy-enter" ? (
                <p>{settingsText(locale, "busyEnterDescription")}</p>
              ) : null}
              {unknownLocale ? (
                <p role="alert">
                  {settingsText(locale, "unknownLocale")}: {current}
                </p>
              ) : row.error === undefined ? null : (
                <p role="alert">{row.error}</p>
              )}
            </div>
            <div className="dsh-settings-row-control">
              <select
                id={`general-${row.id}`}
                aria-label={rowLabel}
                value={current}
                disabled={
                  !row.writable ||
                  row.status === "saving" ||
                  row.status === "conflict" ||
                  choices.length === 0 ||
                  unknownLocale
                }
                onChange={(event) => {
                  const value = event.target.value;
                  if (
                    row.id === "permission" &&
                    choices.find((choice) => choice.value === value)?.dangerous
                  ) {
                    void confirmFullAccess().then((confirmed) => {
                      if (confirmed) controller.select(row.id, value);
                    });
                    return;
                  }
                  controller.select(row.id, value);
                }}
              >
                {!known ? <option value={current}>{current}</option> : null}
                {choices.map((choice) => (
                  <option value={choice.value} key={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
              {!row.writable ? (
                <span>{settingsText(locale, "readOnly")}</span>
              ) : null}
              {row.overridden && row.status !== "conflict" ? (
                <button
                  type="button"
                  disabled={row.status === "saving"}
                  onClick={() => controller.reset(row.id)}
                >
                  {settingsText(locale, "reset")}
                </button>
              ) : null}
              {row.status === "conflict" ? (
                <>
                  <button
                    type="button"
                    disabled={!row.retryable}
                    onClick={() => controller.retry(row.id)}
                  >
                    {settingsText(locale, "retry")}
                  </button>
                  <button type="button" onClick={() => controller.discard(row.id)}>
                    {settingsText(locale, "discard")}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}

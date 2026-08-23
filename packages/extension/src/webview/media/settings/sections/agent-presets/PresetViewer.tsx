import React, { useId, useRef } from "react";
import { formatSettingsText, settingsText } from "../../localization/index.js";
import type { SettingsLocale } from "../../types.js";
import type { AgentPresetsSnapshot } from "./AgentPresetsController.js";
import { useNestedDialogFocus } from "./dialogFocus.js";

interface PresetViewerProps {
  locale: SettingsLocale;
  viewer: NonNullable<AgentPresetsSnapshot["viewer"]>;
  name: string;
  onClose(): void;
}

export function PresetViewer({
  locale,
  viewer,
  name,
  onClose,
}: PresetViewerProps): JSX.Element {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useNestedDialogFocus(true, dialogRef, closeRef, false, onClose);

  return (
    <div
      ref={dialogRef}
      className="dsh-settings-confirmation dsh-preset-viewer"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <h4 id={titleId}>
        {formatSettingsText(locale, "presetsViewerTitle", { name })}
      </h4>
      {viewer.status === "loading" ? (
        <p aria-live="polite">{settingsText(locale, "loading")}</p>
      ) : viewer.status === "error" ? (
        <p role="alert">{viewer.error}</p>
      ) : (
        <pre className="dsh-preset-content">{viewer.content}</pre>
      )}
      <button ref={closeRef} type="button" onClick={onClose}>
        {settingsText(locale, "closeSettings")}
      </button>
    </div>
  );
}

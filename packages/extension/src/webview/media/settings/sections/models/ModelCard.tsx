import React from "react";
import { formatSettingsText, settingsText } from "../../localization/index.js";
import type { SettingsLocale } from "../../types.js";

interface ModelCardProps {
  locale: SettingsLocale;
  index: number;
  disabled: boolean;
  onRemove(): void;
  children: React.ReactNode;
}

/**
 * One model entry of a provider's model list: an ordinal heading, its remove
 * control, and the caller's fields.
 *
 * @param locale - Locale for the heading and the remove control's name.
 * @param index - Zero-based position; presented one-based.
 * @param disabled - Whether removal is refused for this entry.
 * @param onRemove - Drops this entry from the list.
 * @param children - Field elements, normally {@link ModelField} wrappers.
 * @returns The card element.
 */
export function ModelCard({
  locale,
  index,
  disabled,
  onRemove,
  children,
}: ModelCardProps): JSX.Element {
  return (
    <div className="dsh-models-model-card">
      <div className="dsh-models-model-card-head">
        <span>
          {formatSettingsText(locale, "modelsModelOrdinal", {
            index: index + 1,
          })}
        </span>
        <button
          type="button"
          aria-label={`${settingsText(locale, "modelsRemoveModel")} ${index + 1}`}
          disabled={disabled}
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      {children}
    </div>
  );
}

interface ModelFieldProps {
  label: string;
  children: React.ReactNode;
}

/**
 * A visible caption above one model field's control.
 *
 * The control keeps its own `aria-label` carrying the entry ordinal, so its
 * accessible name stays unambiguous across a repeated list.
 *
 * @param label - Caption text.
 * @param children - The control this caption describes.
 * @returns The captioned field element.
 */
export function ModelField({ label, children }: ModelFieldProps): JSX.Element {
  return (
    <label className="dsh-models-model-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

import React from "react";
import type { SlashMenuItem } from "@dsh-vscode/contract";
import { slashItemKey, type SlashPickerState } from "../store.js";

interface SlashPickerProps {
  picker: SlashPickerState;
  onPick(item: SlashMenuItem): void;
}

/** Return the stable DOM id used by combobox active-descendant metadata. */
export function slashItemId(item: SlashMenuItem): string {
  return `dsh-slash-option-${item.source}-${encodeURIComponent(item.name)}`;
}

export function SlashPicker({
  picker,
  onPick,
}: SlashPickerProps): JSX.Element {
  const groups = picker.groups.filter((group) => group.items.length > 0);
  const hasRows = groups.length > 0;

  return (
    <div className="dsh-slash-picker">
      {hasRows && picker.availability?.commands === false ? (
        <div className="dsh-slash-diagnostic">Commands unavailable</div>
      ) : null}
      {hasRows && picker.availability?.skills === false ? (
        <div className="dsh-slash-diagnostic">Skills unavailable</div>
      ) : null}
      <div role="listbox" id="dsh-slash-listbox">
        {groups.map((group) => {
          const label = group.source === "command" ? "Commands" : "Skills";
          const labelId = `dsh-slash-group-${group.source}`;
          return (
            <div
              className="dsh-slash-group"
              key={group.source}
              role="group"
              aria-labelledby={labelId}
            >
              <div className="dsh-slash-group-title" id={labelId}>
                {label}
              </div>
              {group.items.map((item) => (
                <button
                  className="dsh-slash-option"
                  id={slashItemId(item)}
                  key={slashItemKey(item)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={slashItemKey(item) === picker.highlightedKey}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onPick(item);
                  }}
                >
                  <span className="dsh-slash-name">{`/${item.name}`}</span>
                  <span className="dsh-slash-description">{item.description}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

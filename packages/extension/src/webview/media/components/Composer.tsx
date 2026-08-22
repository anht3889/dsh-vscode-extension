import React, { useCallback, useRef } from "react";
import type {
  CatalogPayload,
  ContextPayload,
  FileReferenceItem,
  PermissionsPayload,
} from "@dsh-vscode/contract";
import {
  contextPercent,
  serializeDraft,
  type DraftChip,
  type PickerState,
} from "../store.js";
import { AttachmentPicker } from "./AttachmentPicker.js";
import { ChipRail } from "./ChipRail.js";

interface ComposerProps {
  ready: boolean;
  models: CatalogPayload | undefined;
  permissions: PermissionsPayload | undefined;
  context: ContextPayload | undefined;
  status: "idle" | "thinking" | "awaiting-approval" | "error";
  draft: string;
  chips: DraftChip[];
  picker: PickerState | undefined;
  submitPending: boolean;
  onDraftChange(text: string, selectionStart: number): void;
  onOpenPicker(selectionStart: number): void;
  onPickerQuery(query: string): void;
  onPickReference(item: FileReferenceItem): void;
  onDismissPicker(): void;
  onRemoveChip(id: string): void;
  onBrowseFolder(): void;
  onAttachImage(): void;
  focusPickerSearch: boolean;
  onSubmit(): void;
  onCancel(): void;
  onSelectModel(provider: string, model: string): void;
  onSelectPermission(preset: string): void;
  onRequestFullAccess(): void;
}

const MODEL_SEPARATOR = "\u0000";

function PlusIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function Composer({
  ready,
  models,
  permissions,
  context,
  status,
  draft,
  chips,
  picker,
  submitPending,
  onDraftChange,
  onOpenPicker,
  onPickerQuery,
  onPickReference,
  onDismissPicker,
  onRemoveChip,
  onBrowseFolder,
  onAttachImage,
  focusPickerSearch,
  onSubmit,
  onCancel,
  onSelectModel,
  onSelectPermission,
  onRequestFullAccess,
}: ComposerProps): JSX.Element {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const payload = serializeDraft({ draft, chips });
  const sendDisabled =
    !ready ||
    submitPending ||
    (payload.text === "" && payload.images === undefined);

  const send = useCallback((): void => {
    if (status === "thinking" || sendDisabled) return;
    onSubmit();
  }, [onSubmit, sendDisabled, status]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  const selectPermission = useCallback(
    (preset: string): void => {
      if (preset === "danger-full-access") {
        onRequestFullAccess();
        return;
      }
      onSelectPermission(preset);
    },
    [onRequestFullAccess, onSelectPermission],
  );

  const percent = contextPercent(context);
  const modelValue =
    models === undefined
      ? ""
      : `${models.current.provider}${MODEL_SEPARATOR}${models.current.model}`;

  return (
    <footer className="dsh-composer">
      {picker !== undefined ? (
        <AttachmentPicker
          query={picker.query}
          items={picker.items}
          unavailable={picker.unavailable}
          onQuery={onPickerQuery}
          onPick={onPickReference}
          onBrowseFolder={onBrowseFolder}
          onAttachImage={onAttachImage}
          onDismiss={onDismissPicker}
          autoFocus={focusPickerSearch}
        />
      ) : null}
      {chips.length > 0 ? (
        <ChipRail chips={chips} onRemove={onRemoveChip} />
      ) : null}
      <textarea
        ref={inputRef}
        className="dsh-composer-input"
        rows={3}
        value={draft}
        placeholder="Message DSH…"
        onChange={(e) =>
          onDraftChange(e.target.value, e.target.selectionStart)
        }
        onKeyDown={onKeyDown}
      />
      <div className="dsh-composer-toolbar">
        <div className="dsh-composer-selectors">
          <select
            className="dsh-select"
            aria-label="Permission"
            title="Permission"
            value={permissions?.current ?? ""}
            disabled={!ready || permissions === undefined}
            onChange={(event) => selectPermission(event.target.value)}
          >
            {permissions === undefined ? <option value="">Permission</option> : null}
            {permissions?.presets.map((preset) => (
              <option value={preset.id} key={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <select
            className="dsh-select"
            aria-label="Model"
            title="Model"
            value={modelValue}
            disabled={!ready || models === undefined}
            onChange={(event) => {
              const [provider, model] = event.target.value.split(MODEL_SEPARATOR);
              if (provider !== undefined && model !== undefined) {
                onSelectModel(provider, model);
              }
            }}
          >
            {models === undefined ? <option value="">Model</option> : null}
            {models?.models.map((model) => (
              <option
                value={`${model.provider}${MODEL_SEPARATOR}${model.model}`}
                key={`${model.provider}/${model.model}`}
              >
                {model.label} · {model.provider}
              </option>
            ))}
          </select>
        </div>
        <div className="dsh-composer-actions">
          <button
            className="dsh-icon-button"
            type="button"
            title="Attach"
            aria-label="Attach files, folders, or images"
            disabled={!ready}
            onClick={() => {
              inputRef.current?.focus();
              onOpenPicker(inputRef.current?.selectionStart ?? draft.length);
            }}
          >
            <PlusIcon />
          </button>
          {percent !== undefined && context !== undefined ? (
            <div
              className="dsh-context-meter"
              title={`${context.used.toLocaleString()} / ${context.window.toLocaleString()} tokens`}
              aria-label={`Context usage ${percent}%`}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle className="dsh-context-track" cx="10" cy="10" r="7" />
                <circle
                  className="dsh-context-value"
                  cx="10"
                  cy="10"
                  r="7"
                  pathLength="100"
                  strokeDasharray={`${percent} 100`}
                />
              </svg>
              <span>{percent}</span>
            </div>
          ) : null}
          <button
            className="dsh-composer-send"
            type="button"
            title={status === "thinking" ? "Stop" : "Send"}
            aria-label={status === "thinking" ? "Stop response" : "Send message"}
            onClick={status === "thinking" ? onCancel : send}
            disabled={status !== "thinking" && sendDisabled}
          >
            {status === "thinking" ? (
              <span className="dsh-stop-icon" aria-hidden="true" />
            ) : (
              <svg
                viewBox="0 0 16 16"
                width="16"
                height="16"
                aria-hidden="true"
              >
                <path d="M2 8.2 13.5 2.5 9.4 13.7 7.3 8.8 2 8.2Zm5.3.6 6.2-6.3" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </footer>
  );
}

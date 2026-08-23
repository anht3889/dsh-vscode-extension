import React, { useCallback, useEffect, useRef } from "react";
import type {
  CatalogPayload,
  ContextPayload,
  FileReferenceItem,
  PermissionsPayload,
  SlashMenuItem,
} from "@dsh-vscode/contract";
import {
  contextPercent,
  serializeDraft,
  slashItemKey,
  type CommandClaim,
  type DraftChip,
  type PickerState,
} from "../store.js";
import { AttachmentPicker } from "./AttachmentPicker.js";
import { ChipRail } from "./ChipRail.js";
import { SlashPicker, slashItemId } from "./SlashPicker.js";

interface ComposerProps {
  ready: boolean;
  models: CatalogPayload | undefined;
  permissions: PermissionsPayload | undefined;
  context: ContextPayload | undefined;
  status: "idle" | "thinking" | "awaiting-approval" | "error";
  draft: string;
  chips: DraftChip[];
  picker: PickerState | undefined;
  commandClaim: CommandClaim | undefined;
  submitPending: boolean;
  onDraftChange(text: string, selectionStart: number): void;
  onCaretChange(text: string, selectionStart: number): void;
  onOpenPicker(selectionStart: number): void;
  onPickerQuery(query: string): void;
  onPickReference(item: FileReferenceItem): void;
  onMoveSlashHighlight(delta: -1 | 1): void;
  onPickSlashItem(item: SlashMenuItem): number | undefined;
  onDismissPicker(): void;
  onRemoveChip(id: string): void;
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
  commandClaim,
  submitPending,
  onDraftChange,
  onCaretChange,
  onOpenPicker,
  onPickerQuery,
  onPickReference,
  onMoveSlashHighlight,
  onPickSlashItem,
  onDismissPicker,
  onRemoveChip,
  onAttachImage,
  focusPickerSearch,
  onSubmit,
  onCancel,
  onSelectModel,
  onSelectPermission,
  onRequestFullAccess,
}: ComposerProps): JSX.Element {
  const composerRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // A textarea the user has never interacted with reports selectionStart 0, so
  // reading it would insert `@` in front of an existing draft. Track the caret
  // the user actually placed and fall back to the end of the draft.
  const caretRef = useRef<number | undefined>(undefined);
  const payload = serializeDraft({ draft, chips, picker });
  const sendDisabled =
    !ready ||
    submitPending ||
    (payload.text === "" && payload.images === undefined);
  const slashPicker = picker?.kind === "slash" ? picker : undefined;
  const highlightedSlashItem = slashPicker?.groups
    .flatMap((group) => group.items)
    .find((item) => slashItemKey(item) === slashPicker.highlightedKey);

  useEffect(() => {
    if (slashPicker === undefined) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        composerRef.current?.contains(event.target) === false
      ) {
        onDismissPicker();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [onDismissPicker, slashPicker]);

  const pickSlashItem = useCallback(
    (item: SlashMenuItem): void => {
      const caret = onPickSlashItem(item);
      if (caret === undefined) return;
      queueMicrotask(() => {
        caretRef.current = caret;
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(caret, caret);
      });
    },
    [onPickSlashItem],
  );

  const send = useCallback((): void => {
    if (status === "thinking" || sendDisabled) return;
    onSubmit();
  }, [onSubmit, sendDisabled, status]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Enter" && e.shiftKey) return;
      if (slashPicker !== undefined) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          onMoveSlashHighlight(e.key === "ArrowDown" ? 1 : -1);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onDismissPicker();
          return;
        }
        if (e.key === "Enter" && highlightedSlashItem !== undefined) {
          e.preventDefault();
          pickSlashItem(highlightedSlashItem);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [
      highlightedSlashItem,
      onDismissPicker,
      onMoveSlashHighlight,
      pickSlashItem,
      send,
      slashPicker,
    ],
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
    <footer ref={composerRef} className="dsh-composer">
      {picker?.kind === "attachment" ? (
        <AttachmentPicker
          query={picker.query}
          items={picker.items}
          unavailable={picker.unavailable}
          onQuery={onPickerQuery}
          onPick={onPickReference}
          onAttachImage={onAttachImage}
          onDismiss={onDismissPicker}
          autoFocus={focusPickerSearch}
        />
      ) : null}
      {slashPicker !== undefined ? (
        <SlashPicker picker={slashPicker} onPick={pickSlashItem} />
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
        role={slashPicker === undefined ? undefined : "combobox"}
        aria-expanded={slashPicker === undefined ? undefined : true}
        aria-controls={
          slashPicker === undefined ? undefined : "dsh-slash-listbox"
        }
        aria-activedescendant={
          highlightedSlashItem === undefined
            ? undefined
            : slashItemId(highlightedSlashItem)
        }
        aria-describedby={
          commandClaim?.hint === undefined ? undefined : "dsh-command-claim-hint"
        }
        onChange={(e) => {
          caretRef.current = e.target.selectionStart;
          onDraftChange(e.target.value, e.target.selectionStart);
        }}
        onSelect={(e) => {
          caretRef.current = e.currentTarget.selectionStart;
          onCaretChange(e.currentTarget.value, e.currentTarget.selectionStart);
        }}
        onKeyDown={onKeyDown}
      />
      {commandClaim?.hint === undefined ? null : (
        <div className="dsh-command-claim-hint" id="dsh-command-claim-hint">
          {commandClaim.hint}
        </div>
      )}
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
              const caret = Math.min(
                caretRef.current ?? draft.length,
                draft.length,
              );
              inputRef.current?.focus();
              inputRef.current?.setSelectionRange(caret, caret);
              onOpenPicker(caret);
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

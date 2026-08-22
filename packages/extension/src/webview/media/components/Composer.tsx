import React, { useCallback, useState } from "react";
import type {
  CatalogPayload,
  ContextPayload,
  PermissionsPayload,
} from "@dsh-vscode/contract";
import { contextPercent } from "../store.js";

interface ComposerProps {
  ready: boolean;
  models: CatalogPayload | undefined;
  permissions: PermissionsPayload | undefined;
  context: ContextPayload | undefined;
  status: "idle" | "thinking" | "awaiting-approval" | "error";
  onSubmit(text: string): void;
  onCancel(): void;
  onSelectModel(provider: string, model: string): void;
  onSelectPermission(preset: string): void;
  onRequestFullAccess(): void;
}

const MODEL_SEPARATOR = "\u0000";

export function Composer({
  ready,
  models,
  permissions,
  context,
  status,
  onSubmit,
  onCancel,
  onSelectModel,
  onSelectPermission,
  onRequestFullAccess,
}: ComposerProps): JSX.Element {
  const [text, setText] = useState("");

  const send = useCallback((): void => {
    const t = text.trim();
    if (!ready || t.length === 0) return;
    onSubmit(t);
    setText("");
  }, [onSubmit, ready, text]);

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
      <textarea
        className="dsh-composer-input"
        rows={3}
        value={text}
        placeholder="Message DSH…"
        onChange={(e) => setText(e.target.value)}
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
            disabled={
              status !== "thinking" && (!ready || text.trim().length === 0)
            }
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

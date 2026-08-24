import React, { useEffect, useReducer, useRef, useState } from "react";
import type {
  SetCredentialCommand,
  UnsetCredentialCommand,
} from "@dsh-vscode/contract";
import {
  formatSettingsText,
  settingsText,
} from "../../localization/index.js";
import type { SettingsLocale } from "../../types.js";
import { ModelCard, ModelField } from "./ModelCard.js";
import { ModelsController } from "./ModelsController.js";

interface ProviderEditorProps {
  controller: ModelsController;
  locale: SettingsLocale;
  onCredential(command: SetCredentialCommand | UnsetCredentialCommand): void;
}

function numberValue(value: unknown): string | number {
  return typeof value === "number" ? value : "";
}

export function ProviderEditor({
  controller,
  locale,
  onCredential,
}: ProviderEditorProps): JSX.Element | null {
  const [, render] = useReducer((value: number) => value + 1, 0);
  const [secret, setSecret] = useState("");
  const [removeCredential, setRemoveCredential] = useState(false);
  const secretForPending = useRef("");
  useEffect(() => controller.subscribe(() => render()), [controller]);
  useEffect(() => () => {
    secretForPending.current = "";
  }, []);
  const snapshot = controller.snapshot();
  const editor = snapshot.editor;

  useEffect(() => {
    secretForPending.current = "";
    setSecret("");
  }, [snapshot.secretEpoch]);

  useEffect(() => {
    const pending = snapshot.pendingCredential;
    if (pending === undefined) return;
    if (pending.kind === "set") {
      const value = secretForPending.current;
      secretForPending.current = "";
      if (value === "") {
        controller.credentialUnavailable(pending.requestId);
        return;
      }
      onCredential({
        kind: "setCredential",
        requestId: pending.requestId,
        ref: pending.ref,
        value,
      });
    } else {
      onCredential({
        kind: "unsetCredential",
        requestId: pending.requestId,
        ref: pending.ref,
      });
    }
    controller.credentialPosted(pending.requestId);
  }, [controller, onCredential, snapshot.pendingCredential]);

  if (editor === undefined) return null;
  const pending =
    editor.status === "saving-settings" ||
    editor.status === "saving-credential" ||
    editor.status === "deleting";
  const credential = editor.provider.credential;
  const credentialWritable =
    editor.provider.credentialStatus.kind === "none" ||
    credential?.writable === true;
  const modelList = Array.isArray(editor.values.models)
    ? editor.values.models as Record<string, unknown>[]
    : [];

  const apply = (): void => {
    const trimmed = secret.trim();
    if (secret.length > 0 && trimmed.length === 0) return;
    secretForPending.current = trimmed;
    setSecret("");
    const ref = credential?.ref ??
      `${editor.provider.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
    const accepted = controller.apply(
      removeCredential
        ? { kind: "unset", ref }
        : trimmed === ""
          ? { kind: "keep" }
          : { kind: "set", ref },
    );
    if (!accepted) secretForPending.current = "";
  };

  return (
    <div className="dsh-models-editor" aria-busy={pending}>
      <h4>{editor.provider.label}</h4>
      <p className="dsh-models-route">{editor.provider.id}</p>
      <div className="dsh-models-statuses">
        <span>
          {settingsText(locale, "modelsRoute")}:{" "}
          {editor.provider.active
            ? settingsText(locale, "modelsRouteActive")
            : settingsText(locale, "modelsRouteDormant")}
          {editor.provider.declared === undefined
            ? ""
            : editor.provider.declared
              ? ` · ${settingsText(locale, "modelsRouteCustom")}`
              : ` · ${settingsText(locale, "modelsRouteCatalog")}`}
        </span>
        <span>
          {settingsText(locale, "modelsCatalog")}:{" "}
          {editor.provider.catalog.kind === "ready"
            ? settingsText(locale, "modelsCatalogReady")
            : editor.provider.catalog.kind === "dormant"
              ? settingsText(locale, "modelsCatalogDormant")
              : editor.provider.catalog.message}
        </span>
        <span>
          {settingsText(locale, "modelsCredential")}:{" "}
          {editor.provider.credentialStatus.kind === "failed"
            ? editor.provider.credentialStatus.message
            : credential?.set
              ? settingsText(locale, "modelsCredentialConfigured")
              : settingsText(locale, "modelsCredentialMissing")}
          {credential?.source === undefined ? null : ` (${credential.source})`}
          {credential?.writable === false
            ? ` · ${settingsText(locale, "readOnly")}`
            : null}
        </span>
      </div>
      {editor.provider.catalog.kind === "failed" ? (
        <p role="alert">{editor.provider.catalog.message}</p>
      ) : null}
      {editor.provider.credentialStatus.kind === "failed" ? (
        <p role="alert">{editor.provider.credentialStatus.message}</p>
      ) : null}
      {editor.fields.map((field) => {
        const name = field.path.at(-1) ?? "";
        const value = editor.values[name];
        return (
          <div className="dsh-models-field" key={field.path.join(".")}>
            <label>
              <span>{field.label}</span>
              {field.kind === "union" ? (
                <select
                  aria-label={field.label}
                  value={typeof value === "string" ? value : ""}
                  disabled={pending || editor.namespace?.writable !== true}
                  onChange={(event) =>
                    controller.setField(field.path, event.target.value)}
                >
                  <option value="">
                    {settingsText(locale, "modelsUseProviderDefault")}
                  </option>
                  {field.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={field.label}
                  type={field.kind === "number" ? "number" : "text"}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={field.kind === "number"
                    ? numberValue(value)
                    : typeof value === "string" ? value : ""}
                  disabled={pending || editor.namespace?.writable !== true}
                  onChange={(event) => controller.setField(
                    field.path,
                    field.kind === "number"
                      ? event.target.value === ""
                        ? undefined
                        : Number(event.target.value)
                      : event.target.value,
                  )}
                />
              )}
            </label>
            <button
              type="button"
              disabled={pending || editor.namespace?.writable !== true}
              onClick={() => controller.resetField(field.path)}
            >
              {settingsText(locale, "reset")}
            </button>
            {editor.errors[name] === undefined ? null : (
              <p role="alert">
                {formatSettingsText(
                  locale,
                  editor.errors[name].key,
                  editor.errors[name].values,
                )}
              </p>
            )}
          </div>
        );
      })}
      <fieldset className="dsh-models-models">
        <legend>{settingsText(locale, "models")}</legend>
        <button
          type="button"
          disabled={pending}
          onClick={() => controller.resetField([
            ...(editor.provider.namespace === "llm-pi-ai"
              ? ["providers", editor.provider.id]
              : []),
            "models",
          ])}
        >
          {settingsText(locale, "modelsResetModels")}
        </button>
        {modelList.map((model, index) => (
          <ModelCard
            key={index}
            locale={locale}
            index={index}
            disabled={pending}
            onRemove={() =>
              controller.setModels(modelList.filter((_, at) => at !== index))}
          >
            <ModelField label={settingsText(locale, "modelsModelId")}>
              <input
                aria-label={`${settingsText(locale, "modelsModelId")} ${index + 1}`}
                value={typeof model.id === "string" ? model.id : ""}
                placeholder={settingsText(locale, "modelsModelIdPlaceholder")}
                disabled={pending}
                onChange={(event) => {
                  const next = modelList.map((item, at) => (
                    at === index ? { ...item, id: event.target.value } : item
                  ));
                  controller.setModels(next);
                }}
              />
            </ModelField>
            <ModelField label={settingsText(locale, "modelsContextWindow")}>
              <input
                aria-label={`${settingsText(locale, "modelsContextWindow")} ${index + 1}`}
                type="number"
                min={1}
                step={1}
                value={typeof model.contextWindow === "number"
                  ? model.contextWindow
                  : ""}
                placeholder={settingsText(locale, "modelsContextWindowPlaceholder")}
                disabled={pending}
                onChange={(event) => {
                  const next = modelList.map((item, at) => at === index
                    ? {
                        ...item,
                        ...(event.target.value === ""
                          ? {}
                          : { contextWindow: Number(event.target.value) }),
                      }
                    : item);
                  controller.setModels(next);
                }}
              />
            </ModelField>
          </ModelCard>
        ))}
        <button
          type="button"
          disabled={pending}
          onClick={() => controller.setModels([...modelList, { id: "" }])}
        >
          {settingsText(locale, "modelsAddModel")}
        </button>
        {editor.errors.models === undefined ? null : (
          <p role="alert">
            {formatSettingsText(
              locale,
              editor.errors.models.key,
              editor.errors.models.values,
            )}
          </p>
        )}
      </fieldset>
      <div className="dsh-models-field">
        <label>
          <span>{settingsText(locale, "modelsApiKey")}</span>
          <input
            aria-label={settingsText(locale, "modelsApiKey")}
            type="password"
            autoComplete="off"
            value={secret}
            disabled={pending || !credentialWritable}
            onChange={(event) => {
              setSecret(event.target.value);
              setRemoveCredential(false);
            }}
          />
        </label>
        {secret.length > 0 && secret.trim().length === 0 ? (
          <p role="alert">{settingsText(locale, "validationRequired")}</p>
        ) : null}
        {credential?.set && credential.writable ? (
          <label>
            <input
              type="checkbox"
              checked={removeCredential}
              disabled={pending}
              onChange={(event) => {
                setRemoveCredential(event.target.checked);
                setSecret("");
              }}
            />
            {settingsText(locale, "modelsRemoveCredential")}
          </label>
        ) : null}
      </div>
      {editor.error === undefined && editor.errorKey === undefined ? null : (
        <p role="alert">
          {editor.errorKey === undefined
            ? editor.error
            : `${settingsText(locale, editor.errorKey)}${
              editor.error === undefined ? "" : `: ${editor.error}`
            }`}
        </p>
      )}
      <div className="dsh-settings-actions">
        <button
          type="button"
          disabled={pending || Object.keys(editor.errors).length > 0}
          onClick={apply}
        >
          {settingsText(locale, "apply")}
        </button>
        {editor.status === "conflict" ? (
          <button
            type="button"
            disabled={!editor.retryable}
            onClick={() => controller.retry()}
          >
            {settingsText(locale, "retry")}
          </button>
        ) : null}
        {editor.status === "conflict" ||
        editor.status === "credential-failed" ? (
          <button type="button" onClick={() => controller.discard()}>
            {settingsText(locale, "discard")}
          </button>
        ) : null}
        <button type="button" disabled={pending} onClick={() => controller.select(undefined)}>
          {settingsText(locale, "cancel")}
        </button>
      </div>
    </div>
  );
}

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
import { ModelsController } from "./ModelsController.js";

const LEGAL_API_KEY = /^[\x21-\x7E]+$/;
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/;

function invalidKey(value: string): "blank" | "illegal" | undefined {
  if (value.length === 0) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return "blank";
  const first = trimmed[0];
  if (
    (first === "\"" || first === "'" || first === "`") &&
    trimmed.length > 1 &&
    trimmed.endsWith(first)
  ) return "illegal";
  if (ENV_LINE.test(trimmed) || !LEGAL_API_KEY.test(trimmed)) return "illegal";
  return undefined;
}

interface CustomProviderCardProps {
  controller: ModelsController;
  locale: SettingsLocale;
  onCredential(command: SetCredentialCommand | UnsetCredentialCommand): void;
}

export function CustomProviderCard({
  controller,
  locale,
  onCredential,
}: CustomProviderCardProps): JSX.Element | null {
  const [, render] = useReducer((value: number) => value + 1, 0);
  const [secret, setSecret] = useState("");
  const secretForPending = useRef("");
  useEffect(() => controller.subscribe(() => render()), [controller]);
  useEffect(() => () => {
    secretForPending.current = "";
  }, []);
  const snapshot = controller.snapshot();
  const draft = snapshot.custom;

  useEffect(() => {
    secretForPending.current = "";
    setSecret("");
  }, [snapshot.secretEpoch]);

  useEffect(() => {
    const pending = snapshot.pendingCredential;
    if (draft === undefined || pending?.kind !== "set") return;
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
    controller.credentialPosted(pending.requestId);
  }, [controller, draft, onCredential, snapshot.pendingCredential]);

  if (draft === undefined) return null;
  const keyFailure = invalidKey(secret);
  const busy =
    draft.status === "saving-settings" ||
    draft.status === "saving-credential";
  const profileDisabled = busy || draft.committed || draft.readOnly;
  const submitDisabled =
    busy ||
    draft.readOnly ||
    keyFailure !== undefined ||
    (!draft.committed && !draft.ready) ||
    draft.status === "conflict" ||
    (draft.committed && secret.trim().length === 0);

  const create = (): void => {
    const value = secret.trim();
    secretForPending.current = value;
    setSecret("");
    if (!controller.createCustom(value.length > 0)) {
      secretForPending.current = "";
    }
  };

  const updateModel = (
    index: number,
    field: "id" | "name" | "contextWindow" | "maxTokens",
    value: unknown,
  ): void => {
    controller.setCustomModels(draft.models.map((model, at) => {
      if (at !== index) return { ...model };
      const next = { ...model };
      if (value === undefined || value === "") delete next[field];
      else next[field] = value;
      return next;
    }));
  };

  return (
    <div className="dsh-models-editor" aria-busy={busy}>
      <h4>{settingsText(locale, "modelsCustomTitle")}</h4>
      <div className="dsh-models-field">
        <label>
          <span>{settingsText(locale, "modelsCustomRoute")}</span>
          <input
            aria-label={settingsText(locale, "modelsCustomRoute")}
            value={draft.route}
            disabled={profileDisabled}
            onChange={(event) =>
              controller.setCustomField("route", event.target.value)}
          />
        </label>
        {draft.routeInvalid || draft.routeTaken ? (
          <p role="alert">
            {settingsText(
              locale,
              draft.routeTaken
                ? "modelsCustomRouteTaken"
                : "modelsCustomRouteInvalid",
            )}
          </p>
        ) : (
          <p>{settingsText(locale, "modelsCustomRouteHint")}</p>
        )}
      </div>
      <label className="dsh-models-field">
        <span>{settingsText(locale, "modelsCustomDisplayName")}</span>
        <input
          aria-label={settingsText(locale, "modelsCustomDisplayName")}
          value={draft.displayName}
          placeholder={
            draft.route.length === 0
              ? settingsText(locale, "modelsCustomDisplayName")
              : draft.route
          }
          disabled={profileDisabled}
          onChange={(event) =>
            controller.setCustomField("displayName", event.target.value)}
        />
      </label>
      <label className="dsh-models-field">
        <span>{settingsText(locale, "modelsBaseUrl")}</span>
        <input
          aria-label={settingsText(locale, "modelsBaseUrl")}
          value={draft.baseURL}
          disabled={profileDisabled}
          onChange={(event) =>
            controller.setCustomField("baseURL", event.target.value)}
        />
      </label>
      {!draft.baseURLInvalid ? null : (
        <p role="alert">
          {settingsText(locale, "modelsValidationBaseUrl")}
        </p>
      )}
      <label className="dsh-models-field">
        <span>{settingsText(locale, "modelsCustomApi")}</span>
        <select
          aria-label={settingsText(locale, "modelsCustomApi")}
          value={draft.protocol}
          disabled={profileDisabled}
          onChange={(event) =>
            controller.setCustomField("protocol", event.target.value)}
        >
          {snapshot.protocols.map((protocol) => (
            <option key={protocol} value={protocol}>{protocol}</option>
          ))}
        </select>
      </label>
      <label className="dsh-models-field">
        <span>{settingsText(locale, "modelsApiKey")}</span>
        <input
          aria-label={settingsText(locale, "modelsApiKey")}
          type="password"
          autoComplete="off"
          value={secret}
          disabled={busy || draft.readOnly}
          onChange={(event) => setSecret(event.target.value)}
        />
      </label>
      {keyFailure === undefined ? null : (
        <p role="alert">
          {settingsText(
            locale,
            keyFailure === "blank"
              ? "modelsApiKeyBlankNew"
              : "modelsApiKeyIllegal",
          )}
        </p>
      )}
      <fieldset className="dsh-models-models">
        <legend>{settingsText(locale, "models")}</legend>
        {draft.models.map((model, index) => (
          <div
            className="dsh-models-model-row dsh-models-custom-model-row"
            key={index}
          >
            <input
              aria-label={`${settingsText(locale, "modelsModelId")} ${index + 1}`}
              value={typeof model.id === "string" ? model.id : ""}
              disabled={profileDisabled}
              onChange={(event) => updateModel(index, "id", event.target.value)}
              onBlur={(event) => {
                const trimmed = event.target.value.trim();
                if (trimmed !== event.target.value) {
                  updateModel(index, "id", trimmed);
                }
              }}
            />
            <input
              aria-label={`${settingsText(locale, "modelsModelName")} ${index + 1}`}
              value={typeof model.name === "string" ? model.name : ""}
              disabled={profileDisabled}
              onChange={(event) => updateModel(index, "name", event.target.value)}
            />
            {(["contextWindow", "maxTokens"] as const).map((field) => (
              <input
                key={field}
                aria-label={`${settingsText(
                  locale,
                  field === "contextWindow"
                    ? "modelsContextWindow"
                    : "modelsMaxTokens",
                )} ${index + 1}`}
                type="number"
                min={1}
                step={1}
                value={typeof model[field] === "number" ? model[field] : ""}
                disabled={profileDisabled}
                onChange={(event) => updateModel(
                  index,
                  field,
                  event.target.value === ""
                    ? undefined
                    : Number(event.target.value),
                )}
              />
            ))}
            <button
              type="button"
              aria-label={`${settingsText(locale, "modelsRemoveModel")} ${index + 1}`}
              disabled={profileDisabled}
              onClick={() => controller.setCustomModels(
                draft.models.filter((_, at) => at !== index),
              )}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={profileDisabled}
          onClick={() =>
            controller.setCustomModels([...draft.models, { id: "" }])}
        >
          {settingsText(locale, "modelsAddModel")}
        </button>
        {draft.modelError === undefined ? null : (
          <p role="alert">
            {formatSettingsText(
              locale,
              draft.modelError.key,
              draft.modelError.values,
            )}
          </p>
        )}
      </fieldset>
      {draft.error === undefined && draft.errorKey === undefined ? null : (
        <p role="alert">
          {draft.errorKey === undefined
            ? draft.error
            : `${settingsText(locale, draft.errorKey)}${
              draft.error === undefined ? "" : `: ${draft.error}`
            }`}
        </p>
      )}
      {!draft.ready &&
      draft.route.length > 0 &&
      !draft.routeInvalid &&
      !draft.routeTaken &&
      !draft.baseURLInvalid &&
      draft.modelError === undefined &&
      keyFailure === undefined ? (
        <p>
          {settingsText(
            locale,
            draft.baseURL.length === 0
              ? "modelsCustomNeedsBaseUrl"
              : "modelsCustomNeedsModels",
          )}
        </p>
      ) : null}
      <div className="dsh-settings-actions">
        <button type="button" disabled={submitDisabled} onClick={create}>
          {settingsText(
            locale,
            busy ? "modelsCreating" : "modelsCreate",
          )}
        </button>
        {draft.status === "conflict" ? (
          <>
            <button
              type="button"
              disabled={!draft.retryable}
              onClick={() => controller.retryCustom()}
            >
              {settingsText(locale, "retry")}
            </button>
            <button
              type="button"
              onClick={() => controller.discardCustom()}
            >
              {settingsText(locale, "discard")}
            </button>
          </>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => controller.cancelCustom()}
        >
          {settingsText(locale, "cancel")}
        </button>
      </div>
    </div>
  );
}

import React, { useEffect, useReducer, useRef, useState } from "react";
import type {
  SetCredentialCommand,
  UnsetCredentialCommand,
} from "@dsh-vscode/contract";
import { settingsText } from "../../localization/index.js";
import type { SettingsLocale } from "../../types.js";
import {
  PluginsController,
  type PluginCardSnapshot,
} from "./PluginsController.js";

interface PluginCardProps {
  controller: PluginsController;
  card: PluginCardSnapshot;
  locale: SettingsLocale;
  onCredential(command: SetCredentialCommand | UnsetCredentialCommand): void;
}

function statusText(locale: SettingsLocale, card: PluginCardSnapshot): string {
  const credential = card.credential;
  if (card.credentialStatus?.kind === "failed") {
    return card.credentialStatus.message;
  }
  if (credential?.set === true) {
    return settingsText(locale, "pluginsCredentialConfigured");
  }
  return settingsText(locale, "pluginsCredentialMissing");
}

export function PluginCard({
  controller,
  card,
  locale,
  onCredential,
}: PluginCardProps): JSX.Element {
  const [, render] = useReducer((value: number) => value + 1, 0);
  const [secret, setSecret] = useState("");
  const secretForPending = useRef("");
  useEffect(() => controller.subscribe(() => render()), [controller]);
  const snapshot = controller.snapshot();
  const current = controller.card(card.namespace) ?? card;
  const credentialRef = card.credential?.ref;
  const pending =
    current.status === "saving-settings" ||
    current.status === "saving-credential";

  useEffect(() => () => {
    secretForPending.current = "";
    if (credentialRef !== undefined) {
      controller.clearCredentialSecret(card.namespace);
    }
  }, [card.namespace, controller, credentialRef]);

  useEffect(() => {
    secretForPending.current = "";
    setSecret("");
  }, [snapshot.secretEpoch]);

  useEffect(() => {
    const credential = snapshot.pendingCredential;
    if (credential?.namespace !== current.namespace) return;
    if (credential.kind === "set") {
      const value = secretForPending.current;
      secretForPending.current = "";
      if (value === "") {
        controller.credentialUnavailable(credential.requestId);
        return;
      }
      onCredential({
        kind: "setCredential",
        requestId: credential.requestId,
        ref: credential.ref,
        value,
      });
    } else {
      onCredential({
        kind: "unsetCredential",
        requestId: credential.requestId,
        ref: credential.ref,
      });
    }
    controller.credentialPosted(credential.requestId);
  }, [
    controller,
    current.namespace,
    onCredential,
    snapshot.pendingCredential,
  ]);

  const save = (): void => {
    const trimmed = secret.trim();
    secretForPending.current = trimmed;
    setSecret("");
    if (trimmed !== "" && current.credential !== undefined) {
      controller.armCredential(current.namespace, current.credential.ref);
    }
    if (!controller.save(current.namespace)) secretForPending.current = "";
  };
  const localCredentialReady =
    secret.trim() !== "" &&
    current.credentialStatus?.kind === "ready" &&
    current.credential?.writable === true;
  const canSave =
    current.canSave ||
    (
      current.available &&
      !current.settingsDirty &&
      localCredentialReady &&
      !pending &&
      current.status !== "conflict"
    );

  return (
    <article
      className="dsh-plugin-card"
      aria-labelledby={`plugin-card-${current.namespace}`}
      aria-busy={pending}
    >
      <header className="dsh-plugin-card-header">
        <div>
          <h4 id={`plugin-card-${current.namespace}`}>{current.label}</h4>
          <code
            aria-label={`${settingsText(locale, "pluginsNamespace")}: ${
              current.namespace
            }`}
          >
            {current.namespace}
          </code>
        </div>
        <span className="dsh-settings-badge">
          {settingsText(
            locale,
            current.applies === "restart" ? "restartApply" : "liveApply",
          )}
        </span>
      </header>
      {!current.available ? (
        <p role="status">{settingsText(locale, "unavailable")}</p>
      ) : (
        <>
          {!current.writable ? (
            <p role="status">{settingsText(locale, "readOnly")}</p>
          ) : null}
          {Object.entries(current.fields).map(([name, field]) => (
            <div className="dsh-plugin-field" key={name}>
              <label>
                <span>{field.label}</span>
                <input
                  aria-label={field.label}
                  type={field.kind === "number" ? "number" : "text"}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={field.text}
                  disabled={pending || !current.writable}
                  onChange={(event) =>
                    controller.edit(current.namespace, name, event.target.value)}
                />
              </label>
              <button
                type="button"
                aria-label={`${settingsText(locale, "reset")} ${field.label}`}
                disabled={pending || !current.writable}
                onClick={() => controller.resetField(current.namespace, name)}
              >
                {settingsText(locale, "reset")}
              </button>
              {field.overridden ? (
                <span className="dsh-settings-badge">
                  {settingsText(locale, "overridden")}
                </span>
              ) : null}
              {field.invalid ? (
                <p role="alert">
                  {name === "baseURL"
                    ? settingsText(locale, "pluginsValidationBaseUrl")
                    : settingsText(locale, "pluginsValidationPositive")}
                </p>
              ) : null}
            </div>
          ))}
          {current.namespace === "web-search-deepseek" ? (
            <div className="dsh-plugin-field">
              <label>
                <span>{settingsText(locale, "pluginsApiKey")}</span>
                <input
                  aria-label={settingsText(locale, "pluginsApiKey")}
                  type="password"
                  autoComplete="off"
                  value={secret}
                  disabled={
                    pending ||
                    current.credentialStatus?.kind !== "ready" ||
                    current.credential?.writable !== true
                  }
                  onChange={(event) => {
                    const value = event.target.value;
                    setSecret(value);
                    if (current.credential !== undefined) {
                      controller.stageCredential(
                        current.namespace,
                        current.credential.ref,
                        value.trim() === "" ? "keep" : "set",
                      );
                    }
                  }}
                />
              </label>
              <span role="status">
                {statusText(locale, current)}
                {current.credential?.source === undefined
                  ? ""
                  : ` (${current.credential.source})`}
              </span>
              {current.credentialStatus?.kind === "failed" ? (
                <p role="alert">{current.credentialStatus.message}</p>
              ) : null}
              {current.credential?.set === true &&
              current.credential.writable ? (
                <label>
                  <input
                    type="checkbox"
                    aria-label={settingsText(
                      locale,
                      "pluginsRemoveCredential",
                    )}
                    checked={current.credentialIntent === "unset"}
                    disabled={pending}
                    onChange={(event) => {
                      setSecret("");
                      secretForPending.current = "";
                      controller.stageCredential(
                        current.namespace,
                        current.credential!.ref,
                        event.target.checked ? "unset" : "keep",
                      );
                    }}
                  />
                  {settingsText(locale, "pluginsRemoveCredential")}
                </label>
              ) : null}
            </div>
          ) : null}
          {current.settingsDirty && !current.writable ? (
            <p role="alert">
              {settingsText(locale, "pluginsReadOnlyDirty")}
            </p>
          ) : null}
          {current.stale && current.status !== "conflict" ? (
            <p role="status">{settingsText(locale, "pluginsStale")}</p>
          ) : null}
          {current.status === "conflict" ? (
            <p role="alert">{settingsText(locale, "conflictDetail")}</p>
          ) : null}
          {current.error === undefined ? null : (
            <p role="alert">{current.error}</p>
          )}
          {current.status === "credential-failed" ? (
            <p role="status">{settingsText(locale, "pluginsSecretReenter")}</p>
          ) : null}
          <div className="dsh-settings-actions">
            <button
              type="button"
              disabled={
                !canSave
              }
              onClick={save}
            >
              {settingsText(locale, "save")}
            </button>
            {current.status === "conflict" ? null : (
              <button
                type="button"
                disabled={pending || !current.dirty}
                onClick={() => {
                  if (
                    current.settingsDirty &&
                    !current.writable &&
                    current.credentialDirty
                  ) {
                    controller.discardSettings(current.namespace);
                  } else {
                    controller.discard(current.namespace);
                  }
                }}
              >
                {settingsText(locale, "discard")}
              </button>
            )}
            {current.status === "conflict" ? (
              <>
                <button
                  type="button"
                  disabled={!current.retryable}
                  onClick={() => controller.retry(current.namespace)}
                >
                  {settingsText(locale, "retry")}
                </button>
                <button
                  type="button"
                  onClick={() => controller.discard(current.namespace)}
                >
                  {settingsText(locale, "discard")}
                </button>
              </>
            ) : null}
          </div>
        </>
      )}
    </article>
  );
}

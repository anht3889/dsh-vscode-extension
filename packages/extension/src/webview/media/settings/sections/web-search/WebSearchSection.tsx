import React, {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import type {
  WebSearchEngineWire,
  WebSearchSecretRefWire,
  WebSearchSettingsView,
} from "@dsh-vscode/contract";
import {
  formatSettingsText,
  settingsText,
  type SettingsCopyKey,
} from "../../localization/index.js";
import type { SettingsLocale } from "../../types.js";
import { WebSearchController } from "./WebSearchController.js";

interface WebSearchSectionProps {
  controller: WebSearchController;
  view: WebSearchSettingsView;
  locale: SettingsLocale;
}

type SecretValues = Record<WebSearchSecretRefWire, string>;

const ENGINE_LABELS: Record<WebSearchEngineWire, SettingsCopyKey> = {
  tavily: "webSearchEngineTavily",
  brave: "webSearchEngineBrave",
  searxng: "webSearchEngineSearxng",
};

const SECRET_LABELS: Record<WebSearchSecretRefWire, SettingsCopyKey> = {
  TAVILY_API_KEY: "webSearchTavilyApiKey",
  BRAVE_API_KEY: "webSearchBraveApiKey",
};

const EMPTY_SECRETS: SecretValues = {
  TAVILY_API_KEY: "",
  BRAVE_API_KEY: "",
};
const SECRET_REFS = Object.keys(EMPTY_SECRETS) as WebSearchSecretRefWire[];

export function WebSearchSection({
  controller,
  view,
  locale,
}: WebSearchSectionProps): JSX.Element {
  const [, render] = useReducer((value: number) => value + 1, 0);
  const [secrets, setSecrets] = useState<SecretValues>(EMPTY_SECRETS);
  const id = useId();
  const radios = useRef<Array<HTMLInputElement | null>>([]);
  const priorEpoch = useRef(controller.snapshot().secretEpoch);
  const priorStatus = useRef(controller.snapshot().status);

  useEffect(() => controller.subscribe(() => render()), [controller]);
  useEffect(() => () => {
    for (const ref of SECRET_REFS) controller.clearStagedSecret(ref);
  }, [controller]);
  const snapshot = controller.snapshot();

  const setSecret = useCallback((
    ref: WebSearchSecretRefWire,
    value: string,
  ): void => {
    setSecrets((current) => ({ ...current, [ref]: value }));
    controller.stageSecret(ref, value);
  }, [controller]);

  const clearSecret = useCallback((ref: WebSearchSecretRefWire): void => {
    setSecrets((current) => ({ ...current, [ref]: "" }));
    controller.clearStagedSecret(ref);
  }, [controller]);

  useEffect(() => {
    if (snapshot.secretEpoch === priorEpoch.current) return;
    priorEpoch.current = snapshot.secretEpoch;
    for (const ref of SECRET_REFS) clearSecret(ref);
  }, [clearSecret, snapshot.secretEpoch]);

  useEffect(() => {
    const settled = priorStatus.current === "saving" && snapshot.status === "idle";
    priorStatus.current = snapshot.status;
    if (!settled || snapshot.errorKey !== "webSearchSecretPartialFailure") return;
    for (const ref of SECRET_REFS) {
      if (!snapshot.secretFailures.includes(ref)) clearSecret(ref);
    }
  }, [
    clearSecret,
    snapshot.errorKey,
    snapshot.secretFailures.join("\0"),
    snapshot.status,
  ]);

  const selected = snapshot.engines.find(
    (engine) => engine.engine === snapshot.engine,
  );
  const otherEngines = snapshot.engines.filter(
    (engine) => engine.engine !== snapshot.engine,
  );
  const busy = snapshot.status === "saving";

  const availability = (): string => {
    if (snapshot.available) return settingsText(locale, "webSearchAvailable");
    if (snapshot.engine === null) {
      return settingsText(locale, "webSearchMissingEngine");
    }
    if (
      snapshot.engine === "searxng" &&
      (selected?.baseURL.trim() ?? "") === ""
    ) {
      return settingsText(locale, "webSearchMissingSearxngBaseUrl");
    }
    const info = view.engines.find((engine) => engine.engine === snapshot.engine);
    if (info?.secretRef !== undefined) {
      const secret = snapshot.secrets.find((entry) => entry.ref === info.secretRef);
      if (
        snapshot.secretFailures.includes(info.secretRef) ||
        (secret?.configured !== true && secret?.staged !== true)
      ) {
        return formatSettingsText(locale, "webSearchMissingSecret", {
          ref: info.secretRef,
        });
      }
    }
    return settingsText(locale, "webSearchUnavailable");
  };

  const endpoint = (
    engine: typeof snapshot.engines[number],
    selectedRow: boolean,
  ): JSX.Element => {
    const info = view.engines.find((candidate) => candidate.engine === engine.engine);
    const inputId = `${id}-${engine.engine}-base-url`;
    const hintId = `${inputId}-hint`;
    const errorId = `${inputId}-error`;
    return (
      <div className="dsh-web-search-field" key={engine.engine}>
        <label htmlFor={inputId}>
          <span>
            {settingsText(locale, "webSearchBaseUrl")}
            {!selectedRow ? ` · ${settingsText(locale, ENGINE_LABELS[engine.engine])}` : ""}
          </span>
          <input
            id={inputId}
            type="url"
            value={engine.baseURL}
            required={selectedRow && info?.baseURLRequired === true}
            disabled={busy}
            aria-invalid={engine.baseURLError !== undefined}
            aria-describedby={[
              hintId,
              engine.baseURLError === undefined ? undefined : errorId,
            ].filter(Boolean).join(" ")}
            placeholder={info?.defaultBaseURL}
            onChange={(event) =>
              controller.setBaseURL(engine.engine, event.currentTarget.value)}
          />
        </label>
        <p id={hintId} className="dsh-settings-hint">
          {info?.defaultBaseURL === undefined
            ? settingsText(locale, "webSearchBaseUrlRequiredHint")
            : formatSettingsText(locale, "webSearchBaseUrlDefaultHint", {
              url: info.defaultBaseURL,
            })}
        </p>
        {engine.baseURLError === undefined ? null : (
          <p id={errorId} className="dsh-settings-error" role="alert">
            {settingsText(locale, engine.baseURLError)}
          </p>
        )}
      </div>
    );
  };

  return (
    <section
      className="dsh-settings-web-search"
      aria-label={settingsText(locale, "webSearch")}
    >
      <p className="dsh-settings-section-intro">
        {settingsText(locale, "webSearchIntro")}
      </p>
      <fieldset
        className="dsh-web-search-engines"
        role="radiogroup"
        disabled={busy}
        aria-label={settingsText(locale, "webSearchEngineGroup")}
      >
        <legend>{settingsText(locale, "webSearchEngineGroup")}</legend>
        <div className="dsh-web-search-radio-row">
          {view.engines.map((engine, index) => (
            <label key={engine.engine}>
              <input
                ref={(element) => {
                  radios.current[index] = element;
                }}
                type="radio"
                name={`${id}-engine`}
                value={engine.engine}
                checked={snapshot.engine === engine.engine}
                onChange={() => controller.selectEngine(engine.engine)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
                    return;
                  }
                  event.preventDefault();
                  const delta = event.key === "ArrowRight" ? 1 : -1;
                  const next = (index + delta + view.engines.length) %
                    view.engines.length;
                  const nextEngine = view.engines[next];
                  if (nextEngine === undefined) return;
                  controller.selectEngine(nextEngine.engine);
                  radios.current[next]?.focus();
                }}
              />
              {settingsText(locale, ENGINE_LABELS[engine.engine])}
            </label>
          ))}
        </div>
      </fieldset>

      {selected === undefined ? null : endpoint(selected, true)}

      <div className="dsh-web-search-secrets">
        {snapshot.secrets.map((secret) => {
          const inputId = `${id}-${secret.ref}`;
          const hintId = `${inputId}-hint`;
          return (
            <div className="dsh-web-search-field" key={secret.ref}>
              <label htmlFor={inputId}>
                <span>{settingsText(locale, SECRET_LABELS[secret.ref])}</span>
                <input
                  id={inputId}
                  type="password"
                  value={secrets[secret.ref]}
                  disabled={busy}
                  autoComplete="new-password"
                  aria-describedby={hintId}
                  onChange={(event) => setSecret(secret.ref, event.currentTarget.value)}
                />
              </label>
              <p id={hintId} className="dsh-settings-hint">
                {settingsText(locale, "webSearchSecretReadbackHint")}
              </p>
              <span className="dsh-settings-badge">
                {settingsText(
                  locale,
                  secret.configured
                    ? "webSearchSecretConfigured"
                    : "webSearchSecretNotConfigured",
                )}
              </span>
            </div>
          );
        })}
        <p className="dsh-settings-hint">
          {settingsText(locale, "webSearchSecretReplaceOnly")}
        </p>
      </div>

      <details className="dsh-web-search-other">
        <summary>{settingsText(locale, "webSearchOtherEndpoints")}</summary>
        <div className="dsh-web-search-other-fields">
          {otherEngines.map((engine) => endpoint(engine, false))}
        </div>
      </details>

      <p className="dsh-web-search-availability" role="status" aria-live="polite">
        {availability()}
      </p>

      {snapshot.secretFailures.length === 0 ? null : (
        <div className="dsh-settings-error" role="alert">
          {snapshot.secretFailures.map((ref) => (
            <p key={ref}>
              {formatSettingsText(locale, "webSearchSecretFailure", { ref })}
            </p>
          ))}
        </div>
      )}
      {snapshot.errorKey === undefined ||
          snapshot.errorKey === "webSearchSecretPartialFailure"
        ? null
        : (
          <p className="dsh-settings-error" role="alert">
            {settingsText(locale, snapshot.errorKey)}
            {snapshot.errorDetail === undefined ? "" : `: ${snapshot.errorDetail}`}
          </p>
        )}

      <div className="dsh-settings-actions">
        <button
          type="button"
          disabled={!snapshot.canSave}
          onClick={() => {
            if (snapshot.secretFailures.length > 0) {
              controller.retrySecrets(secrets);
            } else {
              controller.save(secrets);
            }
          }}
        >
          {settingsText(locale, snapshot.secretFailures.length > 0 ? "retry" : "save")}
        </button>
        <button
          type="button"
          disabled={
            busy ||
            (!snapshot.dirty && !snapshot.secrets.some((secret) => secret.staged))
          }
          onClick={() => {
            for (const ref of SECRET_REFS) clearSecret(ref);
            controller.discardAll();
          }}
        >
          {settingsText(locale, "discard")}
        </button>
      </div>
    </section>
  );
}

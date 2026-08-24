import React, {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import type { McpAuthWire, McpTransportWire } from "@dsh-vscode/contract";
import {
  formatSettingsText,
  settingsText,
  type SettingsCopyKey,
} from "../../localization/index.js";
import { SettingsNestedDialog } from "../../SettingsNestedDialog.js";
import type { SettingsLocale } from "../../types.js";
import {
  McpController,
  type McpEditorDraft,
} from "./McpController.js";

type SecretValues = Record<string, string>;

/**
 * Callback path offered for a new OAuth server. The owning plugin defaults to
 * the same path and its catalog refuses one without a leading slash, so seeding
 * it keeps a new record savable without the operator guessing the convention.
 */
const DEFAULT_REDIRECT_PATH = "/callback";

const authOf = (kind: McpAuthWire["kind"]): McpAuthWire => {
  switch (kind) {
    case "none":
      return { kind: "none" };
    case "headers":
      return { kind: "headers", headerNames: [] };
    case "oauth":
      return {
        kind: "oauth",
        clientId: "",
        authorizeUrl: "",
        tokenUrl: "",
        scopes: [],
        redirectPath: DEFAULT_REDIRECT_PATH,
      };
  }
};

const notPositive = (value: number): boolean =>
  !Number.isInteger(value) || value <= 0;

const negative = (value: number): boolean =>
  !Number.isInteger(value) || value < 0;

/**
 * Inline MCP record editor with component-local write-only secret inputs.
 *
 * Save is offered only while `controller.editorValid()` holds, because the
 * webview-to-host relay discards a malformed command without replying. The
 * per-field markers below are presentation only: acceptance is the controller's
 * single contract predicate, never a second rule expressed here.
 *
 * A record success that requests secrets is continued automatically while this
 * component still holds every requested value, so one Save writes the record
 * and then the secrets. The explicit controls appear only when a value is no
 * longer held — a request that outlived its secret epoch.
 */
export function McpServerEditor({
  controller,
  locale,
  draft: suppliedDraft,
  secretStates,
  oauthDiscovery,
  oauthAuthorization,
  oauthOrigin,
}: {
  controller: McpController;
  locale: SettingsLocale;
  draft: McpEditorDraft;
  secretStates: "available" | "unavailable";
  oauthDiscovery: "available" | "unavailable";
  oauthAuthorization: "available" | "unavailable";
  oauthOrigin?: string;
}): JSX.Element {
  const [, render] = useReducer((value: number) => value + 1, 0);
  const [secrets, setSecrets] = useState<SecretValues>({});
  const secretsRef = useRef<SecretValues>({});
  const previousEpoch = useRef(controller.snapshot().secretEpoch);
  const continuedEpochs = useRef(new Set<number>());
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const closeEditor = useCallback((): void => {
    controller.closeEditor();
  }, [controller]);

  useEffect(() => controller.subscribe(() => render()), [controller]);
  useEffect(() => {
    secretsRef.current = secrets;
  }, [secrets]);
  useEffect(() => () => {
    for (const name of Object.keys(secretsRef.current)) {
      controller.stageSecret(name, "");
    }
    secretsRef.current = {};
  }, [controller]);

  const snapshot = controller.snapshot();
  const draft = snapshot.editor ?? suppliedDraft;
  const valid = controller.editorValid();

  useEffect(() => {
    if (snapshot.secretEpoch === previousEpoch.current) return;
    previousEpoch.current = snapshot.secretEpoch;
    secretsRef.current = {};
    setSecrets({});
  }, [snapshot.secretEpoch]);
  useEffect(() => {
    if (snapshot.editor !== undefined) return;
    secretsRef.current = {};
    setSecrets({});
  }, [snapshot.editor]);

  const secretRequest = snapshot.secretRequest;
  const missingSecretNames = (secretRequest?.names ?? []).filter((name) =>
    (secrets[name] ?? "").trim() === "");
  const continuable = secretRequest !== undefined && missingSecretNames.length === 0;
  useEffect(() => {
    if (!continuable) return;
    const request = controller.snapshot().secretRequest;
    if (request === undefined || continuedEpochs.current.has(request.epoch)) {
      return;
    }
    continuedEpochs.current.add(request.epoch);
    if (!controller.continueSecretSave(secretsRef.current)) {
      continuedEpochs.current.delete(request.epoch);
    }
  }, [controller, continuable, secretRequest?.epoch]);

  const owner = draft.serverId ?? "create";
  const busy = snapshot.pending.includes(owner);
  const awaitingSecrets = secretRequest !== undefined;
  const disabled = busy || awaitingSecrets || !snapshot.connected;
  const canProvision = oauthAuthorization === "available" &&
    oauthDiscovery === "available" &&
    draft.transport === "streamable-http" &&
    draft.auth.kind === "oauth";
  const provisionReady = draft.serverName.trim() !== "" &&
    draft.url.trim() !== "" &&
    !disabled &&
    !snapshot.authorizing;

  const hintId = (field: string): string => `${id}-${field}-hint`;

  const flag = (
    field: string,
    invalid: boolean,
  ): { "aria-invalid"?: true; "aria-describedby"?: string } =>
    invalid ? { "aria-invalid": true, "aria-describedby": hintId(field) } : {};

  const hint = (
    field: string,
    invalid: boolean,
    key: SettingsCopyKey = "validationRequired",
  ): JSX.Element | null =>
    invalid
      ? (
        <p id={hintId(field)} className="dsh-mcp-invalid">
          {settingsText(locale, key)}
        </p>
      )
      : null;

  const nameInvalid = draft.serverName === "";
  const commandInvalid = draft.transport === "stdio" && draft.command === "";
  const urlInvalid = draft.transport === "streamable-http" && draft.url === "";
  const timeoutInvalid = notPositive(draft.toolCallTimeoutMs);
  const oauthInvalid = (
    field: "clientId" | "authorizeUrl" | "tokenUrl" | "redirectPath",
  ): boolean => draft.auth.kind === "oauth" && draft.auth[field] === "";

  const setSecret = (name: string, value: string): void => {
    setSecrets((current) => ({ ...current, [name]: value }));
    controller.stageSecret(name, value);
  };

  const setAuth = (kind: McpAuthWire["kind"]): void => {
    for (const name of Object.keys(secretsRef.current)) {
      controller.stageSecret(name, "");
    }
    secretsRef.current = {};
    setSecrets({});
    controller.setEditorField("auth", authOf(kind));
  };

  const replaceHeaderName = (index: number, name: string): void => {
    if (draft.auth.kind !== "headers") return;
    const prior = draft.auth.headerNames[index] ?? "";
    const names = draft.auth.headerNames.map((entry, current) =>
      current === index ? name : entry);
    const value = secretsRef.current[prior] ?? "";
    if (prior !== name) {
      controller.stageSecret(prior, "");
      setSecrets((current) => {
        const next = { ...current };
        delete next[prior];
        if (value !== "") next[name] = value;
        return next;
      });
    }
    controller.setEditorField("auth", { kind: "headers", headerNames: names });
    if (value !== "") controller.stageSecret(name, value);
  };

  const textField = (
    field: string,
    labelKey: SettingsCopyKey,
    value: string,
    onChange: (value: string) => void,
    invalid = false,
    type?: "text" | "url",
    inputRef?: React.RefObject<HTMLInputElement>,
  ): JSX.Element => (
    <div className="dsh-mcp-field-group">
      <label className="dsh-mcp-field">
        <span>{settingsText(locale, labelKey)}</span>
        <input
          ref={inputRef}
          {...(type === undefined ? {} : { type })}
          value={value}
          disabled={disabled}
          {...flag(field, invalid)}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </label>
      {hint(field, invalid)}
    </div>
  );

  const numberField = (
    field: string,
    labelKey: SettingsCopyKey,
    value: number,
    onChange: (value: number) => void,
    min: number,
    invalid: boolean,
    hintKey: SettingsCopyKey,
  ): JSX.Element => (
    <div className="dsh-mcp-field-group">
      <label className="dsh-mcp-field">
        <span>{settingsText(locale, labelKey)}</span>
        <input
          type="number"
          min={min}
          step={1}
          value={value}
          disabled={disabled}
          {...flag(field, invalid)}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
      </label>
      {hint(field, invalid, hintKey)}
    </div>
  );

  const heading = settingsText(
    locale,
    draft.mode === "create" ? "mcpEditorCreate" : "mcpEditorEdit",
  );
  return (
    <SettingsNestedDialog
      labelledBy={`${id}-title`}
      initialRef={nameRef}
      saving={busy || awaitingSecrets}
      onEscape={closeEditor}
    >
      <form
        className="dsh-mcp-editor"
        role="form"
        aria-label={heading}
        onSubmit={(event) => {
          event.preventDefault();
          controller.saveEditor(secretsRef.current);
        }}
      >
      <h3 id={`${id}-title`}>{heading}</h3>
      {textField(
        "name",
        "mcpServerName",
        draft.serverName,
        (value) => controller.setEditorField("serverName", value),
        nameInvalid,
        undefined,
        nameRef,
      )}
      <label className="dsh-mcp-check">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={disabled}
          onChange={(event) =>
            controller.setEditorField("enabled", event.currentTarget.checked)}
        />
        {settingsText(locale, "mcpEnabled")}
      </label>

      <fieldset disabled={disabled} aria-label={settingsText(locale, "mcpTransport")}>
        <legend>{settingsText(locale, "mcpTransport")}</legend>
        {(["stdio", "streamable-http"] as McpTransportWire[]).map((transport) => (
          <label key={transport}>
            <input
              type="radio"
              name={`${id}-transport`}
              checked={draft.transport === transport}
              onChange={() => controller.setEditorField("transport", transport)}
            />
            {settingsText(
              locale,
              transport === "stdio" ? "mcpTransportStdio" : "mcpTransportHttp",
            )}
          </label>
        ))}
      </fieldset>

      {draft.transport === "stdio" ? (
        <>
          {textField(
            "command",
            "mcpCommand",
            draft.command,
            (value) => controller.setEditorField("command", value),
            commandInvalid,
          )}
          <label className="dsh-mcp-field">
            <span>{settingsText(locale, "mcpArguments")}</span>
            <textarea
              value={draft.args.join("\n")}
              disabled={disabled}
              rows={3}
              onChange={(event) => controller.setEditorField(
                "args",
                event.currentTarget.value.split("\n"),
              )}
            />
          </label>
          {advancedOpen ? (
            <>
            <fieldset className="dsh-mcp-repeat" disabled={disabled}>
            <legend>{settingsText(locale, "mcpEnvironment")}</legend>
            {draft.env.map((entry, index) => (
              <div key={index}>
                <input
                  aria-label={formatSettingsText(locale, "mcpEnvName", {
                    index: index + 1,
                  })}
                  value={entry.name}
                  {...flag(`env-${index}`, entry.name === "")}
                  onChange={(event) => {
                    const env = structuredClone(draft.env);
                    env[index]!.name = event.currentTarget.value;
                    controller.setEditorField("env", env);
                  }}
                />
                <input
                  aria-label={formatSettingsText(locale, "mcpEnvValue", {
                    index: index + 1,
                  })}
                  value={entry.value}
                  onChange={(event) => {
                    const env = structuredClone(draft.env);
                    env[index]!.value = event.currentTarget.value;
                    controller.setEditorField("env", env);
                  }}
                />
                <button
                  type="button"
                  aria-label={formatSettingsText(locale, "mcpRemoveEnvironment", {
                    index: index + 1,
                  })}
                  onClick={() =>
                    controller.setEditorField(
                      "env",
                      draft.env.filter((_, current) => current !== index),
                    )}
                >
                  {settingsText(locale, "delete")}
                </button>
                {hint(`env-${index}`, entry.name === "")}
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                controller.setEditorField(
                  "env",
                  [...draft.env, { name: "", value: "" }],
                )}
            >
              {settingsText(locale, "mcpAddEnvironment")}
            </button>
          </fieldset>
          <p className="dsh-settings-hint">
            {settingsText(locale, "mcpEnvPlainText")}
          </p>
          {textField(
            "cwd",
            "mcpWorkingDirectory",
            draft.cwd,
            (value) => controller.setEditorField("cwd", value),
          )}
            </>
          ) : null}
        </>
      ) : (
        textField(
          "url",
          "mcpUrl",
          draft.url,
          (value) => controller.setEditorField("url", value),
          urlInvalid,
          "url",
        )
      )}

      <label className="dsh-mcp-field">
        <span>{settingsText(locale, "mcpAuthentication")}</span>
        <select
          value={draft.auth.kind}
          disabled={disabled}
          onChange={(event) => setAuth(event.currentTarget.value as McpAuthWire["kind"])}
        >
          <option value="none">{settingsText(locale, "mcpAuthNone")}</option>
          <option value="headers">{settingsText(locale, "mcpAuthHeaders")}</option>
          <option value="oauth">{settingsText(locale, "mcpAuthOAuth")}</option>
        </select>
      </label>

      {draft.auth.kind === "headers" ? (
        <fieldset className="dsh-mcp-repeat" disabled={disabled}>
          <legend>{settingsText(locale, "mcpAuthHeaders")}</legend>
          {draft.auth.headerNames.map((name, index) => (
            <div key={index}>
              <input
                aria-label={formatSettingsText(locale, "mcpHeaderName", {
                  index: index + 1,
                })}
                value={name}
                {...flag(`header-${index}`, name === "")}
                onChange={(event) => replaceHeaderName(index, event.currentTarget.value)}
              />
              <input
                type="password"
                autoComplete="new-password"
                aria-label={formatSettingsText(locale, "mcpHeaderValue", {
                  index: index + 1,
                })}
                aria-describedby={`${id}-secret-hint`}
                value={secrets[name] ?? ""}
                onChange={(event) => setSecret(name, event.currentTarget.value)}
              />
              <button
                type="button"
                aria-label={formatSettingsText(locale, "mcpRemoveHeader", {
                  index: index + 1,
                })}
                onClick={() => {
                  controller.stageSecret(name, "");
                  setSecrets((current) => {
                    const next = { ...current };
                    delete next[name];
                    return next;
                  });
                  controller.setEditorField("auth", {
                    kind: "headers",
                    headerNames: draft.auth.kind === "headers"
                      ? draft.auth.headerNames.filter((_, current) => current !== index)
                      : [],
                  });
                }}
              >
                {settingsText(locale, "delete")}
              </button>
              {hint(`header-${index}`, name === "")}
            </div>
          ))}
          <button
            type="button"
            onClick={() => controller.setEditorField("auth", {
              kind: "headers",
              headerNames: draft.auth.kind === "headers"
                ? [...draft.auth.headerNames, ""]
                : [""],
            })}
          >
            {settingsText(locale, "mcpAddHeader")}
          </button>
        </fieldset>
      ) : null}

      {draft.auth.kind === "oauth" ? (
        <div className="dsh-mcp-oauth-fields">
          {draft.transport !== "streamable-http" ? null : (
            <div className="dsh-mcp-discover">
              <p className="dsh-settings-hint">
                {settingsText(
                  locale,
                  oauthDiscovery === "available"
                    ? "mcpDiscoverOAuthHint"
                    : "mcpDiscoverUnavailable",
                )}
              </p>
              {oauthDiscovery === "unavailable" ? null : (
                <button
                  type="button"
                  disabled={disabled || snapshot.discovering}
                  onClick={() => controller.discoverOAuth()}
                >
                  {settingsText(
                    locale,
                    snapshot.discovering
                      ? "mcpDiscoveringOAuth"
                      : "mcpDiscoverOAuth",
                  )}
                </button>
              )}
              {snapshot.discoveryErrorKey === undefined ? null : (
                <p className="dsh-settings-error" role="alert">
                  {settingsText(locale, snapshot.discoveryErrorKey)}
                  {snapshot.discoveryErrorDetail === undefined
                    ? ""
                    : `: ${snapshot.discoveryErrorDetail}`}
                </p>
              )}
              {snapshot.discoveryNoticeKey === undefined ? null : (
                <p role="status">
                  {settingsText(locale, snapshot.discoveryNoticeKey)}
                </p>
              )}
            </div>
          )}
          {([
            ["clientId", "mcpClientId", "text"],
            ["authorizeUrl", "mcpAuthorizeUrl", "url"],
            ["tokenUrl", "mcpTokenUrl", "url"],
            ["redirectPath", "mcpRedirectPath", "text"],
          ] as const).map(([field, key, type]) => (
            <React.Fragment key={field}>
              {textField(
                `oauth-${field}`,
                key,
                draft.auth.kind === "oauth" ? draft.auth[field] : "",
                (value) => {
                  if (draft.auth.kind !== "oauth") return;
                  controller.setEditorField("auth", {
                    ...draft.auth,
                    [field]: value,
                  });
                },
                oauthInvalid(field),
                type,
              )}
            </React.Fragment>
          ))}
          {textField(
            "oauth-scopes",
            "mcpScopes",
            draft.auth.scopes.join(", "),
            (value) => {
              if (draft.auth.kind !== "oauth") return;
              controller.setEditorField("auth", {
                ...draft.auth,
                scopes: value.split(",").map((scope) => scope.trim()).filter(Boolean),
              });
            },
          )}
          <label className="dsh-mcp-field">
            <span>{settingsText(locale, "mcpClientSecret")}</span>
            <input
              type="password"
              autoComplete="new-password"
              value={secrets.OAUTH_CLIENT_SECRET ?? ""}
              disabled={disabled}
              aria-describedby={`${id}-secret-hint`}
              onChange={(event) =>
                setSecret("OAUTH_CLIENT_SECRET", event.currentTarget.value)}
            />
          </label>
          {oauthAuthorization === "unavailable" ? (
            <p className="dsh-mcp-oauth-note">
              {settingsText(locale, "mcpOAuthNote")}
            </p>
          ) : null}
        </div>
      ) : null}
      {draft.auth.kind === "none" ? null : (
        <p id={`${id}-secret-hint`} className="dsh-settings-hint">
          {settingsText(locale, "mcpSecretReadback")}
          {secretStates === "unavailable"
            ? ` ${settingsText(locale, "mcpSecretUnknown")}`
            : ""}
        </p>
      )}

      <button
        className="dsh-mcp-disclosure"
        type="button"
        aria-expanded={advancedOpen}
        onClick={() => setAdvancedOpen((open) => !open)}
      >
        {settingsText(locale, "mcpAdvanced")}
      </button>
      {!advancedOpen ? null : (
        <div className="dsh-mcp-advanced">
          {draft.auth.kind !== "oauth" || oauthOrigin === undefined ? null : (
            <p className="dsh-settings-hint">
              {settingsText(locale, "mcpOAuthLoopbackHint")}{" "}
              <code>{oauthOrigin}{draft.auth.redirectPath}</code>
            </p>
          )}
          {numberField(
            "timeout",
            "mcpToolTimeout",
            draft.toolCallTimeoutMs,
            (value) => controller.setEditorField("toolCallTimeoutMs", value),
            1,
            timeoutInvalid,
            "mcpFieldPositive",
          )}
          <fieldset className="dsh-mcp-reconnect" disabled={disabled}>
        <legend>{settingsText(locale, "mcpReconnectEnabled")}</legend>
        <label className="dsh-mcp-check">
          <input
            type="checkbox"
            checked={draft.reconnect.enabled}
            onChange={(event) => controller.setEditorField("reconnect", {
              ...draft.reconnect,
              enabled: event.currentTarget.checked,
            })}
          />
          {settingsText(locale, "mcpReconnectEnabled")}
        </label>
        {numberField(
          "reconnect-initial",
          "mcpReconnectInitial",
          draft.reconnect.initialDelayMs,
          (value) => controller.setEditorField("reconnect", {
            ...draft.reconnect,
            initialDelayMs: value,
          }),
          1,
          notPositive(draft.reconnect.initialDelayMs),
          "mcpFieldPositive",
        )}
        {numberField(
          "reconnect-maximum",
          "mcpReconnectMaximum",
          draft.reconnect.maxDelayMs,
          (value) => controller.setEditorField("reconnect", {
            ...draft.reconnect,
            maxDelayMs: value,
          }),
          1,
          notPositive(draft.reconnect.maxDelayMs),
          "mcpFieldPositive",
        )}
        {numberField(
          "reconnect-attempts",
          "mcpReconnectAttempts",
          draft.reconnect.maxAttempts,
          (value) => controller.setEditorField("reconnect", {
            ...draft.reconnect,
            maxAttempts: value,
          }),
          0,
          negative(draft.reconnect.maxAttempts),
          "mcpFieldNonNegative",
        )}
          </fieldset>
        </div>
      )}

      {draft.errorKey === undefined ? null : (
        <p className="dsh-settings-error" role="alert">
          {settingsText(locale, draft.errorKey)}
          {draft.errorDetail === undefined ? "" : `: ${draft.errorDetail}`}
        </p>
      )}
      {missingSecretNames.length > 0 ? (
        <div className="dsh-mcp-secret-request" role="status">
          <button
            type="button"
            onClick={() => {
              const request = controller.snapshot().secretRequest;
              if (
                request === undefined ||
                continuedEpochs.current.has(request.epoch)
              ) return;
              continuedEpochs.current.add(request.epoch);
              if (!controller.continueSecretSave(secretsRef.current)) {
                continuedEpochs.current.delete(request.epoch);
              }
            }}
          >
            {settingsText(locale, "mcpContinueSecrets")}
          </button>
          <button
            type="button"
            onClick={() => {
              if (controller.declineSecretSave()) controller.closeEditor();
            }}
          >
            {settingsText(locale, "mcpSkipSecrets")}
          </button>
        </div>
      ) : null}
      <div className="dsh-settings-actions">
        {!canProvision ? null : (
          <button
            type="button"
            disabled={!provisionReady}
            onClick={() => controller.provisionOAuth()}
          >
            {settingsText(
              locale,
              snapshot.authorizing
                ? busy
                  ? "mcpAuthorizing"
                  : "mcpWaitingAuthorization"
                : "mcpAddAndAuthorize",
            )}
          </button>
        )}
        {draft.secretFailure === undefined ? (
          <button type="submit" disabled={disabled || !valid}>
            {settingsText(locale, "save")}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || !snapshot.connected}
            onClick={() => controller.retrySecrets(secretsRef.current)}
          >
            {settingsText(locale, "mcpRetrySecrets")}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={closeEditor}
        >
          {settingsText(locale, "cancel")}
        </button>
      </div>
    </form>
    </SettingsNestedDialog>
  );
}

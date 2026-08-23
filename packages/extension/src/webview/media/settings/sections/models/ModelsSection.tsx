import React, {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import type {
  ModelsSettingsView,
  SetCredentialCommand,
  UnsetCredentialCommand,
} from "@dsh-vscode/contract";
import { SettingsConfirmation } from "../../SettingsConfirmation.js";
import { settingsText } from "../../localization/index.js";
import type { SettingsLocale } from "../../types.js";
import { CustomProviderCard } from "./CustomProviderCard.js";
import { ModelsController } from "./ModelsController.js";
import { ProviderEditor } from "./ProviderEditor.js";

interface ModelsSectionProps {
  controller: ModelsController;
  view: ModelsSettingsView;
  locale: SettingsLocale;
  onCredential(command: SetCredentialCommand | UnsetCredentialCommand): void;
  onConfirmationChange?(active: boolean): void;
}

export function ModelsSection({
  controller,
  view,
  locale,
  onCredential,
  onConfirmationChange,
}: ModelsSectionProps): JSX.Element {
  const [, render] = useReducer((value: number) => value + 1, 0);
  const [deleteId, setDeleteId] = useState<string>();
  const deleteTitleId = useId();
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteReturnFocusRef = useRef<HTMLButtonElement>();
  useEffect(() => controller.subscribe(() => render()), [controller]);
  useEffect(() => controller.updateView(view), [controller, view]);
  useEffect(() => {
    onConfirmationChange?.(deleteId !== undefined);
    return () => onConfirmationChange?.(false);
  }, [deleteId, onConfirmationChange]);
  const snapshot = controller.snapshot();

  const dismissDelete = (): void => {
    setDeleteId(undefined);
    deleteReturnFocusRef.current?.focus();
  };

  const choose = (id: string): void => {
    setDeleteId(undefined);
    controller.select(
      snapshot.activeCard === "edit" && snapshot.activeProviderId === id
        ? undefined
        : id,
    );
  };

  return (
    <section className="dsh-settings-models" aria-label={settingsText(locale, "models")}>
      <div className="dsh-models-list">
        {snapshot.providers.map((provider) => (
          <article className="dsh-models-card" key={provider.id}>
            <div className="dsh-models-card-copy">
              <h3>{provider.label}</h3>
              <p>{provider.id} · {provider.namespace}</p>
              <p>
                {provider.active
                  ? settingsText(locale, "modelsActive")
                  : settingsText(locale, "modelsDormant")}
                {" · "}
                {provider.catalog.kind === "ready"
                  ? settingsText(locale, "modelsCatalogReadyLabel")
                  : provider.catalog.kind === "dormant"
                    ? settingsText(locale, "modelsCatalogDormantLabel")
                    : provider.catalog.message}
              </p>
              <p>
                {provider.credentialStatus.kind === "failed"
                  ? provider.credentialStatus.message
                  : provider.credential?.set
                    ? settingsText(locale, "modelsCredentialConfigured")
                    : settingsText(locale, "modelsCredentialMissing")}
                {provider.credential?.source === undefined
                  ? null
                  : ` · ${provider.credential.source}`}
              </p>
            </div>
            <div className="dsh-models-card-actions">
              <button
                type="button"
                aria-label={`${settingsText(locale, "modelsEdit")} ${provider.label}`}
                onClick={() => choose(provider.id)}
              >
                {settingsText(locale, "modelsEdit")}
              </button>
              {provider.removable ? (
                <button
                  type="button"
                  aria-label={`${settingsText(locale, "delete")} ${provider.label}`}
                  onClick={(event) => {
                    deleteReturnFocusRef.current = event.currentTarget;
                    setDeleteId(provider.id);
                  }}
                >
                  {settingsText(locale, "delete")}
                </button>
              ) : null}
            </div>
            {snapshot.activeCard === "edit" &&
            snapshot.activeProviderId === provider.id ? (
              <ProviderEditor
                controller={controller}
                locale={locale}
                onCredential={onCredential}
              />
            ) : null}
          </article>
        ))}
      </div>
      {snapshot.activeCard === "directory" &&
      snapshot.addable.length > 0 ? (
        <div className="dsh-models-add">
          <label>
            <span>{settingsText(locale, "modelsProvider")}</span>
            <select
              aria-label={settingsText(locale, "modelsProvider")}
              value={snapshot.activeProviderId ?? snapshot.addable[0]?.id}
              onChange={(event) => controller.selectDirectory(event.target.value)}
            >
              {snapshot.addable.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
          <ProviderEditor
            controller={controller}
            locale={locale}
            onCredential={onCredential}
          />
        </div>
      ) : null}
      {snapshot.activeCard === "custom" ? (
        <CustomProviderCard
          controller={controller}
          locale={locale}
          onCredential={onCredential}
        />
      ) : null}
      <div className="dsh-settings-actions">
        <button
          type="button"
          disabled={!snapshot.writable || snapshot.addable.length === 0}
          onClick={() => controller.openDirectory()}
        >
          {settingsText(locale, "modelsAddProvider")}
        </button>
        <button
          type="button"
          disabled={!snapshot.customAvailable}
          onClick={() => controller.openCustom()}
        >
          {settingsText(locale, "modelsAddCustomProvider")}
        </button>
      </div>
      {deleteId === undefined ? null : (
        <SettingsConfirmation
          labelledBy={deleteTitleId}
          initialRef={deleteCancelRef}
          onEscape={dismissDelete}
        >
          <h4 id={deleteTitleId}>
            {settingsText(locale, "modelsDeleteTitle")}
          </h4>
          <p>{settingsText(locale, "modelsDeleteDetail")}</p>
          <button
            ref={deleteCancelRef}
            type="button"
            onClick={dismissDelete}
          >
            {settingsText(locale, "cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              controller.select(deleteId);
              if (controller.deleteSelected()) dismissDelete();
            }}
          >
            {settingsText(locale, "delete")}
          </button>
        </SettingsConfirmation>
      )}
    </section>
  );
}

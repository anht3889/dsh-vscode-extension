import React, { useEffect, useId, useRef } from "react";
import type { SettingsSectionId } from "@dsh-vscode/contract";
import { SettingsConfirmation } from "./SettingsConfirmation.js";
import { SettingsNav } from "./SettingsNav.js";
import { settingsText } from "./localization/index.js";
import type {
  SettingsControllerState,
  SettingsState,
  SettingsUiSectionId,
} from "./types.js";

export type SettingsCloseReason = "button" | "escape" | "gear" | "mask";

interface SettingsModalProps {
  state: SettingsState;
  controller?: SettingsControllerState;
  returnFocusRef?: React.RefObject<HTMLButtonElement>;
  children?: React.ReactNode;
  onSection(section: SettingsUiSectionId): void;
  onRetry?(section: SettingsSectionId): void;
  onRequestClose(reason: SettingsCloseReason, dirty: boolean): void;
  onCancelClose?(): void;
  onDiscardClose?(): void;
}

function isBridgeSection(
  section: SettingsUiSectionId,
): section is SettingsSectionId {
  return section !== "extension";
}

function isFocusableControl(element: HTMLElement): boolean {
  if (
    element.matches(":disabled") ||
    element.getAttribute("aria-disabled") === "true"
  ) {
    return false;
  }
  let current: HTMLElement | null = element;
  while (current !== null) {
    if (
      current.hidden ||
      current.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }
    const style = window.getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    ) {
      return false;
    }
    current = current.parentElement;
  }
  return true;
}

export function SettingsModal({
  state,
  controller,
  returnFocusRef,
  children,
  onSection,
  onRetry,
  onRequestClose,
  onCancelClose,
  onDiscardClose,
}: SettingsModalProps): JSX.Element {
  const titleId = useId();
  const dirtyTitleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dirtyCancelRef = useRef<HTMLButtonElement>(null);
  const confirmationReturnFocusRef = useRef<HTMLElement>();
  const closeBlocked =
    state.confirmation !== undefined || controller?.confirmation === true;
  const section = isBridgeSection(state.activeSection)
    ? state.sections[state.activeSection]
    : undefined;

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (state.confirmation?.kind === "dirty-close") {
      confirmationReturnFocusRef.current ??=
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : closeRef.current ?? undefined;
      dirtyCancelRef.current?.focus();
    } else if (confirmationReturnFocusRef.current !== undefined) {
      confirmationReturnFocusRef.current.focus();
      confirmationReturnFocusRef.current = undefined;
    }
  }, [state.confirmation]);

  useEffect(
    () => () => {
      returnFocusRef?.current?.focus();
    },
    [returnFocusRef],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        if (!closeBlocked) onRequestClose("escape", controller?.dirty === true);
        return;
      }
      if (event.key !== "Tab" || closeBlocked) return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable === undefined) return;
      const controls = [...focusable].filter(isFocusableControl);
      const first = controls[0];
      const last = controls.at(-1);
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeBlocked, controller?.dirty, onRequestClose]);

  return (
    <div className="dsh-settings-overlay" role="presentation">
      <div
        className="dsh-settings-mask"
        data-testid="settings-mask"
        aria-hidden="true"
        onPointerDown={() => {
          if (!closeBlocked) onRequestClose("mask", controller?.dirty === true);
        }}
      />
      <div
        ref={dialogRef}
        className="dsh-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="dsh-settings-header">
          <h2 id={titleId}>{settingsText(state.locale, "settingsTitle")}</h2>
          <button
            ref={closeRef}
            className="dsh-icon-button dsh-settings-close"
            type="button"
            aria-label={settingsText(state.locale, "closeSettings")}
            onClick={() => {
              if (!closeBlocked) {
                onRequestClose("button", controller?.dirty === true);
              }
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <SettingsNav
          active={state.activeSection}
          capabilities={state.capabilities}
          locale={state.locale}
          onSelect={onSection}
        />
        <main className="dsh-settings-content">
          {!state.connected && state.activeSection !== "extension" ? (
            <div className="dsh-settings-notice" role="alert">
              {section?.detail ?? settingsText(state.locale, "disconnected")}
            </div>
          ) : null}
          {state.restartRequired ? (
            <div className="dsh-settings-notice" role="status">
              {settingsText(state.locale, "restartRequired")}
            </div>
          ) : null}
          {section?.status === "loading" ? (
            <div className="dsh-settings-loading" aria-live="polite">
              {section.view === undefined
                ? settingsText(state.locale, "loading")
                : settingsText(state.locale, "refreshing")}
            </div>
          ) : null}
          {section?.status === "error" && state.connected ? (
            <div className="dsh-settings-notice" role="alert">
              <span>{section.detail}</span>
              {onRetry === undefined ? null : (
                <button
                  className="dsh-settings-retry"
                  type="button"
                  onClick={() => {
                    if (isBridgeSection(state.activeSection)) {
                      onRetry(state.activeSection);
                    }
                  }}
                >
                  {settingsText(state.locale, "retry")}
                </button>
              )}
            </div>
          ) : null}
          {children}
        </main>
        {state.confirmation?.kind === "dirty-close" ? (
          <SettingsConfirmation
            labelledBy={dirtyTitleId}
            initialRef={dirtyCancelRef}
            onEscape={() => onCancelClose?.()}
          >
            <h3 id={dirtyTitleId}>
              {settingsText(state.locale, "closeDirtyTitle")}
            </h3>
            <p>{settingsText(state.locale, "closeDirtyDetail")}</p>
            <div className="dsh-settings-confirmation-actions">
              <button
                ref={dirtyCancelRef}
                type="button"
                onClick={onCancelClose}
              >
                {settingsText(state.locale, "cancel")}
              </button>
              <button type="button" onClick={onDiscardClose}>
                {settingsText(state.locale, "discard")}
              </button>
            </div>
          </SettingsConfirmation>
        ) : null}
      </div>
    </div>
  );
}

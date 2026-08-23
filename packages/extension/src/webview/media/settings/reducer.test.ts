import { describe, expect, it } from "vitest";
import type {
  GeneralSettingsView,
  SettingsSectionMessage,
} from "@dsh-vscode/contract";
import {
  initialSettingsState,
  settingsReducer,
} from "./reducer.js";

const GENERAL: GeneralSettingsView = {
  section: "general",
  namespaces: [],
  agentPresets: [],
  permissionPresets: [],
};

function receive(
  requestId: string,
  view: GeneralSettingsView = GENERAL,
): SettingsSectionMessage {
  return { kind: "settingsSection", requestId, view };
}

describe("settingsReducer", () => {
  it("opens and closes without resetting the selected section or cached data", () => {
    const selected = settingsReducer(initialSettingsState, {
      kind: "activateSettingsSection",
      section: "models",
    });
    const opened = settingsReducer(selected, { kind: "openSettings" });
    const closed = settingsReducer(opened, { kind: "closeSettings" });

    expect(opened.open).toBe(true);
    expect(closed.open).toBe(false);
    expect(closed.activeSection).toBe("models");
    expect(closed.sections).toBe(opened.sections);
  });

  it("accepts only the response correlated to a section request", () => {
    const loading = settingsReducer(initialSettingsState, {
      kind: "settingsSectionRequested",
      section: "general",
      requestId: "new",
    });

    const stale = settingsReducer(loading, {
      kind: "settingsSectionReceived",
      message: receive("old"),
    });
    const ready = settingsReducer(stale, {
      kind: "settingsSectionReceived",
      message: receive("new"),
    });

    expect(stale).toBe(loading);
    expect(ready.sections.general).toMatchObject({
      status: "ready",
      view: GENERAL,
      stale: false,
      available: true,
    });
  });

  it("rejects a correlated response whose view names another section", () => {
    const loading = settingsReducer(initialSettingsState, {
      kind: "settingsSectionRequested",
      section: "general",
      requestId: "general",
    });
    const mismatched = settingsReducer(loading, {
      kind: "settingsSectionReceived",
      message: {
        kind: "settingsSection",
        requestId: "general",
        view: {
          section: "models",
          namespaces: [],
          providers: [],
          credentials: [],
        },
      },
    });

    expect(mismatched).toBe(loading);
  });

  it("correlates section errors and retains the last good view", () => {
    const firstLoading = settingsReducer(initialSettingsState, {
      kind: "settingsSectionRequested",
      section: "general",
      requestId: "first",
    });
    const ready = settingsReducer(firstLoading, {
      kind: "settingsSectionReceived",
      message: receive("first"),
    });
    const refreshing = settingsReducer(ready, {
      kind: "settingsSectionRequested",
      section: "general",
      requestId: "refresh",
    });
    const failed = settingsReducer(refreshing, {
      kind: "settingsSectionReceived",
      message: {
        kind: "settingsSection",
        requestId: "refresh",
        error: { code: "settings-unavailable", message: "Bridge unavailable" },
      },
    });

    expect(failed.sections.general).toMatchObject({
      status: "error",
      detail: "Bridge unavailable",
      view: GENERAL,
      available: false,
    });
  });

  it("marks invalidated views stale without discarding them", () => {
    const loading = settingsReducer(initialSettingsState, {
      kind: "settingsSectionRequested",
      section: "general",
      requestId: "general",
    });
    const ready = settingsReducer(loading, {
      kind: "settingsSectionReceived",
      message: receive("general"),
    });
    const stale = settingsReducer(ready, {
      kind: "settingsInvalidated",
      message: {
        kind: "settingsInvalidated",
        sections: ["general", "plugins"],
        reason: "document",
      },
    });

    expect(stale.sections.general).toMatchObject({
      status: "ready",
      view: GENERAL,
      stale: true,
    });
    expect(stale.sections.plugins.stale).toBe(true);
  });

  it("rejects a same request id after the connection epoch advances", () => {
    const loading = settingsReducer(initialSettingsState, {
      kind: "settingsSectionRequested",
      section: "general",
      requestId: "same",
    });
    const disconnected = settingsReducer(loading, {
      kind: "settingsDisconnected",
      detail: "lost",
    });
    const reconnected = settingsReducer(disconnected, { kind: "settingsConnected" });
    const late = settingsReducer(reconnected, {
      kind: "settingsSectionReceived",
      message: receive("same"),
    });

    expect(reconnected.connectionEpoch).toBe(1);
    expect(late).toBe(reconnected);
    expect(late.sections.general.status).not.toBe("ready");
  });

  it("keeps an in-flight response stale when invalidation arrives first", () => {
    const loading = settingsReducer(initialSettingsState, {
      kind: "settingsSectionRequested",
      section: "general",
      requestId: "general",
    });
    const invalidated = settingsReducer(loading, {
      kind: "settingsInvalidated",
      message: {
        kind: "settingsInvalidated",
        sections: ["general"],
        reason: "document",
      },
    });
    const received = settingsReducer(invalidated, {
      kind: "settingsSectionReceived",
      message: receive("general"),
    });

    expect(received.sections.general).toMatchObject({
      status: "ready",
      view: GENERAL,
      stale: true,
    });
  });

  it("preserves last-good views on disconnect and makes bridge sections unavailable", () => {
    const loading = settingsReducer(initialSettingsState, {
      kind: "settingsSectionRequested",
      section: "general",
      requestId: "general",
    });
    const ready = settingsReducer(loading, {
      kind: "settingsSectionReceived",
      message: receive("general"),
    });
    const disconnected = settingsReducer(ready, {
      kind: "settingsDisconnected",
      detail: "DSH stopped",
    });

    expect(disconnected.connected).toBe(false);
    expect(disconnected.open).toBe(false);
    expect(disconnected.sections.general).toMatchObject({
      status: "error",
      view: GENERAL,
      stale: true,
      available: false,
      detail: "DSH stopped",
    });
    expect(disconnected.sections.models.available).toBe(false);
  });

  it("keeps the modal open on disconnect when it was already open", () => {
    const opened = settingsReducer(initialSettingsState, { kind: "openSettings" });
    const disconnected = settingsReducer(opened, {
      kind: "settingsDisconnected",
      detail: "DSH stopped",
    });

    expect(disconnected.open).toBe(true);
  });

  it("marks bridge sections stale and available again on reconnect", () => {
    const disconnected = settingsReducer(initialSettingsState, {
      kind: "settingsDisconnected",
      detail: "DSH stopped",
    });
    const connected = settingsReducer(disconnected, { kind: "settingsConnected" });

    expect(connected.connected).toBe(true);
    expect(connected.sections.general).toMatchObject({
      stale: true,
      available: true,
    });
  });

  it("tracks locale, restart requirement, confirmation, and Extension selection", () => {
    const localized = settingsReducer(initialSettingsState, {
      kind: "settingsLocaleChanged",
      locale: "zh",
    });
    const restart = settingsReducer(localized, {
      kind: "settingsRestartRequired",
      required: true,
    });
    const confirmed = settingsReducer(restart, {
      kind: "settingsConfirmationChanged",
      confirmation: { kind: "dirty-close" },
    });
    const extension = settingsReducer(confirmed, {
      kind: "activateSettingsSection",
      section: "extension",
    });

    expect(extension.locale).toBe("zh");
    expect(extension.restartRequired).toBe(true);
    expect(extension.confirmation).toEqual({ kind: "dirty-close" });
    expect(extension.activeSection).toBe("extension");
  });
});

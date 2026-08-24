import { describe, expect, it } from "vitest";
import type {
  GeneralSettingsView,
  McpSettingsView,
  SettingsSectionMessage,
} from "@dsh-vscode/contract";
import {
  initialSettingsState,
  settingsReducer,
} from "./reducer.js";
import type { SettingsState } from "./types.js";

const GENERAL: GeneralSettingsView = {
  section: "general",
  namespaces: [],
  agentPresets: [],
  permissionPresets: [],
};

const MCP: McpSettingsView = {
  section: "mcp",
  servers: [],
  secretStates: "unavailable",
  oauth: {
    kind: "manual",
    reason: "no-callback-origin",
    discovery: "unavailable",
    authorization: "unavailable",
  },
};

function receive(
  requestId: string,
  view: GeneralSettingsView = GENERAL,
): SettingsSectionMessage {
  return { kind: "settingsSection", requestId, view };
}

describe("settingsReducer", () => {
  it("starts with unknown empty optional capabilities", () => {
    expect(initialSettingsState.capabilities).toEqual([]);
    expect(initialSettingsState.capabilitiesKnown).toBe(false);
  });

  it("records announced optional capabilities as known", () => {
    const received = settingsReducer(initialSettingsState, {
      kind: "settingsCapabilitiesReceived",
      message: {
        kind: "settingsCapabilities",
        requestId: "capabilities",
        sections: ["mcp"],
      },
    });

    expect(received.capabilities).toEqual(["mcp"]);
    expect(received.capabilitiesKnown).toBe(true);
    expect(received.sections.mcp.available).toBe(true);
    expect(received.sections["web-search"].available).toBe(false);
  });

  it("falls back to General and clears a removed active capability", () => {
    const active: SettingsState = {
      ...initialSettingsState,
      activeSection: "mcp" as const,
      capabilities: ["mcp"],
      capabilitiesKnown: true,
      sections: {
        ...initialSettingsState.sections,
        mcp: {
          status: "ready" as const,
          view: {
            section: "mcp" as const,
            servers: [],
            secretStates: "unavailable" as const,
            oauth: {
              kind: "manual" as const,
              reason: "no-callback-origin" as const,
              discovery: "unavailable" as const,
              authorization: "unavailable" as const,
            },
          },
          stale: false,
          available: true,
        },
      },
    };

    const removed = settingsReducer(active, {
      kind: "settingsCapabilitiesReceived",
      message: { kind: "settingsCapabilities", sections: [] },
    });

    expect(removed.activeSection).toBe("general");
    expect(removed.sections.mcp).toEqual({
      status: "idle",
      stale: false,
      available: false,
    });
  });

  it("preserves capabilities on disconnect while marking optional sections unavailable", () => {
    const capable = settingsReducer(initialSettingsState, {
      kind: "settingsCapabilitiesReceived",
      message: {
        kind: "settingsCapabilities",
        sections: ["mcp", "web-search"],
      },
    });

    const disconnected = settingsReducer(capable, {
      kind: "settingsDisconnected",
      detail: "lost",
    });

    expect(disconnected.capabilities).toEqual(["mcp", "web-search"]);
    expect(disconnected.capabilitiesKnown).toBe(true);
    expect(disconnected.sections.mcp.available).toBe(false);
    expect(disconnected.sections["web-search"].available).toBe(false);
  });

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

  it.each([
    ["mcp", "web-search"],
    ["web-search", "mcp"],
  ] as const)(
    "marks only %s stale when its own invalidation reason arrives",
    (invalidated, untouched) => {
      const capable = settingsReducer(initialSettingsState, {
        kind: "settingsCapabilitiesReceived",
        message: {
          kind: "settingsCapabilities",
          sections: ["mcp", "web-search"],
        },
      });
      const ready = settingsReducer(capable, {
        kind: "settingsInvalidated",
        message: {
          kind: "settingsInvalidated",
          sections: [invalidated],
          reason: invalidated,
        },
      });

      expect(ready.invalidationSeq).toBe(1);
      expect(ready.sections[invalidated].stale).toBe(true);
      expect(ready.sections[untouched].stale).toBe(false);
      expect(ready.sections.general.stale).toBe(false);
      expect(ready.sections.models.stale).toBe(false);
      expect(ready.sections.plugins.stale).toBe(false);
      expect(ready.sections["agent-presets"].stale).toBe(false);
    },
  );

  it("replaces the cached MCP view without touching its section state", () => {
    const cached: SettingsState = {
      ...initialSettingsState,
      capabilities: ["mcp"],
      capabilitiesKnown: true,
      sections: {
        ...initialSettingsState.sections,
        mcp: {
          status: "loading",
          requestId: "read-1",
          requestEpoch: 0,
          view: MCP,
          detail: "earlier failure",
          stale: true,
          available: true,
        },
      },
    };
    const synchronized: McpSettingsView = {
      ...MCP,
      servers: [{
        server: {
          id: "alpha",
          serverName: "Alpha",
          enabled: true,
          transport: "stdio",
          command: "alpha-mcp",
          auth: { kind: "none" },
          toolCallTimeoutMs: 30_000,
          reconnect: {
            enabled: true,
            initialDelayMs: 1_000,
            maxDelayMs: 30_000,
            maxAttempts: 5,
          },
          createdAt: "created",
          updatedAt: "updated",
        },
        status: { state: "connected", toolCount: 1, connectedAt: "now" },
        toolCount: 1,
        disabledToolCount: 0,
      }],
    };

    const next = settingsReducer(cached, {
      kind: "mcpViewSynchronized",
      view: synchronized,
    });

    expect(next.sections.mcp).toEqual({
      status: "loading",
      requestId: "read-1",
      requestEpoch: 0,
      view: synchronized,
      detail: "earlier failure",
      stale: true,
      available: true,
    });
  });

  it("ignores a synchronized MCP view while no view is cached", () => {
    const next = settingsReducer(initialSettingsState, {
      kind: "mcpViewSynchronized",
      view: MCP,
    });

    expect(next).toBe(initialSettingsState);
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

  it("reconnects only known capabilities and clears stale request state", () => {
    const capable = settingsReducer(initialSettingsState, {
      kind: "settingsCapabilitiesReceived",
      message: { kind: "settingsCapabilities", sections: ["mcp"] },
    });
    const generalLoading = settingsReducer(capable, {
      kind: "settingsSectionRequested",
      section: "general",
      requestId: "general-old",
    });
    const mcpLoading = settingsReducer(generalLoading, {
      kind: "settingsSectionRequested",
      section: "mcp",
      requestId: "mcp-loaded",
    });
    const mcpReady = settingsReducer(mcpLoading, {
      kind: "settingsSectionReceived",
      message: {
        kind: "settingsSection",
        requestId: "mcp-loaded",
        view: MCP,
      },
    });
    const mcpRefreshing = settingsReducer(mcpReady, {
      kind: "settingsSectionRequested",
      section: "mcp",
      requestId: "mcp-old",
    });
    const absentLoading = settingsReducer(mcpRefreshing, {
      kind: "settingsSectionRequested",
      section: "web-search",
      requestId: "web-search-old",
    });
    const disconnected = settingsReducer(absentLoading, {
      kind: "settingsDisconnected",
      detail: "lost",
    });

    const reconnected = settingsReducer(disconnected, {
      kind: "settingsConnected",
    });

    expect(reconnected.connectionEpoch).toBe(1);
    expect(reconnected.capabilities).toEqual(["mcp"]);
    expect(reconnected.capabilitiesKnown).toBe(true);
    expect(reconnected.sections.general).toEqual({
      status: "idle",
      stale: true,
      available: true,
    });
    expect(reconnected.sections.mcp).toEqual({
      status: "ready",
      view: MCP,
      stale: true,
      available: true,
    });
    expect(reconnected.sections["web-search"]).toEqual({
      status: "idle",
      stale: false,
      available: false,
    });

    const requested = settingsReducer(reconnected, {
      kind: "settingsSectionRequested",
      section: "general",
      requestId: "general-new",
    });
    expect(requested.sections.general).toMatchObject({
      status: "loading",
      requestId: "general-new",
      requestEpoch: 1,
      available: true,
    });
    expect(requested.sections["web-search"]).toBe(
      reconnected.sections["web-search"],
    );
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

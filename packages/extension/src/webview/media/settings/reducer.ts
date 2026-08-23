import type { SettingsSectionId } from "@dsh-vscode/contract";
import type {
  SettingsAction,
  SettingsSectionState,
  SettingsState,
} from "./types.js";

const SECTION_IDS: readonly SettingsSectionId[] = [
  "general",
  "models",
  "plugins",
  "agent-presets",
];

function idleSection(): SettingsSectionState {
  return {
    status: "idle",
    stale: false,
    available: true,
  };
}

export const initialSettingsState: SettingsState = {
  open: false,
  activeSection: "general",
  locale: "en",
  sections: {
    general: idleSection(),
    models: idleSection(),
    plugins: idleSection(),
    "agent-presets": idleSection(),
  },
  connected: true,
  connectionEpoch: 0,
  invalidationSeq: 0,
  restartRequired: false,
};

function updateSections(
  state: SettingsState,
  update: (section: SettingsSectionId, value: SettingsSectionState) => SettingsSectionState,
): SettingsState["sections"] {
  return {
    general: update("general", state.sections.general),
    models: update("models", state.sections.models),
    plugins: update("plugins", state.sections.plugins),
    "agent-presets": update("agent-presets", state.sections["agent-presets"]),
  };
}

export function settingsReducer(
  state: SettingsState,
  action: SettingsAction,
): SettingsState {
  switch (action.kind) {
    case "openSettings":
      return state.open ? state : { ...state, open: true };
    case "closeSettings":
      return state.open ? { ...state, open: false, confirmation: undefined } : state;
    case "activateSettingsSection":
      return state.activeSection === action.section
        ? state
        : { ...state, activeSection: action.section };
    case "settingsSectionRequested": {
      const current = state.sections[action.section];
      return {
        ...state,
        sections: {
          ...state.sections,
          [action.section]: {
            status: "loading",
            requestId: action.requestId,
            requestEpoch: state.connectionEpoch,
            ...(current.view === undefined ? {} : { view: current.view }),
            stale: false,
            available: state.connected,
          },
        },
      };
    }
    case "settingsSectionReceived": {
      const section = SECTION_IDS.find(
        (candidate) =>
          state.sections[candidate].status === "loading" &&
          state.sections[candidate].requestId === action.message.requestId,
      );
      if (section === undefined) return state;
      const current = state.sections[section];
      if (current.requestEpoch !== state.connectionEpoch) return state;
      if (
        action.message.view !== undefined &&
        action.message.view.section !== section
      ) {
        return state;
      }
      const received: SettingsSectionState =
        action.message.view !== undefined
          ? {
              status: "ready",
              view: action.message.view,
              stale: current.stale,
              available: true,
            }
          : {
              status: "error",
              ...(current.view === undefined ? {} : { view: current.view }),
              detail: action.message.error.message,
              stale: current.view !== undefined,
              available: action.message.error.code !== "settings-unavailable",
            };
      const locale =
        action.message.view?.section === "general"
          ? action.message.view.namespaces.find(
              (namespace) => namespace.namespace === "locale",
            )?.value.preference
          : undefined;
      return {
        ...state,
        ...(locale === "en" || locale === "zh" ? { locale } : {}),
        sections: { ...state.sections, [section]: received },
      };
    }
    case "settingsMutationReceived": {
      const namespace = action.message.result.ok
        ? action.message.result.namespace
        : undefined;
      if (namespace === undefined) {
        return { ...state, mutation: action.message };
      }
      const sections = updateSections(state, (_section, current) => {
        if (current.view === undefined || !("namespaces" in current.view)) {
          return current;
        }
        const index = current.view.namespaces.findIndex(
          (candidate) => candidate.namespace === namespace.namespace,
        );
        if (index < 0) return current;
        const namespaces = [...current.view.namespaces];
        namespaces[index] = namespace;
        return {
          ...current,
          view: { ...current.view, namespaces } as typeof current.view,
        };
      });
      const locale = namespace.namespace === "locale"
        ? namespace.value.preference
        : undefined;
      return {
        ...state,
        sections,
        mutation: action.message,
        ...(locale === "en" || locale === "zh" ? { locale } : {}),
      };
    }
    case "settingsInvalidated": {
      const invalidated = new Set(action.message.sections);
      return {
        ...state,
        invalidationSeq: state.invalidationSeq + 1,
        sections: updateSections(state, (section, current) =>
          invalidated.has(section) ? { ...current, stale: true } : current,
        ),
      };
    }
    case "settingsDisconnected":
      return {
        ...state,
        connected: false,
        sections: updateSections(state, (_section, current) => ({
          status: "error",
          ...(current.view === undefined ? {} : { view: current.view }),
          detail: action.detail,
          stale: true,
          available: false,
        })),
      };
    case "settingsConnected":
      return {
        ...state,
        connected: true,
        connectionEpoch: state.connectionEpoch + 1,
        sections: updateSections(state, (_section, current) =>
          current.view === undefined
            ? { status: "idle", stale: true, available: true }
            : {
                status: "ready",
                view: current.view,
                stale: true,
                available: true,
              },
        ),
      };
    case "settingsLocaleChanged":
      return state.locale === action.locale ? state : { ...state, locale: action.locale };
    case "settingsRestartRequired":
      return state.restartRequired === action.required
        ? state
        : { ...state, restartRequired: action.required };
    case "settingsConfirmationChanged":
      return { ...state, confirmation: action.confirmation };
  }
}

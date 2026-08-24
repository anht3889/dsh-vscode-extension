import type {
  McpSettingsView,
  OptionalSettingsSectionId,
  SettingsCapabilitiesMessage,
  SettingsInvalidatedMessage,
  SettingsMutationMessage,
  SettingsSectionId,
  SettingsSectionMessage,
  SettingsSectionView,
} from "@dsh-vscode/contract";

export type SettingsUiSectionId = SettingsSectionId | "extension";
export type SettingsLocale = "en" | "zh";

export interface SettingsConfirmation {
  kind: "dirty-close" | "destructive";
}

export interface SettingsSectionState {
  status: "idle" | "loading" | "ready" | "error";
  requestId?: string;
  requestEpoch?: number;
  view?: SettingsSectionView;
  detail?: string;
  stale: boolean;
  available: boolean;
}

export interface SettingsState {
  open: boolean;
  activeSection: SettingsUiSectionId;
  locale: SettingsLocale;
  sections: Record<SettingsSectionId, SettingsSectionState>;
  capabilities: OptionalSettingsSectionId[];
  capabilitiesKnown: boolean;
  connected: boolean;
  connectionEpoch: number;
  invalidationSeq: number;
  restartRequired: boolean;
  confirmation?: SettingsConfirmation;
  mutation?: SettingsMutationMessage;
}

/** State supplied by a section controller without coupling it to the shell. */
export interface SettingsControllerState {
  dirty: boolean;
  confirmation?: boolean;
}

export type SettingsAction =
  | { kind: "openSettings" }
  | { kind: "closeSettings" }
  | { kind: "activateSettingsSection"; section: SettingsUiSectionId }
  | {
      kind: "settingsSectionRequested";
      section: SettingsSectionId;
      requestId: string;
    }
  | { kind: "settingsSectionReceived"; message: SettingsSectionMessage }
  | { kind: "mcpViewSynchronized"; view: McpSettingsView }
  | {
      kind: "settingsCapabilitiesReceived";
      message: SettingsCapabilitiesMessage;
    }
  | { kind: "settingsMutationReceived"; message: SettingsMutationMessage }
  | { kind: "settingsInvalidated"; message: SettingsInvalidatedMessage }
  | { kind: "settingsDisconnected"; detail: string }
  | { kind: "settingsConnected" }
  | { kind: "settingsLocaleChanged"; locale: SettingsLocale }
  | { kind: "settingsRestartRequired"; required: boolean }
  | {
      kind: "settingsConfirmationChanged";
      confirmation?: SettingsConfirmation;
    };

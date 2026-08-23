import type {
  CopyAgentPresetCommand,
  DeleteAgentPresetCommand,
  MutateSettingsCommand,
  ReadAgentPresetCommand,
  ResolveSettingsPathCommand,
  SetCredentialCommand,
  SettingsSectionId,
  UnsetCredentialCommand,
} from "@dsh-vscode/contract";

/** Process-lifetime bridge surface for settings requests and invalidation. */
export interface SettingsCoordinator {
  getSection(requestId: string, section: SettingsSectionId): void;
  mutate(message: MutateSettingsCommand): void;
  setCredential(message: SetCredentialCommand): void;
  unsetCredential(message: UnsetCredentialCommand): void;
  copyPreset(message: CopyAgentPresetCommand): void;
  deletePreset(message: DeleteAgentPresetCommand): void;
  readPreset(message: ReadAgentPresetCommand): void;
  resolvePath(message: ResolveSettingsPathCommand): void;
  dispose(): void;
}

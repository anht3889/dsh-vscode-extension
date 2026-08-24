import type {
  CopyAgentPresetCommand,
  DeleteAgentPresetCommand,
  GetMcpLogsCommand,
  GetMcpServerCommand,
  MutateSettingsCommand,
  OptionalSettingsSectionId,
  ReadAgentPresetCommand,
  ResolveSettingsPathCommand,
  RunMcpOperationCommand,
  SetCredentialCommand,
  SetWebSearchConfigCommand,
  SettingsSectionId,
  UnsetCredentialCommand,
} from "@dsh-vscode/contract";

/** Process-lifetime bridge surface for settings requests and invalidation. */
export interface SettingsCoordinator {
  getCapabilities(requestId: string): void;
  capabilities(): OptionalSettingsSectionId[];
  getSection(requestId: string, section: SettingsSectionId): void;
  getMcpServer(message: GetMcpServerCommand): void;
  getMcpLogs(message: GetMcpLogsCommand): void;
  runMcpOperation(message: RunMcpOperationCommand): void;
  mutate(message: MutateSettingsCommand): void;
  setWebSearchConfig(message: SetWebSearchConfigCommand): void;
  setCredential(message: SetCredentialCommand): void;
  unsetCredential(message: UnsetCredentialCommand): void;
  copyPreset(message: CopyAgentPresetCommand): void;
  deletePreset(message: DeleteAgentPresetCommand): void;
  readPreset(message: ReadAgentPresetCommand): void;
  resolvePath(message: ResolveSettingsPathCommand): void;
  dispose(): void;
}

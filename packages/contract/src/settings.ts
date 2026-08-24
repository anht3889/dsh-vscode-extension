export type SettingsSectionId =
  | "general"
  | "models"
  | "plugins"
  | "agent-presets"
  | "mcp"
  | "web-search";

export type OptionalSettingsSectionId = "mcp" | "web-search";
export const OPTIONAL_SETTINGS_SECTION_IDS: readonly OptionalSettingsSectionId[] =
  ["mcp", "web-search"];

export const MAX_MCP_SERVERS = 64;
export const MAX_MCP_TOOLS = 256;
export const MAX_MCP_LOG_ENTRIES = 512;
export const MAX_MCP_ARGS = 64;
export const MAX_MCP_ENV_ENTRIES = 64;
export const MAX_MCP_HEADER_NAMES = 32;
export const MAX_MCP_SCOPES = 32;
export const MAX_MCP_DISABLED_TOOLS = 256;
export const MAX_MCP_SECRET_ENTRIES = 32;
export const MAX_WIRE_IDENTIFIER_LENGTH = 1_024;
export const MAX_WIRE_URL_LENGTH = 2_048;
export const MAX_MCP_LOG_MESSAGE_LENGTH = 2_048;
export const MAX_MCP_LOG_DETAIL_LENGTH = 4_096;
export const MAX_SECRET_VALUE_LENGTH = 8_192;

export type SettingsPathOpWire =
  | { op: "set"; path: string[]; value: unknown }
  | { op: "unset"; path: string[] };

export interface SettingsNamespaceWire {
  namespace: string;
  revision: number;
  applies: "live" | "restart";
  writable: boolean;
  base: Record<string, unknown>;
  user: Record<string, unknown>;
  value: Record<string, unknown>;
  secrets: { path: string[]; set: boolean }[];
}

export interface SettingsErrorWire {
  code:
    | "settings-unavailable"
    | "settings-rejected"
    | "settings-conflict"
    | "credentials-rejected"
    | "preset-rejected"
    | "mcp-rejected"
    | "web-search-rejected"
    | "cancelled"
    | "internal";
  message: string;
  namespace?: string;
  currentRevision?: number;
}

export interface CredentialStateWire {
  ref: string;
  set: boolean;
  source?: string;
  writable: boolean;
}

export interface SettingsFieldWire {
  path: string[];
  label: string;
  kind: "string" | "number" | "boolean" | "credential-ref" | "union";
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
}

export type ModelCatalogStatusWire =
  | { kind: "dormant" }
  | { kind: "ready" }
  | { kind: "failed"; message: string };

export type CredentialMetadataStatusWire =
  | { kind: "none" }
  | { kind: "ready" }
  | { kind: "failed"; message: string };

export interface ModelProviderSettingsWire {
  id: string;
  namespace: string;
  label: string;
  active: boolean;
  declared?: boolean;
  catalog: ModelCatalogStatusWire;
  api?: string;
  baseURL?: string;
  credential?: CredentialStateWire;
  credentialStatus: CredentialMetadataStatusWire;
  models: { id: string; label: string; contextWindow?: number }[];
  removable: boolean;
  fields: SettingsFieldWire[];
}

export interface ConfigurablePluginWire {
  namespace: string;
  label: string;
  fields: SettingsFieldWire[];
  credential?: CredentialStateWire;
  credentialStatus?: CredentialMetadataStatusWire;
}

export interface PluginInventoryItemWire {
  entryId: string;
  moduleName: string;
  enabled: boolean;
  fiberPhase:
    | "pending"
    | "loading"
    | "active"
    | "failed"
    | "unloading"
    | null;
}

export interface AgentPresetSettingsItemWire {
  id: string;
  trust: "system" | "user";
  name?: string;
  description?: string;
  broken?: string;
  removable: boolean;
  openable: boolean;
}

export type McpTransportWire = "stdio" | "streamable-http";

export type McpAuthWire =
  | { kind: "none" }
  | { kind: "headers"; headerNames: string[] }
  | {
      kind: "oauth";
      clientId: string;
      authorizeUrl: string;
      tokenUrl: string;
      scopes: string[];
      redirectPath: string;
    };

export interface McpServerWire {
  id: string;
  serverName: string;
  enabled: boolean;
  transport: McpTransportWire;
  command?: string;
  args?: string[];
  env?: { name: string; value: string }[];
  cwd?: string;
  url?: string;
  auth: McpAuthWire;
  disabledTools?: string[];
  toolCallTimeoutMs: number;
  reconnect: {
    enabled: boolean;
    initialDelayMs: number;
    maxDelayMs: number;
    maxAttempts: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface McpServerInputWire {
  serverId?: string;
  serverName: string;
  enabled: boolean;
  transport: McpTransportWire;
  command?: string;
  args?: string[];
  env?: { name: string; value: string }[];
  cwd?: string;
  url?: string;
  auth: McpAuthWire;
  toolCallTimeoutMs: number;
  reconnect: {
    enabled: boolean;
    initialDelayMs: number;
    maxDelayMs: number;
    maxAttempts: number;
  };
}

export type McpStatusWire =
  | { state: "disconnected" }
  | { state: "connecting"; attempt: number }
  | { state: "connected"; toolCount: number; connectedAt: string }
  | { state: "reconnecting"; attempt: number; nextDelayMs: number }
  | { state: "failed"; error: string; at: string };

export type McpSecretStateWire =
  | { kind: "known"; secrets: { name: string; configured: boolean }[] }
  | { kind: "unknown" };

export interface McpServerListItemWire {
  server: McpServerWire;
  status: McpStatusWire;
  toolCount: number;
  disabledToolCount: number;
}

export interface McpToolWire {
  name: string;
  description: string;
  enabled: boolean;
}

export interface McpServerDetailWire {
  server: McpServerWire;
  status: McpStatusWire;
  tools: McpToolWire[];
  secrets: McpSecretStateWire;
}

export interface McpLogEntryWire {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
}

export type McpOAuthSupportWire =
  | { kind: "manual"; reason: "no-callback-origin" };

export interface McpSettingsView {
  section: "mcp";
  servers: McpServerListItemWire[];
  secretStates: "available" | "unavailable";
  oauth: McpOAuthSupportWire;
}

export type WebSearchEngineWire = "tavily" | "brave" | "searxng";
export type WebSearchSecretRefWire = "TAVILY_API_KEY" | "BRAVE_API_KEY";

export interface WebSearchCatalogWire {
  engine: WebSearchEngineWire | null;
  engines: { engine: WebSearchEngineWire; baseURL?: string }[];
}

export interface WebSearchEngineWireInfo {
  engine: WebSearchEngineWire;
  baseURL?: string;
  defaultBaseURL?: string;
  baseURLRequired: boolean;
  secretRef?: WebSearchSecretRefWire;
}

export interface WebSearchSecretStateWire {
  ref: WebSearchSecretRefWire;
  configured: boolean;
  writable: boolean;
}

export interface WebSearchSettingsView {
  section: "web-search";
  engine: WebSearchEngineWire | null;
  engines: WebSearchEngineWireInfo[];
  secrets: WebSearchSecretStateWire[];
  available: boolean;
}

export interface GeneralSettingsView {
  section: "general";
  namespaces: SettingsNamespaceWire[];
  agentPresets: { id: string; label: string; trust: "system" | "user" }[];
  permissionPresets: { id: string; label: string; dangerous: boolean }[];
}

export interface ModelsSettingsView {
  section: "models";
  namespaces: SettingsNamespaceWire[];
  providers: ModelProviderSettingsWire[];
  credentials: CredentialStateWire[];
}

export interface PluginsSettingsView {
  section: "plugins";
  namespaces: SettingsNamespaceWire[];
  configurable: ConfigurablePluginWire[];
  inventory: PluginInventoryItemWire[];
}

export interface AgentPresetsSettingsView {
  section: "agent-presets";
  namespace?: SettingsNamespaceWire;
  presets: AgentPresetSettingsItemWire[];
}

export type SettingsSectionView =
  | GeneralSettingsView
  | ModelsSettingsView
  | PluginsSettingsView
  | AgentPresetsSettingsView
  | McpSettingsView
  | WebSearchSettingsView;

export interface GetSettingsSectionCommand {
  kind: "getSettingsSection";
  requestId: string;
  section: SettingsSectionId;
}

export interface GetSettingsCapabilitiesCommand {
  kind: "getSettingsCapabilities";
  requestId: string;
}

export interface GetMcpServerCommand {
  kind: "getMcpServer";
  requestId: string;
  serverId: string;
}

export interface GetMcpLogsCommand {
  kind: "getMcpLogs";
  requestId: string;
  serverId: string;
  after?: number;
}

export type McpOperationWire =
  | { kind: "upsertServer"; server: McpServerInputWire }
  | { kind: "removeServer"; serverId: string }
  | { kind: "setServerEnabled"; serverId: string; enabled: boolean }
  | { kind: "connectServer"; serverId: string }
  | { kind: "disconnectServer"; serverId: string }
  | { kind: "setToolEnabled"; serverId: string; toolName: string; enabled: boolean }
  | { kind: "setServerSecrets"; serverId: string; secrets: { name: string; value: string }[] }
  | { kind: "clearOAuthTokens"; serverId: string };

export interface RunMcpOperationCommand {
  kind: "runMcpOperation";
  requestId: string;
  operation: McpOperationWire;
}

export interface SetWebSearchConfigCommand {
  kind: "setWebSearchConfig";
  requestId: string;
  catalog: WebSearchCatalogWire;
  secrets: { ref: WebSearchSecretRefWire; value: string }[];
}

export interface MutateSettingsCommand {
  kind: "mutateSettings";
  requestId: string;
  namespace: string;
  expectedRevision: number;
  ops: SettingsPathOpWire[];
}

export interface SetCredentialCommand {
  kind: "setCredential";
  requestId: string;
  ref: string;
  value: string;
}

export interface UnsetCredentialCommand {
  kind: "unsetCredential";
  requestId: string;
  ref: string;
}

export interface CopyAgentPresetCommand {
  kind: "copyAgentPreset";
  requestId: string;
  fromPresetId: string;
  presetId: string;
  name: string;
}

export interface DeleteAgentPresetCommand {
  kind: "deleteAgentPreset";
  requestId: string;
  presetId: string;
}

export interface ReadAgentPresetCommand {
  kind: "readAgentPreset";
  requestId: string;
  presetId: string;
}

export type ResolveSettingsPathTargetWire =
  | { kind: "dsh-home" }
  | { kind: "settings-document"; prepare: boolean }
  | { kind: "agent-preset"; presetId: string };

export interface ResolveSettingsPathCommand {
  kind: "resolveSettingsPath";
  requestId: string;
  target: ResolveSettingsPathTargetWire;
}

export type SettingsInboundCommand =
  | GetSettingsSectionCommand
  | GetSettingsCapabilitiesCommand
  | GetMcpServerCommand
  | GetMcpLogsCommand
  | RunMcpOperationCommand
  | SetWebSearchConfigCommand
  | MutateSettingsCommand
  | SetCredentialCommand
  | UnsetCredentialCommand
  | CopyAgentPresetCommand
  | DeleteAgentPresetCommand
  | ReadAgentPresetCommand
  | ResolveSettingsPathCommand;

export type SettingsSectionMessage =
  | {
      kind: "settingsSection";
      requestId: string;
      view: SettingsSectionView;
      error?: never;
    }
  | {
      kind: "settingsSection";
      requestId: string;
      error: SettingsErrorWire;
      view?: never;
    };

export interface SettingsMutationMessage {
  kind: "settingsMutation";
  requestId: string;
  result:
    | { ok: true; namespace?: SettingsNamespaceWire; restartRequired?: boolean }
    | { ok: false; error: SettingsErrorWire };
}

export type SettingsInvalidationReason =
  | "document"
  | "credentials"
  | "models"
  | "plugins"
  | "presets"
  | "mcp"
  | "web-search";

export interface SettingsInvalidatedMessage {
  kind: "settingsInvalidated";
  sections: SettingsSectionId[];
  reason: SettingsInvalidationReason;
}

export interface AgentPresetContentMessage {
  kind: "agentPresetContent";
  requestId: string;
  result:
    | { ok: true; presetId: string; trust: "system" | "user"; content: string }
    | { ok: false; error: SettingsErrorWire };
}

export interface SettingsPathMessage {
  kind: "settingsPath";
  requestId: string;
  result:
    | { ok: true; path: string; target: ResolveSettingsPathTargetWire["kind"] }
    | { ok: false; error: SettingsErrorWire };
}

export interface SettingsCapabilitiesMessage {
  kind: "settingsCapabilities";
  requestId?: string;
  sections: OptionalSettingsSectionId[];
}

export interface McpServerMessage {
  kind: "mcpServer";
  requestId: string;
  result:
    | { ok: true; detail: McpServerDetailWire }
    | { ok: false; error: SettingsErrorWire };
}

export interface McpLogsMessage {
  kind: "mcpLogs";
  requestId: string;
  result:
    | { ok: true; serverId: string; next: number; entries: McpLogEntryWire[] }
    | { ok: false; error: SettingsErrorWire };
}

export interface McpOperationMessage {
  kind: "mcpOperation";
  requestId: string;
  result:
    | { ok: true; detail?: McpServerDetailWire }
    | { ok: false; error: SettingsErrorWire };
}

export interface WebSearchMutationMessage {
  kind: "webSearchMutation";
  requestId: string;
  result:
    | {
        ok: true;
        view: WebSearchSettingsView;
        secretFailures: { ref: WebSearchSecretRefWire; message: string }[];
      }
    | { ok: false; error: SettingsErrorWire };
}

export type SettingsOutboundMessage =
  | SettingsSectionMessage
  | SettingsMutationMessage
  | SettingsInvalidatedMessage
  | AgentPresetContentMessage
  | SettingsPathMessage
  | SettingsCapabilitiesMessage
  | McpServerMessage
  | McpLogsMessage
  | McpOperationMessage
  | WebSearchMutationMessage;

const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = [
  "general", "models", "plugins", "agent-presets", "mcp", "web-search",
];

const SETTINGS_ERROR_CODES = [
  "settings-unavailable",
  "settings-rejected",
  "settings-conflict",
  "credentials-rejected",
  "preset-rejected",
  "mcp-rejected",
  "web-search-rejected",
  "cancelled",
  "internal",
] as const;

const INVALIDATION_REASONS = [
  "document",
  "credentials",
  "models",
  "plugins",
  "presets",
  "mcp",
  "web-search",
] as const;

const FIBER_PHASES = [
  "pending",
  "loading",
  "active",
  "failed",
  "unloading",
  null,
] as const;

const FIELD_KINDS = [
  "string",
  "number",
  "boolean",
  "credential-ref",
  "union",
] as const;

const PATH_TARGET_KINDS = [
  "dsh-home",
  "settings-document",
  "agent-preset",
] as const;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Defense-in-depth: known credential-value field names outside closed schemas. */
const CREDENTIAL_VALUE_FIELD_NAMES = new Set([
  "credentialValue",
  "secretValue",
  "secret",
  "apiKey",
  "token",
  "password",
]);

const KEBAB_NAMESPACE = /^[a-z][a-z0-9-]*$/;
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;

/** Bounds for recursive wire payload scans; exceed → fail closed. */
const MAX_WIRE_SCAN_DEPTH = 32;
/**
 * The largest producer payload is a maximal MCP list view: 36,874 nodes
 * including its three-node message envelope. The bridge caps that view at
 * 40,960 nodes, below this 65,536-node scan budget. The Models view is the
 * second-largest producer at about 26,000 nodes.
 */
const MAX_WIRE_SCAN_NODES = 65_536;

/**
 * Node budget the credential-leak and prototype-pollution scans allow per message.
 * Producers must keep every emitted payload below it; a larger payload is rejected.
 */
export const SETTINGS_WIRE_SCAN_NODE_LIMIT = MAX_WIRE_SCAN_NODES;

export const SETTINGS_INBOUND_KINDS = [
  "getSettingsSection",
  "getSettingsCapabilities",
  "getMcpServer",
  "getMcpLogs",
  "runMcpOperation",
  "setWebSearchConfig",
  "mutateSettings",
  "setCredential",
  "unsetCredential",
  "copyAgentPreset",
  "deleteAgentPreset",
  "readAgentPreset",
  "resolveSettingsPath",
] as const;

export const SETTINGS_OUTBOUND_KINDS = [
  "settingsSection",
  "settingsCapabilities",
  "mcpServer",
  "mcpLogs",
  "mcpOperation",
  "webSearchMutation",
  "settingsMutation",
  "settingsInvalidated",
  "agentPresetContent",
  "settingsPath",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasOwnKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  return required.every((key) => Object.hasOwn(value, key));
}

function shellHasNoForbiddenKeys(value: Record<string, unknown>): boolean {
  return !Object.keys(value).some((key) => FORBIDDEN_KEYS.has(key));
}

function isClosedRecord(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = [],
): value is Record<string, unknown> {
  return isRecord(value)
    && shellHasNoForbiddenKeys(value)
    && hasOnlyKeys(value, allowed)
    && hasOwnKeys(value, required);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonEmptyRequestId(value: unknown): value is string {
  return isNonEmptyString(value);
}

function isKebabCaseNamespace(value: unknown): value is string {
  return typeof value === "string" && KEBAB_NAMESPACE.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value > 0;
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

function isBoundedNonEmptyString(value: unknown, max: number): value is string {
  return isNonEmptyString(value) && value.length <= max;
}

function isBoundedArray<T>(
  value: unknown,
  max: number,
  item: (candidate: unknown) => candidate is T,
): value is T[] {
  return Array.isArray(value) && value.length <= max && value.every(item);
}

function isCredentialRef(value: unknown): value is string {
  return typeof value === "string" && CREDENTIAL_REF.test(value);
}

function isPresetId(value: unknown): value is string {
  return typeof value === "string" && PRESET_ID.test(value);
}

function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === "string"
    && (SETTINGS_SECTION_IDS as readonly string[]).includes(value);
}

function isOptionalSettingsSectionId(value: unknown): value is OptionalSettingsSectionId {
  return typeof value === "string"
    && (OPTIONAL_SETTINGS_SECTION_IDS as readonly string[]).includes(value);
}

function isMcpTransportWire(value: unknown): value is McpTransportWire {
  return value === "stdio" || value === "streamable-http";
}

function isWebSearchEngineWire(value: unknown): value is WebSearchEngineWire {
  return value === "tavily" || value === "brave" || value === "searxng";
}

function isWebSearchSecretRefWire(value: unknown): value is WebSearchSecretRefWire {
  return value === "TAVILY_API_KEY" || value === "BRAVE_API_KEY";
}

function isMcpEnvEntryWire(
  value: unknown,
): value is { name: string; value: string } {
  return isClosedRecord(value, ["name", "value"], ["name", "value"])
    && isBoundedNonEmptyString(value.name, MAX_WIRE_IDENTIFIER_LENGTH)
    && isBoundedString(value.value, MAX_SECRET_VALUE_LENGTH);
}

function isMcpReconnectWire(value: unknown): value is McpServerWire["reconnect"] {
  if (!isClosedRecord(value, [
    "enabled", "initialDelayMs", "maxDelayMs", "maxAttempts",
  ], [
    "enabled", "initialDelayMs", "maxDelayMs", "maxAttempts",
  ])) return false;
  return typeof value.enabled === "boolean"
    && isPositiveInteger(value.initialDelayMs)
    && isPositiveInteger(value.maxDelayMs)
    && isNonNegativeInteger(value.maxAttempts);
}

function isMcpAuthWire(value: unknown): value is McpAuthWire {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "none":
      return isClosedRecord(value, ["kind"], ["kind"]);
    case "headers":
      return isClosedRecord(value, ["kind", "headerNames"], ["kind", "headerNames"])
        && isBoundedArray(
          value.headerNames,
          MAX_MCP_HEADER_NAMES,
          (entry): entry is string => (
            isBoundedNonEmptyString(entry, MAX_WIRE_IDENTIFIER_LENGTH)
          ),
        );
    case "oauth":
      return isClosedRecord(value, [
        "kind", "clientId", "authorizeUrl", "tokenUrl", "scopes", "redirectPath",
      ], [
        "kind", "clientId", "authorizeUrl", "tokenUrl", "scopes", "redirectPath",
      ])
        && isBoundedNonEmptyString(value.clientId, MAX_WIRE_IDENTIFIER_LENGTH)
        && isBoundedNonEmptyString(value.authorizeUrl, MAX_WIRE_URL_LENGTH)
        && isBoundedNonEmptyString(value.tokenUrl, MAX_WIRE_URL_LENGTH)
        && isBoundedArray(
          value.scopes,
          MAX_MCP_SCOPES,
          (entry): entry is string => (
            isBoundedNonEmptyString(entry, MAX_WIRE_IDENTIFIER_LENGTH)
          ),
        )
        && isBoundedNonEmptyString(value.redirectPath, MAX_WIRE_IDENTIFIER_LENGTH);
    default:
      return false;
  }
}

function hasValidMcpTransportFields(value: Record<string, unknown>): boolean {
  if (value.transport === "stdio") {
    return isBoundedNonEmptyString(value.command, MAX_WIRE_IDENTIFIER_LENGTH)
      && value.url === undefined;
  }
  return value.transport === "streamable-http"
    && isBoundedNonEmptyString(value.url, MAX_WIRE_URL_LENGTH)
    && value.command === undefined
    && value.args === undefined
    && value.env === undefined
    && value.cwd === undefined;
}

function hasValidMcpServerFields(value: Record<string, unknown>): boolean {
  if (!isBoundedNonEmptyString(value.serverName, MAX_WIRE_IDENTIFIER_LENGTH)) return false;
  if (typeof value.enabled !== "boolean" || !isMcpTransportWire(value.transport)) return false;
  if (!hasValidMcpTransportFields(value)) return false;
  if (
    value.args !== undefined
    && !isBoundedArray(
      value.args,
      MAX_MCP_ARGS,
      (entry): entry is string => isBoundedString(entry, MAX_WIRE_IDENTIFIER_LENGTH),
    )
  ) return false;
  if (
    value.env !== undefined
    && !isBoundedArray(value.env, MAX_MCP_ENV_ENTRIES, isMcpEnvEntryWire)
  ) return false;
  if (
    value.cwd !== undefined
    && !isBoundedString(value.cwd, MAX_WIRE_IDENTIFIER_LENGTH)
  ) return false;
  return isMcpAuthWire(value.auth)
    && isPositiveInteger(value.toolCallTimeoutMs)
    && isMcpReconnectWire(value.reconnect);
}

function isMcpServerWire(value: unknown): value is McpServerWire {
  if (!isClosedRecord(value, [
    "id", "serverName", "enabled", "transport", "command", "args", "env", "cwd",
    "url", "auth", "disabledTools", "toolCallTimeoutMs", "reconnect", "createdAt",
    "updatedAt",
  ], [
    "id", "serverName", "enabled", "transport", "auth", "toolCallTimeoutMs",
    "reconnect", "createdAt", "updatedAt",
  ])) return false;
  if (!isBoundedNonEmptyString(value.id, MAX_WIRE_IDENTIFIER_LENGTH)) return false;
  if (!hasValidMcpServerFields(value)) return false;
  if (
    value.disabledTools !== undefined
    && !isBoundedArray(
      value.disabledTools,
      MAX_MCP_DISABLED_TOOLS,
      (entry): entry is string => (
        isBoundedNonEmptyString(entry, MAX_WIRE_IDENTIFIER_LENGTH)
      ),
    )
  ) return false;
  return isBoundedNonEmptyString(value.createdAt, MAX_WIRE_IDENTIFIER_LENGTH)
    && isBoundedNonEmptyString(value.updatedAt, MAX_WIRE_IDENTIFIER_LENGTH);
}

/**
 * Acceptance predicate for an `upsertServer` record, exported so a producer can
 * test a candidate before sending it. `isMcpOperationWire` applies this same
 * function, so a record this accepts is a record the host relay forwards.
 * @param value candidate record, from any origin.
 * @returns `true` when the record is a valid `McpServerInputWire`.
 */
export function isMcpServerInputWire(value: unknown): value is McpServerInputWire {
  if (!isClosedRecord(value, [
    "serverId", "serverName", "enabled", "transport", "command", "args", "env",
    "cwd", "url", "auth", "toolCallTimeoutMs", "reconnect",
  ], [
    "serverName", "enabled", "transport", "auth", "toolCallTimeoutMs", "reconnect",
  ])) return false;
  if (
    value.serverId !== undefined
    && !isBoundedNonEmptyString(value.serverId, MAX_WIRE_IDENTIFIER_LENGTH)
  ) return false;
  return hasValidMcpServerFields(value);
}

function isMcpStatusWire(value: unknown): value is McpStatusWire {
  if (!isRecord(value) || typeof value.state !== "string") return false;
  switch (value.state) {
    case "disconnected":
      return isClosedRecord(value, ["state"], ["state"]);
    case "connecting":
      return isClosedRecord(value, ["state", "attempt"], ["state", "attempt"])
        && isNonNegativeInteger(value.attempt);
    case "connected":
      return isClosedRecord(value, [
        "state", "toolCount", "connectedAt",
      ], [
        "state", "toolCount", "connectedAt",
      ])
        && isNonNegativeInteger(value.toolCount)
        && isBoundedNonEmptyString(value.connectedAt, MAX_WIRE_IDENTIFIER_LENGTH);
    case "reconnecting":
      return isClosedRecord(value, [
        "state", "attempt", "nextDelayMs",
      ], [
        "state", "attempt", "nextDelayMs",
      ])
        && isNonNegativeInteger(value.attempt)
        && isNonNegativeInteger(value.nextDelayMs);
    case "failed":
      return isClosedRecord(value, ["state", "error", "at"], ["state", "error", "at"])
        && isBoundedNonEmptyString(value.error, MAX_MCP_LOG_DETAIL_LENGTH)
        && isBoundedNonEmptyString(value.at, MAX_WIRE_IDENTIFIER_LENGTH);
    default:
      return false;
  }
}

function isMcpToolWire(value: unknown): value is McpToolWire {
  return isClosedRecord(value, ["name", "description", "enabled"], [
    "name", "description", "enabled",
  ])
    && isBoundedNonEmptyString(value.name, MAX_WIRE_IDENTIFIER_LENGTH)
    && isBoundedString(value.description, MAX_MCP_LOG_DETAIL_LENGTH)
    && typeof value.enabled === "boolean";
}

function isMcpSecretStateWire(value: unknown): value is McpSecretStateWire {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "unknown") {
    return isClosedRecord(value, ["kind"], ["kind"]);
  }
  if (value.kind !== "known") return false;
  return isClosedRecord(value, ["kind", "secrets"], ["kind", "secrets"])
    && isBoundedArray(
      value.secrets,
      MAX_MCP_SECRET_ENTRIES,
      (secret): secret is { name: string; configured: boolean } => (
        isClosedRecord(secret, ["name", "configured"], ["name", "configured"])
        && isBoundedNonEmptyString(secret.name, MAX_WIRE_IDENTIFIER_LENGTH)
        && typeof secret.configured === "boolean"
      ),
    );
}

function isMcpServerDetailWire(value: unknown): value is McpServerDetailWire {
  return isClosedRecord(value, ["server", "status", "tools", "secrets"], [
    "server", "status", "tools", "secrets",
  ])
    && isMcpServerWire(value.server)
    && isMcpStatusWire(value.status)
    && isBoundedArray(value.tools, MAX_MCP_TOOLS, isMcpToolWire)
    && isMcpSecretStateWire(value.secrets);
}

function isMcpLogEntryWire(value: unknown): value is McpLogEntryWire {
  return isClosedRecord(value, ["at", "level", "message", "detail"], [
    "at", "level", "message",
  ])
    && isBoundedNonEmptyString(value.at, MAX_WIRE_IDENTIFIER_LENGTH)
    && (value.level === "info" || value.level === "warn" || value.level === "error")
    && isBoundedString(value.message, MAX_MCP_LOG_MESSAGE_LENGTH)
    && (
      value.detail === undefined
      || isBoundedString(value.detail, MAX_MCP_LOG_DETAIL_LENGTH)
    );
}

function isMcpSecretInputWire(
  value: unknown,
): value is { name: string; value: string } {
  return isClosedRecord(value, ["name", "value"], ["name", "value"])
    && isBoundedNonEmptyString(value.name, MAX_WIRE_IDENTIFIER_LENGTH)
    && isBoundedNonEmptyString(value.value, MAX_SECRET_VALUE_LENGTH);
}

function isMcpOperationWire(value: unknown): value is McpOperationWire {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "upsertServer":
      return isClosedRecord(value, ["kind", "server"], ["kind", "server"])
        && isMcpServerInputWire(value.server);
    case "removeServer":
    case "connectServer":
    case "disconnectServer":
    case "clearOAuthTokens":
      return isClosedRecord(value, ["kind", "serverId"], ["kind", "serverId"])
        && isBoundedNonEmptyString(value.serverId, MAX_WIRE_IDENTIFIER_LENGTH);
    case "setServerEnabled":
      return isClosedRecord(value, [
        "kind", "serverId", "enabled",
      ], [
        "kind", "serverId", "enabled",
      ])
        && isBoundedNonEmptyString(value.serverId, MAX_WIRE_IDENTIFIER_LENGTH)
        && typeof value.enabled === "boolean";
    case "setToolEnabled":
      return isClosedRecord(value, [
        "kind", "serverId", "toolName", "enabled",
      ], [
        "kind", "serverId", "toolName", "enabled",
      ])
        && isBoundedNonEmptyString(value.serverId, MAX_WIRE_IDENTIFIER_LENGTH)
        && isBoundedNonEmptyString(value.toolName, MAX_WIRE_IDENTIFIER_LENGTH)
        && typeof value.enabled === "boolean";
    case "setServerSecrets":
      return isClosedRecord(value, [
        "kind", "serverId", "secrets",
      ], [
        "kind", "serverId", "secrets",
      ])
        && isBoundedNonEmptyString(value.serverId, MAX_WIRE_IDENTIFIER_LENGTH)
        && isBoundedArray(
          value.secrets,
          MAX_MCP_SECRET_ENTRIES,
          isMcpSecretInputWire,
        );
    default:
      return false;
  }
}

function isWebSearchCatalogWire(value: unknown): value is WebSearchCatalogWire {
  if (!isClosedRecord(value, ["engine", "engines"], ["engine", "engines"])) return false;
  if (value.engine !== null && !isWebSearchEngineWire(value.engine)) return false;
  if (!isBoundedArray(
    value.engines,
    3,
    (engine): engine is { engine: WebSearchEngineWire; baseURL?: string } => (
      isClosedRecord(engine, ["engine", "baseURL"], ["engine"])
      && isWebSearchEngineWire(engine.engine)
      && (
        engine.baseURL === undefined
        || isBoundedNonEmptyString(engine.baseURL, MAX_WIRE_URL_LENGTH)
      )
    ),
  )) return false;
  const engines = value.engines.map((entry) => entry.engine);
  return new Set(engines).size === engines.length;
}

function isWebSearchEngineWireInfo(value: unknown): value is WebSearchEngineWireInfo {
  return isClosedRecord(value, [
    "engine", "baseURL", "defaultBaseURL", "baseURLRequired", "secretRef",
  ], [
    "engine", "baseURLRequired",
  ])
    && isWebSearchEngineWire(value.engine)
    && (
      value.baseURL === undefined
      || isBoundedNonEmptyString(value.baseURL, MAX_WIRE_URL_LENGTH)
    )
    && (
      value.defaultBaseURL === undefined
      || isBoundedNonEmptyString(value.defaultBaseURL, MAX_WIRE_URL_LENGTH)
    )
    && typeof value.baseURLRequired === "boolean"
    && (
      value.secretRef === undefined
      || isWebSearchSecretRefWire(value.secretRef)
    );
}

function isWebSearchSettingsView(value: unknown): value is WebSearchSettingsView {
  return isClosedRecord(value, [
    "section", "engine", "engines", "secrets", "available",
  ], [
    "section", "engine", "engines", "secrets", "available",
  ])
    && value.section === "web-search"
    && (value.engine === null || isWebSearchEngineWire(value.engine))
    && isBoundedArray(value.engines, 3, isWebSearchEngineWireInfo)
    && isBoundedArray(
      value.secrets,
      2,
      (secret): secret is WebSearchSecretStateWire => (
        isClosedRecord(secret, [
          "ref", "configured", "writable",
        ], [
          "ref", "configured", "writable",
        ])
        && isWebSearchSecretRefWire(secret.ref)
        && typeof secret.configured === "boolean"
        && typeof secret.writable === "boolean"
      ),
    )
    && typeof value.available === "boolean";
}

function isMcpSettingsView(value: unknown): value is McpSettingsView {
  return isClosedRecord(value, [
    "section", "servers", "secretStates", "oauth",
  ], [
    "section", "servers", "secretStates", "oauth",
  ])
    && value.section === "mcp"
    && isBoundedArray(
      value.servers,
      MAX_MCP_SERVERS,
      (item): item is McpServerListItemWire => (
        isClosedRecord(item, [
          "server", "status", "toolCount", "disabledToolCount",
        ], [
          "server", "status", "toolCount", "disabledToolCount",
        ])
        && isMcpServerWire(item.server)
        && isMcpStatusWire(item.status)
        && isNonNegativeInteger(item.toolCount)
        && isNonNegativeInteger(item.disabledToolCount)
      ),
    )
    && (value.secretStates === "available" || value.secretStates === "unavailable")
    && isClosedRecord(value.oauth, ["kind", "reason"], ["kind", "reason"])
    && value.oauth.kind === "manual"
    && value.oauth.reason === "no-callback-origin";
}

interface WireScanState {
  depth: number;
  nodes: number;
  seen: WeakSet<object>;
}

function freshWireScanState(): WireScanState {
  return { depth: 0, nodes: 0, seen: new WeakSet() };
}

/** @returns true when a predicate match or a scan limit (fail closed) is hit. */
function scanWirePayload(
  value: unknown,
  onRecord: (record: Record<string, unknown>) => boolean,
  state: WireScanState = freshWireScanState(),
): boolean {
  if (state.nodes >= MAX_WIRE_SCAN_NODES || state.depth > MAX_WIRE_SCAN_DEPTH) {
    return true;
  }
  state.nodes += 1;

  if (Array.isArray(value)) {
    for (const item of value) {
      state.depth += 1;
      if (scanWirePayload(item, onRecord, state)) return true;
      state.depth -= 1;
    }
    return false;
  }

  if (!isRecord(value)) return false;

  if (state.seen.has(value)) return true;
  state.seen.add(value);

  if (onRecord(value)) return true;

  for (const child of Object.values(value)) {
    state.depth += 1;
    if (scanWirePayload(child, onRecord, state)) return true;
    state.depth -= 1;
  }
  return false;
}

function hasForbiddenKey(value: unknown): boolean {
  return scanWirePayload(value, (record) => (
    Object.keys(record).some((key) => FORBIDDEN_KEYS.has(key))
  ));
}

function isSafePath(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((segment) => isNonEmptyString(segment) && !FORBIDDEN_KEYS.has(segment));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !hasForbiddenKey(value);
}

/**
 * Defense-in-depth scan after closed-schema validation.
 * Enforceable outbound guarantee: no credential-value field name and no `{ ref, value }` pair.
 * Arbitrary business strings are not proven secret-free; closed schemas own field names.
 * Scan limits treat cycles and excess depth as credential leaks (fail closed).
 */
function containsOutboundCredentialValueField(value: unknown): boolean {
  return scanWirePayload(value, (record) => (
    Object.entries(record).some(([key, child]) => (
      CREDENTIAL_VALUE_FIELD_NAMES.has(key)
      || (key === "value" && "ref" in record && typeof record.ref === "string")
      || (typeof child === "string" && CREDENTIAL_VALUE_FIELD_NAMES.has(key))
    ))
  ));
}

function isSettingsSecretEntry(value: unknown): value is { path: string[]; set: boolean } {
  if (!isClosedRecord(value, ["path", "set"], ["path", "set"])) return false;
  return isSafePath(value.path) && typeof value.set === "boolean";
}

function isSettingsNamespaceWire(value: unknown): value is SettingsNamespaceWire {
  if (!isClosedRecord(value, [
    "namespace", "revision", "applies", "writable", "base", "user", "value", "secrets",
  ], [
    "namespace", "revision", "applies", "writable", "base", "user", "value", "secrets",
  ])) return false;
  if (!isKebabCaseNamespace(value.namespace)) return false;
  if (!isNonNegativeInteger(value.revision)) return false;
  if (value.applies !== "live" && value.applies !== "restart") return false;
  if (typeof value.writable !== "boolean") return false;
  if (!isPlainObject(value.base)) return false;
  if (!isPlainObject(value.user)) return false;
  if (!isPlainObject(value.value)) return false;
  if (!Array.isArray(value.secrets)) return false;
  return value.secrets.every(isSettingsSecretEntry);
}

function isCredentialStateWire(value: unknown): value is CredentialStateWire {
  if (!isClosedRecord(value, ["ref", "set", "source", "writable"], [
    "ref", "set", "writable",
  ])) return false;
  if (!isCredentialRef(value.ref) || typeof value.set !== "boolean") return false;
  if (value.source !== undefined && !isNonEmptyString(value.source)) return false;
  if (!value.set && value.source !== undefined) return false;
  return typeof value.writable === "boolean";
}

function isFieldOptionWire(value: unknown): value is { value: string; label: string } {
  if (!isClosedRecord(value, ["value", "label"], ["value", "label"])) return false;
  return isNonEmptyString(value.value) && isNonEmptyString(value.label);
}

function isSettingsFieldWire(value: unknown): value is SettingsFieldWire {
  if (!isClosedRecord(value, [
    "path", "label", "kind", "min", "max", "step", "options",
  ], ["path", "label", "kind"])) return false;
  if (!isSafePath(value.path)) return false;
  if (!isNonEmptyString(value.label)) return false;
  if (!(FIELD_KINDS as readonly string[]).includes(value.kind as string)) return false;
  if (value.min !== undefined && typeof value.min !== "number") return false;
  if (value.max !== undefined && typeof value.max !== "number") return false;
  if (
    value.step !== undefined
    && (typeof value.step !== "number" || !Number.isFinite(value.step) || value.step <= 0)
  ) return false;
  if (value.kind === "union") {
    if (!Object.hasOwn(value, "options")) return false;
    if (!Array.isArray(value.options) || value.options.length === 0) return false;
    return value.options.every(isFieldOptionWire);
  }
  if (value.options !== undefined) {
    if (!Array.isArray(value.options)) return false;
    if (!value.options.every(isFieldOptionWire)) return false;
  }
  return true;
}

function isModelItemWire(value: unknown): value is { id: string; label: string; contextWindow?: number } {
  if (!isClosedRecord(value, ["id", "label", "contextWindow"], ["id", "label"])) return false;
  return isNonEmptyString(value.id)
    && isNonEmptyString(value.label)
    && (value.contextWindow === undefined || typeof value.contextWindow === "number");
}

function isModelCatalogStatusWire(value: unknown): value is ModelCatalogStatusWire {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "dormant":
    case "ready":
      return isClosedRecord(value, ["kind"], ["kind"]);
    case "failed":
      return isClosedRecord(value, ["kind", "message"], ["kind", "message"])
        && isNonEmptyString(value.message);
    default:
      return false;
  }
}

function isCredentialMetadataStatusWire(
  value: unknown,
): value is CredentialMetadataStatusWire {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "none":
    case "ready":
      return isClosedRecord(value, ["kind"], ["kind"]);
    case "failed":
      return isClosedRecord(value, ["kind", "message"], ["kind", "message"])
        && isNonEmptyString(value.message);
    default:
      return false;
  }
}

function isModelProviderSettingsWire(value: unknown): value is ModelProviderSettingsWire {
  if (!isClosedRecord(value, [
    "id", "namespace", "label", "active", "declared", "catalog", "api",
    "baseURL", "credential", "credentialStatus", "models", "removable", "fields",
  ], [
    "id", "namespace", "label", "active", "catalog", "credentialStatus",
    "models", "removable", "fields",
  ])) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isKebabCaseNamespace(value.namespace)) return false;
  if (!isNonEmptyString(value.label)) return false;
  if (typeof value.active !== "boolean") return false;
  if (value.declared !== undefined && typeof value.declared !== "boolean") return false;
  if (!isModelCatalogStatusWire(value.catalog)) return false;
  if (value.api !== undefined && typeof value.api !== "string") return false;
  if (value.baseURL !== undefined && typeof value.baseURL !== "string") return false;
  if (value.credential !== undefined && !isCredentialStateWire(value.credential)) return false;
  if (!isCredentialMetadataStatusWire(value.credentialStatus)) return false;
  if (!Array.isArray(value.models)) return false;
  if (!value.models.every(isModelItemWire)) return false;
  if (value.catalog.kind === "dormant" && value.active) return false;
  if (value.catalog.kind !== "dormant" && !value.active) return false;
  if (value.catalog.kind !== "ready" && value.models.length > 0) return false;
  if (value.credentialStatus.kind === "ready" && value.credential === undefined) {
    return false;
  }
  if (value.credentialStatus.kind !== "ready" && value.credential !== undefined) {
    return false;
  }
  if (typeof value.removable !== "boolean") return false;
  if (!Array.isArray(value.fields)) return false;
  return value.fields.every(isSettingsFieldWire);
}

function isConfigurablePluginWire(value: unknown): value is ConfigurablePluginWire {
  if (!isClosedRecord(value, [
    "namespace", "label", "fields", "credential", "credentialStatus",
  ], ["namespace", "label", "fields"])) return false;
  if (!isKebabCaseNamespace(value.namespace)) return false;
  if (!isNonEmptyString(value.label)) return false;
  if (!Array.isArray(value.fields)) return false;
  if (!value.fields.every(isSettingsFieldWire)) return false;
  if (value.credential !== undefined && !isCredentialStateWire(value.credential)) return false;
  if (
    value.credentialStatus !== undefined
    && !isCredentialMetadataStatusWire(value.credentialStatus)
  ) return false;
  if (
    value.credentialStatus?.kind === "ready"
    && value.credential === undefined
  ) return false;
  if (
    value.credentialStatus?.kind !== "ready"
    && value.credential !== undefined
  ) return false;
  return true;
}

function isPluginInventoryItemWire(value: unknown): value is PluginInventoryItemWire {
  if (!isClosedRecord(value, ["entryId", "moduleName", "enabled", "fiberPhase"], [
    "entryId", "moduleName", "enabled", "fiberPhase",
  ])) return false;
  if (!isNonEmptyString(value.entryId)) return false;
  if (!isNonEmptyString(value.moduleName)) return false;
  if (typeof value.enabled !== "boolean") return false;
  return (FIBER_PHASES as readonly unknown[]).includes(value.fiberPhase);
}

function isAgentPresetListItemWire(
  value: unknown,
): value is { id: string; label: string; trust: "system" | "user" } {
  if (!isClosedRecord(value, ["id", "label", "trust"], ["id", "label", "trust"])) return false;
  return isPresetId(value.id)
    && isNonEmptyString(value.label)
    && (value.trust === "system" || value.trust === "user");
}

function isPermissionPresetListItemWire(
  value: unknown,
): value is { id: string; label: string; dangerous: boolean } {
  if (!isClosedRecord(value, ["id", "label", "dangerous"], ["id", "label", "dangerous"])) return false;
  return isNonEmptyString(value.id)
    && isNonEmptyString(value.label)
    && typeof value.dangerous === "boolean";
}

function isAgentPresetSettingsItemWire(value: unknown): value is AgentPresetSettingsItemWire {
  if (!isClosedRecord(value, [
    "id", "trust", "name", "description", "broken", "removable", "openable",
  ], ["id", "trust", "removable", "openable"])) return false;
  if (!isPresetId(value.id)) return false;
  if (value.trust !== "system" && value.trust !== "user") return false;
  if (value.name !== undefined && typeof value.name !== "string") return false;
  if (value.description !== undefined && typeof value.description !== "string") return false;
  if (value.broken !== undefined && typeof value.broken !== "string") return false;
  if (typeof value.removable !== "boolean") return false;
  if (typeof value.openable !== "boolean") return false;
  return true;
}

function isGeneralSettingsView(value: unknown): value is GeneralSettingsView {
  if (!isClosedRecord(value, ["section", "namespaces", "agentPresets", "permissionPresets"], [
    "section", "namespaces", "agentPresets", "permissionPresets",
  ])) return false;
  if (value.section !== "general") return false;
  if (!Array.isArray(value.namespaces)) return false;
  if (!value.namespaces.every(isSettingsNamespaceWire)) return false;
  if (!Array.isArray(value.agentPresets)) return false;
  if (!value.agentPresets.every(isAgentPresetListItemWire)) return false;
  if (!Array.isArray(value.permissionPresets)) return false;
  return value.permissionPresets.every(isPermissionPresetListItemWire);
}

function isModelsSettingsView(value: unknown): value is ModelsSettingsView {
  if (!isClosedRecord(value, ["section", "namespaces", "providers", "credentials"], [
    "section", "namespaces", "providers", "credentials",
  ])) return false;
  if (value.section !== "models") return false;
  if (!Array.isArray(value.namespaces)) return false;
  if (!value.namespaces.every(isSettingsNamespaceWire)) return false;
  if (!Array.isArray(value.providers)) return false;
  if (!value.providers.every(isModelProviderSettingsWire)) return false;
  if (!Array.isArray(value.credentials)) return false;
  return value.credentials.every(isCredentialStateWire);
}

function isPluginsSettingsView(value: unknown): value is PluginsSettingsView {
  if (!isClosedRecord(value, ["section", "namespaces", "configurable", "inventory"], [
    "section", "namespaces", "configurable", "inventory",
  ])) return false;
  if (value.section !== "plugins") return false;
  if (!Array.isArray(value.namespaces)) return false;
  if (!value.namespaces.every(isSettingsNamespaceWire)) return false;
  if (!Array.isArray(value.configurable)) return false;
  if (!value.configurable.every(isConfigurablePluginWire)) return false;
  if (!Array.isArray(value.inventory)) return false;
  return value.inventory.every(isPluginInventoryItemWire);
}

function isAgentPresetsSettingsView(value: unknown): value is AgentPresetsSettingsView {
  if (!isClosedRecord(value, ["section", "namespace", "presets"], ["section", "presets"])) return false;
  if (value.section !== "agent-presets") return false;
  if (value.namespace !== undefined && !isSettingsNamespaceWire(value.namespace)) return false;
  if (!Array.isArray(value.presets)) return false;
  return value.presets.every(isAgentPresetSettingsItemWire);
}

function isSettingsSectionView(value: unknown): value is SettingsSectionView {
  if (!isRecord(value) || typeof value.section !== "string") return false;
  switch (value.section) {
    case "general":
      return isGeneralSettingsView(value);
    case "models":
      return isModelsSettingsView(value);
    case "plugins":
      return isPluginsSettingsView(value);
    case "agent-presets":
      return isAgentPresetsSettingsView(value);
    case "mcp":
      return isMcpSettingsView(value);
    case "web-search":
      return isWebSearchSettingsView(value);
    default:
      return false;
  }
}

function isSettingsPathOpWire(value: unknown): value is SettingsPathOpWire {
  if (!isRecord(value) || typeof value.op !== "string") return false;
  if (value.op === "set") {
    if (!isClosedRecord(value, ["op", "path", "value"], ["op", "path", "value"])) return false;
    return isSafePath(value.path) && !hasForbiddenKey(value.value);
  }
  if (value.op === "unset") {
    if (!isClosedRecord(value, ["op", "path"], ["op", "path"])) return false;
    return isSafePath(value.path);
  }
  return false;
}

function isSettingsErrorWire(value: unknown): value is SettingsErrorWire {
  if (!isClosedRecord(value, ["code", "message", "namespace", "currentRevision"], ["code", "message"])) return false;
  if (!(SETTINGS_ERROR_CODES as readonly string[]).includes(value.code as string)) return false;
  if (!isNonEmptyString(value.message)) return false;
  if (value.namespace !== undefined && !isKebabCaseNamespace(value.namespace)) return false;
  if (value.currentRevision !== undefined && !isNonNegativeInteger(value.currentRevision)) return false;
  return true;
}

function isResolveSettingsPathTarget(value: unknown): value is ResolveSettingsPathTargetWire {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (!(PATH_TARGET_KINDS as readonly string[]).includes(value.kind)) return false;
  switch (value.kind) {
    case "dsh-home":
      return isClosedRecord(value, ["kind"], ["kind"]);
    case "settings-document":
      return isClosedRecord(value, ["kind", "prepare"], ["kind", "prepare"])
        && typeof value.prepare === "boolean";
    case "agent-preset":
      return isClosedRecord(value, ["kind", "presetId"], ["kind", "presetId"])
        && isPresetId(value.presetId);
    default:
      return false;
  }
}

function validateGetSettingsSectionCommand(value: unknown): value is GetSettingsSectionCommand {
  if (!isClosedRecord(value, ["kind", "requestId", "section"], ["kind", "requestId", "section"])) return false;
  if (value.kind !== "getSettingsSection") return false;
  return isNonEmptyRequestId(value.requestId) && isSettingsSectionId(value.section);
}

function validateGetSettingsCapabilitiesCommand(
  value: unknown,
): value is GetSettingsCapabilitiesCommand {
  return isClosedRecord(value, ["kind", "requestId"], ["kind", "requestId"])
    && value.kind === "getSettingsCapabilities"
    && isNonEmptyRequestId(value.requestId);
}

function validateGetMcpServerCommand(value: unknown): value is GetMcpServerCommand {
  return isClosedRecord(value, [
    "kind", "requestId", "serverId",
  ], [
    "kind", "requestId", "serverId",
  ])
    && value.kind === "getMcpServer"
    && isNonEmptyRequestId(value.requestId)
    && isBoundedNonEmptyString(value.serverId, MAX_WIRE_IDENTIFIER_LENGTH);
}

function validateGetMcpLogsCommand(value: unknown): value is GetMcpLogsCommand {
  return isClosedRecord(value, [
    "kind", "requestId", "serverId", "after",
  ], [
    "kind", "requestId", "serverId",
  ])
    && value.kind === "getMcpLogs"
    && isNonEmptyRequestId(value.requestId)
    && isBoundedNonEmptyString(value.serverId, MAX_WIRE_IDENTIFIER_LENGTH)
    && (value.after === undefined || isNonNegativeInteger(value.after));
}

function validateRunMcpOperationCommand(
  value: unknown,
): value is RunMcpOperationCommand {
  return isClosedRecord(value, [
    "kind", "requestId", "operation",
  ], [
    "kind", "requestId", "operation",
  ])
    && value.kind === "runMcpOperation"
    && isNonEmptyRequestId(value.requestId)
    && isMcpOperationWire(value.operation);
}

function validateSetWebSearchConfigCommand(
  value: unknown,
): value is SetWebSearchConfigCommand {
  return isClosedRecord(value, [
    "kind", "requestId", "catalog", "secrets",
  ], [
    "kind", "requestId", "catalog", "secrets",
  ])
    && value.kind === "setWebSearchConfig"
    && isNonEmptyRequestId(value.requestId)
    && isWebSearchCatalogWire(value.catalog)
    && isBoundedArray(
      value.secrets,
      2,
      (secret): secret is { ref: WebSearchSecretRefWire; value: string } => (
        isClosedRecord(secret, ["ref", "value"], ["ref", "value"])
        && isWebSearchSecretRefWire(secret.ref)
        && isBoundedNonEmptyString(secret.value, MAX_SECRET_VALUE_LENGTH)
      ),
    );
}

function validateMutateSettingsCommand(value: unknown): value is MutateSettingsCommand {
  if (!isClosedRecord(value, ["kind", "requestId", "namespace", "expectedRevision", "ops"], [
    "kind", "requestId", "namespace", "expectedRevision", "ops",
  ])) return false;
  if (value.kind !== "mutateSettings") return false;
  if (!isNonEmptyRequestId(value.requestId)) return false;
  if (!isKebabCaseNamespace(value.namespace)) return false;
  if (!isNonNegativeInteger(value.expectedRevision)) return false;
  if (!Array.isArray(value.ops) || value.ops.length === 0) return false;
  return value.ops.every(isSettingsPathOpWire);
}

function validateSetCredentialCommand(value: unknown): value is SetCredentialCommand {
  if (!isClosedRecord(value, ["kind", "requestId", "ref", "value"], ["kind", "requestId", "ref", "value"])) return false;
  if (value.kind !== "setCredential") return false;
  return isNonEmptyRequestId(value.requestId)
    && isCredentialRef(value.ref)
    && isNonEmptyString(value.value);
}

function validateUnsetCredentialCommand(value: unknown): value is UnsetCredentialCommand {
  if (!isClosedRecord(value, ["kind", "requestId", "ref"], ["kind", "requestId", "ref"])) return false;
  if (value.kind !== "unsetCredential") return false;
  return isNonEmptyRequestId(value.requestId) && isCredentialRef(value.ref);
}

function validateCopyAgentPresetCommand(value: unknown): value is CopyAgentPresetCommand {
  if (!isClosedRecord(value, ["kind", "requestId", "fromPresetId", "presetId", "name"], [
    "kind", "requestId", "fromPresetId", "presetId", "name",
  ])) return false;
  if (value.kind !== "copyAgentPreset") return false;
  return isNonEmptyRequestId(value.requestId)
    && isPresetId(value.fromPresetId)
    && isPresetId(value.presetId)
    && isNonEmptyString(value.name);
}

function validateDeleteAgentPresetCommand(value: unknown): value is DeleteAgentPresetCommand {
  if (!isClosedRecord(value, ["kind", "requestId", "presetId"], ["kind", "requestId", "presetId"])) return false;
  if (value.kind !== "deleteAgentPreset") return false;
  return isNonEmptyRequestId(value.requestId) && isPresetId(value.presetId);
}

function validateReadAgentPresetCommand(value: unknown): value is ReadAgentPresetCommand {
  if (!isClosedRecord(value, ["kind", "requestId", "presetId"], ["kind", "requestId", "presetId"])) return false;
  if (value.kind !== "readAgentPreset") return false;
  return isNonEmptyRequestId(value.requestId) && isPresetId(value.presetId);
}

function validateResolveSettingsPathCommand(value: unknown): value is ResolveSettingsPathCommand {
  if (!isClosedRecord(value, ["kind", "requestId", "target"], ["kind", "requestId", "target"])) return false;
  if (value.kind !== "resolveSettingsPath") return false;
  return isNonEmptyRequestId(value.requestId) && isResolveSettingsPathTarget(value.target);
}

function isMutationSuccessResult(value: unknown): boolean {
  if (!isClosedRecord(value, ["ok", "namespace", "restartRequired"], ["ok"])) return false;
  if (value.ok !== true) return false;
  if (value.namespace !== undefined && !isSettingsNamespaceWire(value.namespace)) return false;
  if (value.restartRequired !== undefined && typeof value.restartRequired !== "boolean") return false;
  return true;
}

function isSettingsErrorResult(value: unknown): boolean {
  if (!isClosedRecord(value, ["ok", "error"], ["ok", "error"])) return false;
  if (value.ok !== false) return false;
  return isSettingsErrorWire(value.error);
}

function isAgentPresetContentSuccessResult(value: unknown): boolean {
  if (!isClosedRecord(value, ["ok", "presetId", "trust", "content"], [
    "ok", "presetId", "trust", "content",
  ])) return false;
  if (value.ok !== true) return false;
  return isPresetId(value.presetId)
    && (value.trust === "system" || value.trust === "user")
    && typeof value.content === "string";
}

function isSettingsPathSuccessResult(value: unknown): boolean {
  if (!isClosedRecord(value, ["ok", "path", "target"], ["ok", "path", "target"])) return false;
  if (value.ok !== true) return false;
  return isNonEmptyString(value.path)
    && (PATH_TARGET_KINDS as readonly string[]).includes(value.target as string);
}

function validateSettingsCapabilitiesMessage(
  value: unknown,
): value is SettingsCapabilitiesMessage {
  if (!isClosedRecord(value, [
    "kind", "requestId", "sections",
  ], [
    "kind", "sections",
  ])) return false;
  if (value.kind !== "settingsCapabilities") return false;
  if (
    value.requestId !== undefined
    && !isNonEmptyRequestId(value.requestId)
  ) return false;
  if (!isBoundedArray(
    value.sections,
    OPTIONAL_SETTINGS_SECTION_IDS.length,
    isOptionalSettingsSectionId,
  )) return false;
  if (new Set(value.sections).size !== value.sections.length) return false;
  return !containsOutboundCredentialValueField(value);
}

function isMcpServerSuccessResult(value: unknown): boolean {
  return isClosedRecord(value, ["ok", "detail"], ["ok", "detail"])
    && value.ok === true
    && isMcpServerDetailWire(value.detail);
}

function validateMcpServerMessage(value: unknown): value is McpServerMessage {
  if (!isClosedRecord(value, [
    "kind", "requestId", "result",
  ], [
    "kind", "requestId", "result",
  ])) return false;
  if (value.kind !== "mcpServer" || !isNonEmptyRequestId(value.requestId)) return false;
  if (!isMcpServerSuccessResult(value.result) && !isSettingsErrorResult(value.result)) {
    return false;
  }
  return !containsOutboundCredentialValueField(value);
}

function isMcpLogsSuccessResult(value: unknown): boolean {
  return isClosedRecord(value, [
    "ok", "serverId", "next", "entries",
  ], [
    "ok", "serverId", "next", "entries",
  ])
    && value.ok === true
    && isBoundedNonEmptyString(value.serverId, MAX_WIRE_IDENTIFIER_LENGTH)
    && isNonNegativeInteger(value.next)
    && isBoundedArray(value.entries, MAX_MCP_LOG_ENTRIES, isMcpLogEntryWire);
}

function validateMcpLogsMessage(value: unknown): value is McpLogsMessage {
  if (!isClosedRecord(value, [
    "kind", "requestId", "result",
  ], [
    "kind", "requestId", "result",
  ])) return false;
  if (value.kind !== "mcpLogs" || !isNonEmptyRequestId(value.requestId)) return false;
  if (!isMcpLogsSuccessResult(value.result) && !isSettingsErrorResult(value.result)) {
    return false;
  }
  return !containsOutboundCredentialValueField(value);
}

function isMcpOperationSuccessResult(value: unknown): boolean {
  return isClosedRecord(value, ["ok", "detail"], ["ok"])
    && value.ok === true
    && (value.detail === undefined || isMcpServerDetailWire(value.detail));
}

function validateMcpOperationMessage(value: unknown): value is McpOperationMessage {
  if (!isClosedRecord(value, [
    "kind", "requestId", "result",
  ], [
    "kind", "requestId", "result",
  ])) return false;
  if (value.kind !== "mcpOperation" || !isNonEmptyRequestId(value.requestId)) return false;
  if (
    !isMcpOperationSuccessResult(value.result)
    && !isSettingsErrorResult(value.result)
  ) return false;
  return !containsOutboundCredentialValueField(value);
}

function isWebSearchMutationSuccessResult(value: unknown): boolean {
  return isClosedRecord(value, [
    "ok", "view", "secretFailures",
  ], [
    "ok", "view", "secretFailures",
  ])
    && value.ok === true
    && isWebSearchSettingsView(value.view)
    && isBoundedArray(
      value.secretFailures,
      2,
      (failure): failure is { ref: WebSearchSecretRefWire; message: string } => (
        isClosedRecord(failure, ["ref", "message"], ["ref", "message"])
        && isWebSearchSecretRefWire(failure.ref)
        && isBoundedNonEmptyString(failure.message, MAX_MCP_LOG_DETAIL_LENGTH)
      ),
    );
}

function validateWebSearchMutationMessage(
  value: unknown,
): value is WebSearchMutationMessage {
  if (!isClosedRecord(value, [
    "kind", "requestId", "result",
  ], [
    "kind", "requestId", "result",
  ])) return false;
  if (
    value.kind !== "webSearchMutation"
    || !isNonEmptyRequestId(value.requestId)
  ) return false;
  if (
    !isWebSearchMutationSuccessResult(value.result)
    && !isSettingsErrorResult(value.result)
  ) return false;
  return !containsOutboundCredentialValueField(value);
}

function validateSettingsSectionMessage(value: unknown): value is SettingsSectionMessage {
  if (!isRecord(value) || value.kind !== "settingsSection") return false;
  if (!isNonEmptyRequestId(value.requestId)) return false;
  if (Object.hasOwn(value, "view")) {
    if (!isClosedRecord(value, ["kind", "requestId", "view"], ["kind", "requestId", "view"])) return false;
    if (!isSettingsSectionView(value.view)) return false;
  } else {
    if (!isClosedRecord(value, ["kind", "requestId", "error"], ["kind", "requestId", "error"])) return false;
    if (!isSettingsErrorWire(value.error)) return false;
  }
  return !containsOutboundCredentialValueField(value);
}

function validateSettingsMutationMessage(value: unknown): value is SettingsMutationMessage {
  if (!isClosedRecord(value, ["kind", "requestId", "result"], ["kind", "requestId", "result"])) return false;
  if (value.kind !== "settingsMutation") return false;
  if (!isNonEmptyRequestId(value.requestId)) return false;
  if (containsOutboundCredentialValueField(value)) return false;
  return isMutationSuccessResult(value.result) || isSettingsErrorResult(value.result);
}

function validateSettingsInvalidatedMessage(value: unknown): value is SettingsInvalidatedMessage {
  if (!isClosedRecord(value, ["kind", "sections", "reason"], ["kind", "sections", "reason"])) return false;
  if (value.kind !== "settingsInvalidated") return false;
  if (!Array.isArray(value.sections)) return false;
  if (!value.sections.every(isSettingsSectionId)) return false;
  if (containsOutboundCredentialValueField(value)) return false;
  return (INVALIDATION_REASONS as readonly string[]).includes(value.reason as string);
}

function validateAgentPresetContentMessage(value: unknown): value is AgentPresetContentMessage {
  if (!isClosedRecord(value, ["kind", "requestId", "result"], ["kind", "requestId", "result"])) return false;
  if (value.kind !== "agentPresetContent") return false;
  if (!isNonEmptyRequestId(value.requestId)) return false;
  if (containsOutboundCredentialValueField(value)) return false;
  return isAgentPresetContentSuccessResult(value.result)
    || isSettingsErrorResult(value.result);
}

function validateSettingsPathMessage(value: unknown): value is SettingsPathMessage {
  if (!isClosedRecord(value, ["kind", "requestId", "result"], ["kind", "requestId", "result"])) return false;
  if (value.kind !== "settingsPath") return false;
  if (!isNonEmptyRequestId(value.requestId)) return false;
  if (containsOutboundCredentialValueField(value)) return false;
  return isSettingsPathSuccessResult(value.result) || isSettingsErrorResult(value.result);
}

/**
 * Runtime validator for settings inbound commands.
 * @param value - candidate wire message.
 * @returns whether the value satisfies the settings inbound contract.
 */
export function isSettingsInboundCommand(value: unknown): value is SettingsInboundCommand {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "getSettingsSection":
      return validateGetSettingsSectionCommand(value);
    case "getSettingsCapabilities":
      return validateGetSettingsCapabilitiesCommand(value);
    case "getMcpServer":
      return validateGetMcpServerCommand(value);
    case "getMcpLogs":
      return validateGetMcpLogsCommand(value);
    case "runMcpOperation":
      return validateRunMcpOperationCommand(value);
    case "setWebSearchConfig":
      return validateSetWebSearchConfigCommand(value);
    case "mutateSettings":
      return validateMutateSettingsCommand(value);
    case "setCredential":
      return validateSetCredentialCommand(value);
    case "unsetCredential":
      return validateUnsetCredentialCommand(value);
    case "copyAgentPreset":
      return validateCopyAgentPresetCommand(value);
    case "deleteAgentPreset":
      return validateDeleteAgentPresetCommand(value);
    case "readAgentPreset":
      return validateReadAgentPresetCommand(value);
    case "resolveSettingsPath":
      return validateResolveSettingsPathCommand(value);
    default:
      return false;
  }
}

/**
 * Runtime validator for settings outbound messages.
 *
 * Enforceable outbound credential guarantee:
 * - every {@link CredentialStateWire} record carries only the reference,
 *   configured state, source metadata, and writability;
 * - outbound messages have no credential-value field (`value` alongside `ref`, or named leak keys);
 * - closed schemas reject undeclared fields that could carry secrets.
 * Arbitrary business strings in approved fields are not proven secret-free.
 *
 * @param value - candidate wire message.
 * @returns whether the value satisfies the settings outbound contract.
 */
export function isSettingsOutboundMessage(value: unknown): value is SettingsOutboundMessage {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "settingsSection":
      return validateSettingsSectionMessage(value);
    case "settingsCapabilities":
      return validateSettingsCapabilitiesMessage(value);
    case "mcpServer":
      return validateMcpServerMessage(value);
    case "mcpLogs":
      return validateMcpLogsMessage(value);
    case "mcpOperation":
      return validateMcpOperationMessage(value);
    case "webSearchMutation":
      return validateWebSearchMutationMessage(value);
    case "settingsMutation":
      return validateSettingsMutationMessage(value);
    case "settingsInvalidated":
      return validateSettingsInvalidatedMessage(value);
    case "agentPresetContent":
      return validateAgentPresetContentMessage(value);
    case "settingsPath":
      return validateSettingsPathMessage(value);
    default:
      return false;
  }
}

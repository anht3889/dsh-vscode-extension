import { isMcpServerInputWire } from "@dsh-vscode/contract";
import type {
  McpAuthWire,
  McpLogEntryWire,
  McpLogsMessage,
  McpOAuthDiscoveryMessage,
  McpOperationMessage,
  McpOperationWire,
  McpServerDetailWire,
  McpServerInputWire,
  McpServerListItemWire,
  McpServerMessage,
  McpSettingsView,
  McpTransportWire,
  SettingsInboundCommand,
} from "@dsh-vscode/contract";
import type { SettingsCopyKey } from "../../localization/index.js";

export interface McpEditorDraft {
  mode: "create" | "edit";
  serverId?: string;
  serverName: string;
  enabled: boolean;
  transport: McpTransportWire;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
  cwd: string;
  url: string;
  auth: McpAuthWire;
  toolCallTimeoutMs: number;
  reconnect: {
    enabled: boolean;
    initialDelayMs: number;
    maxDelayMs: number;
    maxAttempts: number;
  };
  errorKey?: SettingsCopyKey;
  errorDetail?: string;
  secretFailure?: { names: string[] };
}

export interface McpSnapshot {
  servers: McpServerListItemWire[];
  secretStates: "available" | "unavailable";
  /** Whether the mounted plugin exposes OAuth endpoint discovery. */
  oauthDiscovery: "available" | "unavailable";
  /** Whether the mounted plugin can launch OAuth with a callback origin. */
  oauthAuthorization: "available" | "unavailable";
  /** Callback origin named by a loopback-capable MCP plugin. */
  oauthOrigin?: string;
  selectedServerId?: string;
  detail?: McpServerDetailWire;
  logs: McpLogEntryWire[];
  logCursor?: number;
  editor?: McpEditorDraft;
  secretRequest?: { serverId: string; names: string[]; epoch: number };
  pending: string[];
  confirmation?: { kind: "delete" | "clear-oauth"; serverId: string };
  secretEpoch: number;
  dirty: boolean;
  connected: boolean;
  errorKey?: SettingsCopyKey;
  noticeKey?: SettingsCopyKey;
  /** Whether an OAuth discovery request is awaiting its reply. */
  discovering: boolean;
  /** Whether OAuth is launching or waiting for browser completion. */
  authorizing: boolean;
  discoveryErrorKey?: SettingsCopyKey;
  discoveryErrorDetail?: string;
  discoveryNoticeKey?: SettingsCopyKey;
}

type SecretValues = Readonly<Record<string, string | undefined>>;
type PollKey = "list" | "detail" | "logs";
type OperationStage =
  | "upsert"
  | "provision"
  | "authorize"
  | "secrets"
  | "remove"
  | "enabled"
  | "connect"
  | "disconnect"
  | "tool"
  | "clear-oauth";

interface PendingOperation {
  requestId: string;
  owner: string;
  serverId?: string;
  stage: OperationStage;
  secretNames?: string[];
  remainingSecretFailures?: string[];
  toolRollback?: { name: string; enabled: boolean };
}

interface PendingRead {
  requestId: string;
  serverId: string;
  epoch: number;
}

const CREATE_OWNER = "$create";
const SERVER_REMOVED_KEY: SettingsCopyKey = "mcpServerRemoved";
const DISCONNECTED_OPERATION_KEY: SettingsCopyKey = "mcpDisconnectedOperation";
const OPERATION_FAILED_KEY: SettingsCopyKey = "mcpOperationFailed";
const SECRET_FAILED_KEY: SettingsCopyKey = "mcpSecretFailure";
const SECRET_DECLINED_KEY: SettingsCopyKey = "mcpSecretDeclined";
const LIST_LOAD_FAILED_KEY: SettingsCopyKey = "mcpListLoadFailed";
const INVALID_RECORD_KEY: SettingsCopyKey = "mcpInvalidRecord";
const DISCOVER_NEED_URL_KEY: SettingsCopyKey = "mcpDiscoverNeedUrl";
const DISCOVER_FAILED_KEY: SettingsCopyKey = "mcpDiscoverFailed";
const DISCOVER_CLIENT_SECRET_KEY: SettingsCopyKey = "mcpDiscoverClientSecret";
const DISCOVER_NO_CLIENT_ID_KEY: SettingsCopyKey = "mcpDiscoverNoClientId";

const EDITABLE_FIELDS = new Set<keyof McpEditorDraft>([
  "serverName",
  "enabled",
  "transport",
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "auth",
  "toolCallTimeoutMs",
  "reconnect",
]);

function createDraft(): McpEditorDraft {
  return {
    mode: "create",
    serverName: "",
    enabled: true,
    transport: "stdio",
    command: "",
    args: [],
    env: [],
    cwd: "",
    url: "",
    auth: { kind: "none" },
    toolCallTimeoutMs: 30_000,
    reconnect: {
      enabled: true,
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      maxAttempts: 5,
    },
  };
}

function draftFromDetail(detail: McpServerDetailWire): McpEditorDraft {
  const server = detail.server;
  return {
    mode: "edit",
    serverId: server.id,
    serverName: server.serverName,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command ?? "",
    args: structuredClone(server.args ?? []),
    env: structuredClone(server.env ?? []),
    cwd: server.cwd ?? "",
    url: server.url ?? "",
    auth: structuredClone(server.auth),
    toolCallTimeoutMs: server.toolCallTimeoutMs,
    reconnect: structuredClone(server.reconnect),
  };
}

function comparableDraft(draft: McpEditorDraft): object {
  return {
    mode: draft.mode,
    ...(draft.serverId === undefined ? {} : { serverId: draft.serverId }),
    serverName: draft.serverName,
    enabled: draft.enabled,
    transport: draft.transport,
    command: draft.command,
    args: draft.args,
    env: draft.env,
    cwd: draft.cwd,
    url: draft.url,
    auth: draft.auth,
    toolCallTimeoutMs: draft.toolCallTimeoutMs,
    reconnect: draft.reconnect,
  };
}

function authorizedSecretNames(draft: McpEditorDraft): string[] {
  if (draft.auth.kind === "headers") {
    return [...new Set(draft.auth.headerNames.filter((name) => name !== ""))];
  }
  return draft.auth.kind === "oauth" ? ["OAUTH_CLIENT_SECRET"] : [];
}

function serverInput(draft: McpEditorDraft): McpServerInputWire {
  const common = {
    ...(draft.serverId === undefined ? {} : { serverId: draft.serverId }),
    serverName: draft.serverName,
    enabled: draft.enabled,
    transport: draft.transport,
    auth: structuredClone(draft.auth),
    toolCallTimeoutMs: draft.toolCallTimeoutMs,
    reconnect: structuredClone(draft.reconnect),
  };
  return draft.transport === "stdio"
    ? {
        ...common,
        command: draft.command,
        args: structuredClone(draft.args),
        env: structuredClone(draft.env),
        cwd: draft.cwd,
      }
    : { ...common, url: draft.url };
}

/**
 * Owns MCP list, selection, draft, request, and operation state.
 *
 * Secret values are accepted only as operation-call arguments. The controller
 * retains staged names and failure metadata, never values.
 */
export class McpController {
  private view?: McpSettingsView;
  private revision = 0;
  private connected = true;
  private secretEpoch = 0;
  private selectedServerId?: string;
  private detail?: McpServerDetailWire;
  private logs: McpLogEntryWire[] = [];
  private logCursor?: number;
  private editor?: McpEditorDraft;
  private editorBaseline?: object;
  private readonly stagedSecretNames = new Set<string>();
  private secretRequest?: { serverId: string; names: string[]; epoch: number };
  private secretRequestEpoch = 0;
  private confirmation?: { kind: "delete" | "clear-oauth"; serverId: string };
  private errorKey?: SettingsCopyKey;
  private noticeKey?: SettingsCopyKey;
  private pendingDiscovery?: string;
  private discoveryErrorKey?: SettingsCopyKey;
  private discoveryErrorDetail?: string;
  private discoveryNoticeKey?: SettingsCopyKey;
  private authorizing = false;
  private authorizingServerId?: string;
  private selectionEpoch = 0;
  private readonly inFlight = new Set<PollKey>();
  private pendingDetail?: PendingRead;
  private pendingLogs?: PendingRead & { append: boolean };
  private readonly pendingByServer = new Map<string, PendingOperation>();
  private readonly pendingByRequest = new Map<string, PendingOperation>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly send: (command: SettingsInboundCommand) => void,
    private readonly refresh: () => void,
    private readonly requestId: () => string = () => crypto.randomUUID(),
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Counts every change to the authoritative server list, so a caller can tell
   * whether a reply it just routed here changed the list.
   * @returns the current list revision.
   */
  listRevision(): number {
    return this.revision;
  }

  /**
   * The authoritative server list, including locally applied operation results.
   * Carries secret names and configured flags only, never secret values.
   * @returns a detached copy, or `undefined` before the first list arrives.
   */
  listView(): McpSettingsView | undefined {
    return this.view === undefined ? undefined : structuredClone(this.view);
  }

  updateView(view: McpSettingsView): void {
    this.view = view;
    this.revision += 1;
    this.connected = true;
    this.inFlight.delete("list");
    this.errorKey = undefined;
    const ids = new Set(view.servers.map((item) => item.server.id));
    if (
      this.authorizingServerId !== undefined &&
      view.servers.some((item) =>
        item.server.id === this.authorizingServerId &&
        item.status.state !== "disconnected")
    ) {
      this.clearAuthorization();
    }
    if (
      this.confirmation !== undefined &&
      !ids.has(this.confirmation.serverId)
    ) {
      this.confirmation = undefined;
    }
    const vanished = this.selectedServerId !== undefined &&
      !ids.has(this.selectedServerId);
    if (vanished) this.clearSelection(true);

    if (
      this.editor?.mode === "edit" &&
      this.editor.serverId !== undefined &&
      !ids.has(this.editor.serverId)
    ) {
      this.editor = undefined;
      this.editorBaseline = undefined;
      this.clearSensitiveIntent();
      this.noticeKey = SERVER_REMOVED_KEY;
    }

    for (const [owner, operation] of this.pendingByServer) {
      if (
        owner !== CREATE_OWNER &&
        operation.serverId !== undefined &&
        !ids.has(operation.serverId)
      ) {
        this.settleVanished(operation);
      }
    }
    this.notify();
  }

  disconnect(): void {
    this.connected = false;
    this.selectionEpoch += 1;
    this.inFlight.clear();
    this.pendingDetail = undefined;
    this.pendingLogs = undefined;
    const interrupted = [...this.pendingByServer.values()];
    this.pendingByServer.clear();
    this.pendingByRequest.clear();
    this.secretRequest = undefined;
    this.confirmation = undefined;
    this.clearDiscovery();
    this.clearAuthorization();
    this.clearSensitiveIntent(true);
    if (interrupted.length > 0) {
      this.noticeKey = DISCONNECTED_OPERATION_KEY;
      if (this.editor !== undefined) {
        this.editor.errorKey = DISCONNECTED_OPERATION_KEY;
        this.editor.errorDetail = undefined;
      }
    }
    this.notify();
  }

  snapshot = (): McpSnapshot => ({
    servers: structuredClone(this.view?.servers ?? []),
    secretStates: this.view?.secretStates ?? "unavailable",
    oauthDiscovery: this.view?.oauth.discovery ?? "unavailable",
    oauthAuthorization: this.view?.oauth.authorization ?? "unavailable",
    ...(this.view?.oauth.kind === "loopback"
      ? { oauthOrigin: this.view.oauth.origin }
      : {}),
    ...(this.selectedServerId === undefined
      ? {}
      : { selectedServerId: this.selectedServerId }),
    ...(this.detail === undefined ? {} : { detail: structuredClone(this.detail) }),
    logs: structuredClone(this.logs),
    ...(this.logCursor === undefined ? {} : { logCursor: this.logCursor }),
    ...(this.editor === undefined ? {} : { editor: structuredClone(this.editor) }),
    ...(this.secretRequest === undefined
      ? {}
      : { secretRequest: structuredClone(this.secretRequest) }),
    pending: [...new Set([
      ...[...this.pendingByServer.keys()].map((owner) =>
        owner === CREATE_OWNER ? "create" : owner),
      ...(this.secretRequest === undefined
        ? []
        : [this.secretRequest.serverId]),
    ])],
    ...(this.confirmation === undefined
      ? {}
      : { confirmation: { ...this.confirmation } }),
    secretEpoch: this.secretEpoch,
    dirty: this.dirty(),
    connected: this.connected,
    ...(this.errorKey === undefined ? {} : { errorKey: this.errorKey }),
    ...(this.noticeKey === undefined ? {} : { noticeKey: this.noticeKey }),
    discovering: this.pendingDiscovery !== undefined,
    authorizing: this.authorizing,
    ...(this.discoveryErrorKey === undefined
      ? {}
      : { discoveryErrorKey: this.discoveryErrorKey }),
    ...(this.discoveryErrorDetail === undefined
      ? {}
      : { discoveryErrorDetail: this.discoveryErrorDetail }),
    ...(this.discoveryNoticeKey === undefined
      ? {}
      : { discoveryNoticeKey: this.discoveryNoticeKey }),
  });

  select(serverId: string | undefined): void {
    if (
      serverId !== undefined &&
      !this.view?.servers.some((item) => item.server.id === serverId)
    ) return;
    if (serverId === this.selectedServerId) return;
    this.selectionEpoch += 1;
    this.selectedServerId = serverId;
    this.detail = undefined;
    this.logs = [];
    this.logCursor = undefined;
    this.pendingDetail = undefined;
    this.pendingLogs = undefined;
    this.inFlight.delete("detail");
    this.inFlight.delete("logs");
    if (
      this.confirmation !== undefined &&
      this.confirmation.serverId !== serverId
    ) {
      this.confirmation = undefined;
    }
    this.noticeKey = undefined;
    if (serverId !== undefined && this.connected) this.requestDetail(serverId);
    this.notify();
  }

  poll(): void {
    if (!this.connected) return;
    if (!this.inFlight.has("list")) {
      this.inFlight.add("list");
      this.refresh();
    }
    const serverId = this.selectedServerId;
    if (serverId === undefined) return;
    if (!this.inFlight.has("detail")) this.requestDetail(serverId);
    if (!this.inFlight.has("logs")) this.requestLogs(serverId);
  }

  receiveListFailure(): void {
    this.inFlight.delete("list");
    this.errorKey = LIST_LOAD_FAILED_KEY;
    this.notify();
  }

  unavailable(): void {
    if (this.view !== undefined) this.revision += 1;
    this.view = undefined;
    this.selectionEpoch += 1;
    this.inFlight.clear();
    this.pendingDetail = undefined;
    this.pendingLogs = undefined;
    this.pendingByServer.clear();
    this.pendingByRequest.clear();
    this.selectedServerId = undefined;
    this.detail = undefined;
    this.logs = [];
    this.logCursor = undefined;
    this.editor = undefined;
    this.editorBaseline = undefined;
    this.secretRequest = undefined;
    this.confirmation = undefined;
    this.errorKey = undefined;
    this.noticeKey = "unavailable";
    this.clearDiscovery();
    this.clearAuthorization();
    this.clearSensitiveIntent(true);
    this.notify();
  }

  openCreate(): void {
    if (
      !this.connected ||
      this.editorSaveBusy() ||
      this.ownerBusy(CREATE_OWNER)
    ) return;
    this.editor = createDraft();
    this.editorBaseline = structuredClone(comparableDraft(this.editor));
    this.secretRequest = undefined;
    this.clearDiscovery();
    this.clearSensitiveIntent();
    this.notify();
  }

  openEdit(serverId: string): void {
    if (!this.connected || this.editorSaveBusy() || this.ownerBusy(serverId)) {
      return;
    }
    const detail = this.detail?.server.id === serverId
      ? this.detail
      : undefined;
    const item = this.view?.servers.find((candidate) =>
      candidate.server.id === serverId);
    if (detail !== undefined) {
      this.editor = draftFromDetail(detail);
    } else if (item !== undefined) {
      this.editor = draftFromDetail({
        server: item.server,
        status: item.status,
        tools: [],
        secrets: { kind: "unknown" },
      });
    } else {
      return;
    }
    this.editorBaseline = structuredClone(comparableDraft(this.editor));
    this.secretRequest = undefined;
    this.clearDiscovery();
    this.clearSensitiveIntent();
    this.notify();
  }

  closeEditor(): void {
    if (this.editor === undefined || this.editorRuntimeBusy()) return;
    const declined = this.declineSecretRequest(false);
    this.editor = undefined;
    this.editorBaseline = undefined;
    this.secretRequest = undefined;
    this.clearDiscovery();
    this.clearAuthorization();
    this.clearSensitiveIntent(!declined && this.stagedSecretNames.size > 0);
    this.notify();
  }

  setEditorField(field: keyof McpEditorDraft, value: unknown): void {
    if (
      this.editor === undefined ||
      !EDITABLE_FIELDS.has(field) ||
      this.ownerBusy(this.editorOwner())
    ) return;
    (this.editor as unknown as Record<string, unknown>)[field] =
      structuredClone(value);
    delete this.editor.errorKey;
    delete this.editor.errorDetail;
    delete this.editor.secretFailure;
    if (field === "auth") this.pruneUnauthorizedSecrets();
    // A discovery in flight was requested against the previous target.
    if (field === "url" || field === "auth" || field === "transport") {
      this.clearDiscovery();
    }
    this.secretRequest = undefined;
    this.notify();
  }

  stageSecret(name: string, value: string): void {
    const editor = this.editor;
    if (
      editor === undefined ||
      this.ownerBusy(this.editorOwner()) ||
      !authorizedSecretNames(editor).includes(name)
    ) return;
    if (value.trim() === "") this.stagedSecretNames.delete(name);
    else this.stagedSecretNames.add(name);
    delete editor.errorKey;
    delete editor.errorDetail;
    this.notify();
  }

  /**
   * Ask the host to resolve OAuth endpoints from the draft's server URL.
   *
   * Refuses unless an OAuth-over-HTTP draft carries a URL, so the relay never
   * receives a command the contract would drop without replying.
   * @returns whether a request was sent.
   */
  discoverOAuth(): boolean {
    const editor = this.editor;
    if (
      editor === undefined ||
      !this.connected ||
      this.pendingDiscovery !== undefined ||
      this.ownerBusy(this.editorOwner()) ||
      editor.transport !== "streamable-http" ||
      editor.auth.kind !== "oauth"
    ) return false;
    const url = editor.url.trim();
    if (url === "") {
      this.clearDiscovery();
      this.discoveryErrorKey = DISCOVER_NEED_URL_KEY;
      this.notify();
      return false;
    }
    const requestId = this.requestId();
    this.clearDiscovery();
    this.pendingDiscovery = requestId;
    this.send({ kind: "discoverMcpOAuth", requestId, url });
    this.notify();
    return true;
  }

  /**
   * Provision and launch OAuth for the open create draft.
   *
   * Provisioning writes a new catalog record, so an edit draft refuses here and
   * re-authorizes an existing server through {@link startOAuth} instead.
   * @returns whether a request was sent.
   */
  provisionOAuth(): boolean {
    const editor = this.editor;
    if (
      editor === undefined ||
      editor.mode !== "create" ||
      !this.connected ||
      this.view?.oauth.authorization !== "available" ||
      this.view.oauth.discovery !== "available" ||
      editor.transport !== "streamable-http" ||
      editor.auth.kind !== "oauth" ||
      editor.serverName.trim() === "" ||
      editor.url.trim() === "" ||
      this.ownerBusy(this.editorOwner()) ||
      this.authorizing
    ) return false;
    const operation: PendingOperation = {
      requestId: this.requestId(),
      owner: this.editorOwner(),
      stage: "provision",
    };
    this.authorizing = true;
    this.authorizingServerId = undefined;
    this.startOperation(operation, {
      kind: "provisionOAuthServer",
      serverName: editor.serverName.trim(),
      url: editor.url.trim(),
      enabled: editor.enabled,
    });
    return true;
  }

  /**
   * Launch OAuth for the selected existing OAuth server.
   * @returns whether a request was sent.
   */
  startOAuth(): boolean {
    const serverId = this.selectedServerId;
    if (
      serverId === undefined ||
      !this.connected ||
      this.view?.oauth.authorization !== "available" ||
      this.authorizing ||
      this.ownerBusy(serverId)
    ) return false;
    const detailAuth = this.detail?.server.id === serverId
      ? this.detail.server.auth
      : undefined;
    const listAuth = this.view.servers.find((item) =>
      item.server.id === serverId)?.server.auth;
    if ((detailAuth ?? listAuth)?.kind !== "oauth") return false;
    const operation: PendingOperation = {
      requestId: this.requestId(),
      owner: serverId,
      serverId,
      stage: "authorize",
    };
    this.authorizing = true;
    this.authorizingServerId = serverId;
    this.startOperation(operation, { kind: "startOAuth", serverId });
    return true;
  }

  /**
   * Apply a discovery reply to the open draft.
   *
   * Discovered endpoints replace the draft's, while a client id or scope list
   * the authorization server did not publish leaves a hand-entered value in
   * place. A registration secret is reported, never received.
   *
   * @param message - the correlated discovery reply.
   * @returns whether this reply belonged to the open draft.
   */
  receiveDiscovery(message: McpOAuthDiscoveryMessage): boolean {
    if (this.pendingDiscovery !== message.requestId) return false;
    this.pendingDiscovery = undefined;
    const editor = this.editor;
    if (editor === undefined || editor.auth.kind !== "oauth") {
      this.notify();
      return false;
    }
    if (!message.result.ok) {
      this.discoveryErrorKey = DISCOVER_FAILED_KEY;
      this.discoveryErrorDetail = message.result.error.message;
      this.notify();
      return true;
    }
    const discovery = message.result.discovery;
    editor.auth = {
      kind: "oauth",
      clientId: discovery.clientId === ""
        ? editor.auth.clientId
        : discovery.clientId,
      authorizeUrl: discovery.authorizeUrl,
      tokenUrl: discovery.tokenUrl,
      scopes: discovery.scopes.length === 0
        ? [...editor.auth.scopes]
        : [...discovery.scopes],
      redirectPath: editor.auth.redirectPath,
    };
    delete editor.errorKey;
    delete editor.errorDetail;
    if (discovery.clientSecretIssued) {
      this.discoveryNoticeKey = DISCOVER_CLIENT_SECRET_KEY;
    } else if (!discovery.registered && editor.auth.clientId === "") {
      this.discoveryNoticeKey = DISCOVER_NO_CLIENT_ID_KEY;
    }
    this.notify();
    return true;
  }

  /**
   * Whether the open draft composes a record the contract accepts. The relay at
   * the webview-to-host seam drops a command it rejects without replying, so a
   * caller must not offer Save unless this holds.
   * @returns `true` when {@link saveEditor} would send, `false` when it refuses.
   */
  editorValid(): boolean {
    return this.editor !== undefined
      && isMcpServerInputWire(serverInput(this.editor));
  }

  saveEditor(values: SecretValues = {}): boolean {
    const editor = this.editor;
    if (editor === undefined || !this.connected) return false;
    const owner = this.editorOwner();
    if (this.ownerBusy(owner)) return false;
    const server = serverInput(editor);
    if (!isMcpServerInputWire(server)) {
      editor.errorKey = INVALID_RECORD_KEY;
      editor.errorDetail = undefined;
      this.notify();
      return false;
    }
    for (const name of authorizedSecretNames(editor)) {
      const value = values[name];
      if (value === undefined) continue;
      if (value.trim() === "") this.stagedSecretNames.delete(name);
      else this.stagedSecretNames.add(name);
    }
    const secretNames = this.stagedNames();
    const operation: PendingOperation = {
      requestId: this.requestId(),
      owner,
      serverId: editor.serverId,
      stage: "upsert",
      secretNames,
    };
    delete editor.errorKey;
    delete editor.errorDetail;
    delete editor.secretFailure;
    this.secretRequest = undefined;
    this.startOperation(operation, { kind: "upsertServer", server });
    return true;
  }

  continueSecretSave(values: SecretValues): boolean {
    const request = this.secretRequest;
    if (
      request === undefined ||
      !this.connected ||
      this.pendingByServer.has(request.serverId)
    ) return false;
    const names = this.availableSecretNames(values, request.names);
    if (names.length !== request.names.length) return false;
    this.secretRequest = undefined;
    return this.startSecretOperation(
      request.serverId,
      names,
      values,
      [],
    );
  }

  declineSecretSave(): boolean {
    return this.declineSecretRequest(true);
  }

  retrySecrets(values: SecretValues = {}): boolean {
    const editor = this.editor;
    const serverId = editor?.serverId;
    if (
      editor === undefined ||
      serverId === undefined ||
      !this.connected ||
      this.ownerBusy(serverId)
    ) return false;
    const failed = editor.secretFailure?.names ?? [];
    const requested = [...new Set([...failed, ...this.stagedNames()])];
    const names = this.availableSecretNames(values, requested);
    if (names.length === 0) return false;
    const submitted = new Set(names);
    const remainingFailures = failed.filter((name) => !submitted.has(name));
    return this.startSecretOperation(
      serverId,
      names,
      values,
      remainingFailures,
    );
  }

  setEnabled(serverId: string, enabled: boolean): boolean {
    return this.startServerOperation(serverId, "enabled", {
      kind: "setServerEnabled",
      serverId,
      enabled,
    });
  }

  connectServer(serverId: string): boolean {
    return this.startServerOperation(serverId, "connect", {
      kind: "connectServer",
      serverId,
    });
  }

  disconnectServer(serverId: string): boolean {
    return this.startServerOperation(serverId, "disconnect", {
      kind: "disconnectServer",
      serverId,
    });
  }

  toggleTool(serverId: string, toolName: string, enabled: boolean): boolean {
    const tool = this.detail?.server.id === serverId
      ? this.detail.tools.find((candidate) => candidate.name === toolName)
      : undefined;
    if (tool === undefined) return false;
    const rollback = { name: toolName, enabled: tool.enabled };
    const started = this.startServerOperation(serverId, "tool", {
      kind: "setToolEnabled",
      serverId,
      toolName,
      enabled,
    }, rollback);
    if (started) {
      tool.enabled = enabled;
      this.notify();
    }
    return started;
  }

  confirm(kind: "delete" | "clear-oauth", serverId: string): void {
    if (
      !this.connected ||
      this.ownerBusy(serverId) ||
      !this.hasServer(serverId)
    ) return;
    this.confirmation = { kind, serverId };
    this.notify();
  }

  cancelConfirmation(): void {
    if (this.confirmation === undefined) return;
    this.confirmation = undefined;
    this.notify();
  }

  runConfirmed(): boolean {
    const confirmation = this.confirmation;
    if (confirmation === undefined) return false;
    const operation: McpOperationWire = confirmation.kind === "delete"
      ? { kind: "removeServer", serverId: confirmation.serverId }
      : { kind: "clearOAuthTokens", serverId: confirmation.serverId };
    const started = this.startServerOperation(
      confirmation.serverId,
      confirmation.kind === "delete" ? "remove" : "clear-oauth",
      operation,
    );
    if (started) {
      this.confirmation = undefined;
      this.notify();
    }
    return started;
  }

  discardAll(): void {
    for (const operation of this.pendingByServer.values()) {
      if (operation.stage === "upsert") operation.secretNames = [];
    }
    this.confirmation = undefined;
    this.editor = undefined;
    this.editorBaseline = undefined;
    this.secretRequest = undefined;
    this.clearDiscovery();
    this.clearAuthorization();
    this.clearSensitiveIntent(true);
    this.notify();
  }

  receiveDetail(message: McpServerMessage): boolean {
    const pending = this.pendingDetail;
    if (
      pending === undefined ||
      pending.requestId !== message.requestId ||
      pending.epoch !== this.selectionEpoch ||
      pending.serverId !== this.selectedServerId
    ) return false;
    this.pendingDetail = undefined;
    this.inFlight.delete("detail");
    if (!message.result.ok) {
      this.notify();
      return true;
    }
    if (message.result.detail.server.id !== pending.serverId) return false;
    this.detail = structuredClone(message.result.detail);
    if (
      this.authorizingServerId === pending.serverId &&
      message.result.detail.status.state !== "disconnected"
    ) {
      this.clearAuthorization();
    }
    this.notify();
    return true;
  }

  receiveLogs(message: McpLogsMessage): boolean {
    const pending = this.pendingLogs;
    if (
      pending === undefined ||
      pending.requestId !== message.requestId ||
      pending.epoch !== this.selectionEpoch ||
      pending.serverId !== this.selectedServerId
    ) return false;
    this.pendingLogs = undefined;
    this.inFlight.delete("logs");
    if (!message.result.ok) {
      this.notify();
      return true;
    }
    if (message.result.serverId !== pending.serverId) return false;
    this.logs = pending.append
      ? [...this.logs, ...structuredClone(message.result.entries)]
      : structuredClone(message.result.entries);
    this.logCursor = message.result.next;
    this.notify();
    return true;
  }

  receiveOperation(message: McpOperationMessage): boolean {
    const operation = this.pendingByRequest.get(message.requestId);
    if (operation === undefined) return false;
    this.removePending(operation);
    if (!message.result.ok) {
      if (operation.stage === "provision" || operation.stage === "authorize") {
        this.clearAuthorization();
      }
      this.restoreTool(operation);
      if (operation.stage === "secrets") {
        const names = [...new Set([
          ...(operation.remainingSecretFailures ?? []),
          ...(operation.secretNames ?? []),
        ])];
        this.noticeKey = SECRET_FAILED_KEY;
        if (this.operationOwnsEditor(operation)) {
          const editor = this.editor!;
          editor.errorKey = SECRET_FAILED_KEY;
          editor.errorDetail = undefined;
          editor.secretFailure = { names };
        }
      } else {
        this.setOperationError(operation, message.result.error.message);
      }
      this.notify();
      return true;
    }

    if (operation.stage === "remove") {
      this.removeLocalServer(operation.serverId);
      this.notify();
      return true;
    }

    const returnedDetail = message.result.detail;
    if (returnedDetail !== undefined) this.adoptDetail(returnedDetail);
    if (operation.stage === "provision" || operation.stage === "authorize") {
      if (returnedDetail !== undefined) {
        this.authorizingServerId = returnedDetail.server.id;
      }
      this.notify();
      return true;
    }
    if (operation.stage === "upsert") {
      const ownsEditor = this.operationOwnsEditor(operation);
      const serverId = returnedDetail?.server.id ?? operation.serverId;
      if (serverId === undefined) {
        if (ownsEditor) this.setOperationError(operation);
        this.notify();
        return true;
      }
      if (ownsEditor && returnedDetail !== undefined) {
        this.editor = draftFromDetail(returnedDetail);
        this.editorBaseline = structuredClone(comparableDraft(this.editor));
      }
      const names = operation.secretNames ?? [];
      if (ownsEditor && names.length > 0 && this.editor !== undefined) {
        this.secretRequestEpoch += 1;
        this.secretRequest = {
          serverId,
          names: [...names],
          epoch: this.secretRequestEpoch,
        };
        this.notify();
        return true;
      }
      if (ownsEditor) this.finishEditorSave();
      else this.notify();
      return true;
    }
    if (operation.stage === "secrets") {
      if (!this.operationOwnsEditor(operation)) {
        this.notify();
        return true;
      }
      for (const name of operation.secretNames ?? []) {
        this.stagedSecretNames.delete(name);
      }
      const remaining = operation.remainingSecretFailures ?? [];
      if (this.editor !== undefined && remaining.length > 0) {
        this.editor.secretFailure = { names: [...remaining] };
        this.editor.errorKey = SECRET_FAILED_KEY;
        this.editor.errorDetail = undefined;
      } else if (this.stagedSecretNames.size === 0) {
        this.secretEpoch += 1;
        this.finishEditorSave();
        return true;
      }
      this.notify();
      return true;
    }
    this.notify();
    return true;
  }

  private requestDetail(serverId: string): void {
    const requestId = this.requestId();
    this.inFlight.add("detail");
    this.pendingDetail = {
      requestId,
      serverId,
      epoch: this.selectionEpoch,
    };
    this.send({ kind: "getMcpServer", requestId, serverId });
  }

  private requestLogs(serverId: string): void {
    const requestId = this.requestId();
    const after = this.logCursor;
    this.inFlight.add("logs");
    this.pendingLogs = {
      requestId,
      serverId,
      epoch: this.selectionEpoch,
      append: after !== undefined,
    };
    this.send({
      kind: "getMcpLogs",
      requestId,
      serverId,
      ...(after === undefined ? {} : { after }),
    });
  }

  private startServerOperation(
    serverId: string,
    stage: Exclude<
      OperationStage,
      "upsert" | "provision" | "authorize" | "secrets"
    >,
    wire: McpOperationWire,
    toolRollback?: { name: string; enabled: boolean },
  ): boolean {
    if (
      !this.connected ||
      !this.hasServer(serverId) ||
      this.ownerBusy(serverId)
    ) return false;
    const operation: PendingOperation = {
      requestId: this.requestId(),
      owner: serverId,
      serverId,
      stage,
      ...(toolRollback === undefined ? {} : { toolRollback }),
    };
    this.startOperation(operation, wire);
    return true;
  }

  private startSecretOperation(
    serverId: string,
    names: readonly string[],
    values: SecretValues,
    remainingSecretFailures: readonly string[],
  ): boolean {
    if (!this.connected || this.pendingByServer.has(serverId)) return false;
    const secrets = names.flatMap((name) => {
      const value = values[name]?.trim() ?? "";
      return value === "" ? [] : [{ name, value }];
    });
    if (secrets.length !== names.length || secrets.length === 0) return false;
    const sentNames = secrets.map((secret) => secret.name);
    const operation: PendingOperation = {
      requestId: this.requestId(),
      owner: serverId,
      serverId,
      stage: "secrets",
      secretNames: sentNames,
      remainingSecretFailures: [...remainingSecretFailures],
    };
    if (this.operationOwnsEditor(operation)) {
      const editor = this.editor!;
      delete editor.errorKey;
      delete editor.errorDetail;
      delete editor.secretFailure;
    }
    this.startOperation(operation, {
      kind: "setServerSecrets",
      serverId,
      secrets,
    });
    return true;
  }

  private startOperation(
    operation: PendingOperation,
    wire: McpOperationWire,
  ): void {
    this.pendingByServer.set(operation.owner, operation);
    this.pendingByRequest.set(operation.requestId, operation);
    this.send({
      kind: "runMcpOperation",
      requestId: operation.requestId,
      operation: wire,
    });
    this.notify();
  }

  private removePending(operation: PendingOperation): void {
    if (this.pendingByServer.get(operation.owner) === operation) {
      this.pendingByServer.delete(operation.owner);
    }
    this.pendingByRequest.delete(operation.requestId);
  }

  private settleVanished(operation: PendingOperation): void {
    this.removePending(operation);
    this.restoreTool(operation);
    this.setOperationError(operation);
    this.noticeKey = SERVER_REMOVED_KEY;
  }

  private setOperationError(
    operation: PendingOperation,
    foreignValidationDetail?: string,
  ): void {
    const editor = this.editor;
    this.noticeKey = operation.stage === "secrets"
      ? SECRET_FAILED_KEY
      : OPERATION_FAILED_KEY;
    if (
      (operation.stage !== "upsert" && operation.stage !== "provision") ||
      editor === undefined ||
      !this.operationOwnsEditor(operation)
    ) return;
    editor.errorKey = OPERATION_FAILED_KEY;
    if (
      (operation.stage === "upsert" || operation.stage === "provision") &&
      foreignValidationDetail !== undefined
    ) {
      editor.errorDetail = foreignValidationDetail;
    } else {
      editor.errorDetail = undefined;
    }
  }

  private restoreTool(operation: PendingOperation): void {
    const rollback = operation.toolRollback;
    const detail = this.detail;
    if (
      rollback === undefined ||
      detail === undefined ||
      detail.server.id !== operation.serverId
    ) return;
    const tool = detail.tools.find((candidate) =>
      candidate.name === rollback.name);
    if (tool !== undefined) tool.enabled = rollback.enabled;
  }

  private adoptDetail(detail: McpServerDetailWire): void {
    if (this.selectedServerId === detail.server.id) {
      this.detail = structuredClone(detail);
    }
    if (this.view !== undefined) {
      const existing = this.view.servers.find((item) =>
        item.server.id === detail.server.id);
      const listItem: McpServerListItemWire = {
        server: structuredClone(detail.server),
        status: structuredClone(detail.status),
        toolCount: detail.tools.length,
        disabledToolCount: detail.tools.filter((tool) => !tool.enabled).length,
      };
      this.view = {
        ...this.view,
        servers: existing === undefined
          ? [...this.view.servers, listItem]
          : this.view.servers.map((item) =>
            item.server.id === detail.server.id ? listItem : item),
      };
      this.revision += 1;
    }
  }

  private removeLocalServer(serverId: string | undefined): void {
    if (serverId === undefined) return;
    if (this.view?.servers.some((item) => item.server.id === serverId)) {
      this.view = {
        ...this.view,
        servers: this.view.servers.filter((item) => item.server.id !== serverId),
      };
      this.revision += 1;
    }
    if (this.selectedServerId === serverId) this.clearSelection(false);
    if (this.editor?.serverId === serverId) {
      this.editor = undefined;
      this.editorBaseline = undefined;
      this.clearSensitiveIntent(true);
    }
  }

  private clearSelection(removed: boolean): void {
    this.selectionEpoch += 1;
    this.selectedServerId = undefined;
    this.detail = undefined;
    this.logs = [];
    this.logCursor = undefined;
    this.pendingDetail = undefined;
    this.pendingLogs = undefined;
    this.inFlight.delete("detail");
    this.inFlight.delete("logs");
    if (removed) this.noticeKey = SERVER_REMOVED_KEY;
  }

  private clearDiscovery(): void {
    this.pendingDiscovery = undefined;
    this.discoveryErrorKey = undefined;
    this.discoveryErrorDetail = undefined;
    this.discoveryNoticeKey = undefined;
  }

  private clearAuthorization(): void {
    this.authorizing = false;
    this.authorizingServerId = undefined;
  }

  private clearSensitiveIntent(forceEpoch = false): void {
    if (forceEpoch || this.stagedSecretNames.size > 0) this.secretEpoch += 1;
    this.stagedSecretNames.clear();
    this.secretRequest = undefined;
    if (this.editor !== undefined) delete this.editor.secretFailure;
  }

  private pruneUnauthorizedSecrets(): void {
    if (this.editor === undefined) return;
    const allowed = new Set(authorizedSecretNames(this.editor));
    for (const name of this.stagedSecretNames) {
      if (!allowed.has(name)) this.stagedSecretNames.delete(name);
    }
    if (this.editor.secretFailure !== undefined) {
      const names = this.editor.secretFailure.names.filter((name) =>
        allowed.has(name));
      if (names.length === 0) delete this.editor.secretFailure;
      else this.editor.secretFailure = { names };
    }
    if (this.secretRequest !== undefined) {
      const names = this.secretRequest.names.filter((name) => allowed.has(name));
      this.secretRequest = names.length === 0
        ? undefined
        : { ...this.secretRequest, names };
    }
  }

  private availableSecretNames(
    values: SecretValues,
    requested: readonly string[] = [...this.stagedSecretNames],
  ): string[] {
    const allowed = new Set(
      this.editor === undefined ? [] : authorizedSecretNames(this.editor),
    );
    return [...new Set(requested)].filter((name) =>
      allowed.has(name) && (values[name]?.trim() ?? "") !== "");
  }

  private stagedNames(): string[] {
    const allowed = new Set(
      this.editor === undefined ? [] : authorizedSecretNames(this.editor),
    );
    return [...this.stagedSecretNames].filter((name) => allowed.has(name));
  }

  private finishEditorSave(): void {
    this.editor = undefined;
    this.editorBaseline = undefined;
    this.secretRequest = undefined;
    this.notify();
  }

  private declineSecretRequest(notify: boolean): boolean {
    const request = this.secretRequest;
    const editor = this.editor;
    if (
      request === undefined ||
      editor === undefined ||
      editor.mode !== "edit" ||
      editor.serverId !== request.serverId
    ) return false;
    for (const name of request.names) this.stagedSecretNames.delete(name);
    this.secretRequest = undefined;
    this.secretEpoch += 1;
    this.noticeKey = SECRET_DECLINED_KEY;
    editor.errorKey = SECRET_DECLINED_KEY;
    editor.errorDetail = undefined;
    delete editor.secretFailure;
    if (notify) this.notify();
    return true;
  }

  private operationOwnsEditor(operation: PendingOperation): boolean {
    const editor = this.editor;
    if (editor === undefined) return false;
    if (
      (operation.stage === "upsert" || operation.stage === "provision") &&
      operation.owner === CREATE_OWNER
    ) {
      return editor.mode === "create";
    }
    return (
      (
        operation.stage === "upsert" ||
        operation.stage === "provision" ||
        operation.stage === "secrets"
      ) &&
      operation.serverId !== undefined &&
      editor.mode === "edit" &&
      editor.serverId === operation.serverId
    );
  }

  private editorRuntimeBusy(): boolean {
    const editor = this.editor;
    if (editor === undefined) return false;
    const operation = this.pendingByServer.get(this.editorOwner());
    return (
      operation?.stage === "upsert" ||
      operation?.stage === "provision" ||
      operation?.stage === "secrets"
    );
  }

  private editorSaveBusy(): boolean {
    if (this.editorRuntimeBusy()) return true;
    const editor = this.editor;
    return (
      editor?.mode === "edit" &&
      this.secretRequest?.serverId === editor.serverId
    );
  }

  private editorOwner(): string {
    return this.editor?.serverId ?? CREATE_OWNER;
  }

  private ownerBusy(owner: string): boolean {
    return (
      this.pendingByServer.has(owner) ||
      this.secretRequest?.serverId === owner
    );
  }

  private hasServer(serverId: string): boolean {
    return this.view?.servers.some((item) => item.server.id === serverId) === true;
  }

  private dirty(): boolean {
    if (this.editor === undefined) return false;
    return (
      this.stagedSecretNames.size > 0 ||
      this.editor.secretFailure !== undefined ||
      JSON.stringify(comparableDraft(this.editor)) !==
        JSON.stringify(this.editorBaseline)
    );
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

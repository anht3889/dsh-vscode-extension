# DSH VS Code Plugin Settings Design — MCP and Web Search

## Status

Approved in chat on 2026-08-23. This document defines two new top-level settings sections in the DSH VS Code extension — MCP and Web Search — that operate against the already-installed `@anht3889/dsh-mcp-mgmt-bundle` and `@anht3889/dsh-web-search-bundle` plugins. It extends [2026-08-23-dsh-vscode-settings-parity-design.md](2026-08-23-dsh-vscode-settings-parity-design.md), which remains authoritative for the modal shell, General, Models, Plugins, Agent Presets, and Extension sections.

This is a cross-repository design. It changes `/Users/anhtra/workspace/dsh-vscode-extension` and `/Users/anhtra/workspace/dsh-web-search`. It requires no change to `/Users/anhtra/workspace/dsh-mcp-management` to ship, and makes one recommendation for a later MCP release.

## 1. Goal and non-goals

### Goal

DSH Web shows top-level MCP and Web Search settings sections because both plugins ship browser code that the DSH Web client runtime loads into its settings slot registry. The same two plugins are installed and active in the `vscode` profile, where their Host managers own the MCP catalog, the web-search catalog, and every secret; but the extension webview has no DSH client runtime, so the sections are absent and the two capabilities are unmanageable from the editor. This design adds extension-owned MCP and Web Search sections that read and write the installed plugins' runtimes through the extension's existing closed NDJSON settings protocol.

The plugins remain the runtime authorities. The extension owns presentation and a projection; it never owns MCP connections, the MCP catalog, the web-search catalog, or any secret store. Removing a plugin removes its section; it does not degrade the extension into a second implementation.

### Non-goals

- Do not load plugin browser bundles (`@anht3889/dsh-mcp-mgmt-bundle/client`, `@anht3889/dsh-web-search-bundle/client`) in the VS Code webview, and do not add a client runtime, slot registry, or dynamic plugin-UI framework to the webview.
- Do not start a DSH web server, loopback HTTP API, or `publicOrigin` in the `vscode` profile so that the plugins' own HTTP routes become reachable. Superseded by `2026-08-24-dsh-vscode-mcp-oauth-onboarding-design.md`.
- Do not reimplement MCP transport, connection supervision, OAuth token exchange, catalog persistence, or search-engine adapters in the extension.
- Do not implement OAuth authorization launch or callback handling in this phase. Superseded by `2026-08-24-dsh-vscode-mcp-oauth-onboarding-design.md`.
- Do not expose a stored secret value to the extension host, the webview, logs, or snapshots.
- Do not add a compatibility shim for protocol version 5 clients or for plugin builds that predate the surfaces this design uses.
- Do not virtualize the server list, tool list, or log view in this phase.

### Explicit difference from DSH Web slot loading

DSH Web composes settings sections at runtime: a bundle declares `dsh.client.platform: web` plus a client inject list, the DSH Web build loads that browser entry, and the entry registers a section into `@deepseek-ai/dsh-client-ui-settings`. The section then talks to its own plugin over a loopback HTTP API (`/mcp-management`, `/web-search`) served by the profile's web server.

The extension webview has none of those three pieces. It has no client runtime and no slot registry, it has no web server to call, and its content security policy admits only the extension's own bundled script. Loading arbitrary plugin browser bundles into the webview would mean shipping a plugin loader and widening the CSP for third-party code inside the editor's trusted surface; adding a web server for settings would mean opening a local listening port for every editor window.

So parity is achieved by inversion. Instead of the plugin shipping UI into a host runtime, the extension ships UI for a known capability and reaches the plugin through a Cordis service inside the same `dsh` child process, projecting the result as dependency-free redacted records over the existing NDJSON protocol. The consequence is deliberate: the extension supports exactly the two capabilities it has UI for, a third-party plugin gains no automatic editor UI, and every field crossing the process line is named by the closed contract.

## 2. Architecture and service ownership

### Process layout

One `dsh --profile vscode` child process per editor window hosts the Cordis tree. The `vscode-runner` bridge plugin lives in that tree, so it reads mounted services directly through `ctx`. The extension host relays NDJSON between the child's stdio and the webview. The webview renders.

```
webview (React)            extension host (VS Code)        dsh child (Cordis tree)
  MCP section                                                mcp-manager plugin ── ctx.mcp
  Web Search section  ◀── NDJSON relay, no interpretation ──▶ dsh-web-search plugin ── ctx.webSearchManager
  settings reducer                                           vscode-runner bridge
                                                               settings coordinator
                                                               mcp adapter, web-search adapter
```

### Ownership

| Layer | Responsibilities |
|---|---|
| MCP plugin (`dsh-mcp-management`) | MCP catalog persistence, connection supervision, tool registration, OAuth tokens, server secret store, record validation |
| Web Search plugin (`dsh-web-search`) | Web-search catalog persistence and validation, API-key secret store, engine adapters, the registered search provider |
| Bridge adapters | Optional-service probe, projection to closed wire records, wire-form validation, bounds, redaction, latest-request-wins, invalidation |
| Extension host | Opaque relay of the new message families; no interception, no new host command |
| Webview | Section navigation, drafts, polling cadence, dialogs, bilingual copy, component-local secret staging, accessibility |

### Service availability is the only gate

A section exists when and only when its service is mounted in the active profile and passes the bounded probe. The bridge probes at runner creation, on late mount, and on unload through Cordis global `ctx.on('internal/service', ..., { global: true })` for the `mcp` and `webSearchManager` service names — `pluginInventory` has no event API — then reports the result as a capability list. A missing or structurally incomplete service is not an error: no nav row, no request, no error banner, no dead row. This is the same rule the existing Plugins section applies to an unmounted namespace, raised to the section level.

### The extension takes no static dependency on either plugin

Both plugins are optional, out-of-tree, and versioned independently of the extension. The bridge therefore declares its own structural interface for each service and reads it through Cordis's untyped accessor overload, `get(name: string, strict?: boolean)`. The bridge imports nothing from `@anht3889/*` at build time, so a workspace without either plugin still typechecks, builds, and passes its gates.

Because the value crosses an untyped plugin line, the probe is a bounded runtime check, not a cast: it accepts the service only when every required member is a function. A mounted object missing a required member is loud misconfiguration — the nav capability is withheld and the bridge logs one warning per registration generation rather than failing at first click. This is the documented exception to "trust TypeScript at typed same-process boundaries": the boundary is an optional foreign plugin, not a typed in-repo interface.

## 3. Optional service contracts

### MCP: consume the installed surface, formalize it later

`ctx.mcp` is published by `@anht3889/dsh-mcp-mgmt-bundle/manager` as a `McpManagerRuntime`. Its declared Service Definition, `McpRuntime` in `@anht3889/dsh-mcp-mgmt-mcp`, covers `list`, `get`, `upsert`, `remove`, `setEnabled`, `connect`, `disconnect`, `getStatus`, `getLogs`, `getTools`, `setToolEnabled`, `startOAuth`, `clearOAuth`, and `setSecrets`. The concrete runtime additionally implements `describeSecrets`, `discoverOAuth`, `oauthCallbackPaths`, `onCatalogChanged`, and `handleOAuthCallback`, which the declared interface omits.

The bridge declares this structural service locally, with the extended members optional:

```ts
/** Structural view of `ctx.mcp` used by the bridge; the plugin is optional. */
interface McpManagementService {
  list(): McpServerRecordLike[];
  get(id: string): McpServerRecordLike | undefined;
  upsert(record: McpServerRecordLike): Promise<McpServerRecordLike>;
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  connect(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  getStatus(id: string): McpConnectionStatusLike;
  getLogs(id: string, after?: number): { next: number; entries: McpLogEntryLike[] };
  getTools(id: string): McpToolInfoLike[];
  setToolEnabled(id: string, toolName: string, enabled: boolean): Promise<void>;
  clearOAuth(id: string): Promise<void>;
  setSecrets(id: string, secrets: Record<string, string>): Promise<void>;
  describeSecrets?(id: string): Promise<Record<string, { configured: boolean }>>;
  onCatalogChanged?(listener: () => void): () => void;
}
```

`McpServerRecordLike`, `McpConnectionStatusLike`, `McpToolInfoLike`, and `McpLogEntryLike` are bridge-local mirrors of the plugin's data-only types, with `id` as a plain `string` because the plugin's brand is a compile-time-only nominal type that the bridge cannot import.

Required members are the thirteen non-optional entries above. The probe rejects a service missing any of them. `describeSecrets` and `onCatalogChanged` are optional at the type level and degrade explicitly: without `describeSecrets` the UI reports every server secret as `unknown` and says so; without `onCatalogChanged` the section relies on its own polling and its own command results, and no push invalidation is emitted.

`startOAuth`, `discoverOAuth`, `oauthCallbackPaths`, and `handleOAuthCallback` are deliberately absent from the bridge's service. They require a callback origin, which the `vscode` profile cannot supply (section 5).

**Recommendation.** Do not change `dsh-mcp-management` to ship this phase; the installed bundle already satisfies the probe. In the next MCP release, promote `describeSecrets(id)` and `onCatalogChanged(listener)` from incidental runtime methods to declared members of `McpRuntime` in `@anht3889/dsh-mcp-mgmt-mcp`, so that secret-state reporting and catalog change notification become contract rather than accident for every consumer. Keep the bridge's structural service and its optional treatment of both members regardless, because the extension must run against installed versions it did not build.

### Web Search: publish the management runtime as a named service

`WebSearchRuntime` is currently private to `@anht3889/dsh-web-search-bundle/manager`. The plugin registers only `runtime.provider()` on `ctx.web` and exposes management operations solely over the loopback HTTP API. In the `vscode` profile there is no web server, so the runtime is unreachable, which is the sole reason the Web Search section cannot exist today.

Add a dependency-minimal seam package in `dsh-web-search`, mirroring `@anht3889/dsh-mcp-mgmt-mcp`:

```ts
/** @module @anht3889/dsh-web-search-service */
declare module '@deepseek-ai/cordis' {
  interface Context {
    webSearchManager: WebSearchManagement
  }
}

/**
 * Service Definition for web-search configuration management, published on
 * `ctx.webSearchManager` by a provider that calls
 * `ctx.provide('webSearchManager', runtime)`.
 *
 * The seam is a type, not a `Service` subclass, for the same reason the MCP
 * seam is: an out-of-tree plugin installed into a `dsh` profile cannot resolve
 * the installation's `@deepseek-ai/cordis` copy at runtime.
 */
export interface WebSearchManagement {
  /** @returns the current in-memory catalog. */
  getCatalog(): WebSearchCatalog
  /**
   * @param catalog - candidate catalog, validated during persistence.
   * @returns the catalog after durable persistence succeeds.
   */
  putCatalog(catalog: WebSearchCatalog): Promise<WebSearchCatalog>
  /** @returns value-free configured state for every supported API key. */
  describeSecrets(): Promise<Record<WebSearchSecretRef, { configured: boolean }>>
  /**
   * Stores the supplied non-empty values and leaves omitted keys unchanged.
   * @param partial - supported secret values to update.
   */
  putSecrets(partial: Partial<Record<WebSearchSecretRef, string>>): Promise<void>
  /** @returns whether the selected engine and its base URL are usable now. */
  available(): boolean
  /**
   * @param listener - called after a successful `putCatalog` or `putSecrets`.
   * @returns a disposer that removes the listener.
   */
  onChanged(listener: () => void): () => void
}
```

`WebSearchCatalog`, `SearchEngineId`, `WebSearchSecretRef`, `EMPTY_CATALOG`, `ENGINE_IDS`, `TAVILY_DEFAULT_BASE_URL`, and `BRAVE_DEFAULT_BASE_URL` move to this seam package and are re-exported from `@anht3889/dsh-web-search-bundle/manager/types`, so the bundle's existing browser and Host consumers keep their import paths.

Every member is an existing runtime operation. `getCatalog`, `putCatalog`, `describeSecrets`, and `putSecrets` are the four methods `WebSearchRuntime` already implements and the HTTP API already exposes. `available()` returns `this.provider().available()` — the same value the plugin's own `configView` returns — so no consumer re-derives engine validity. `onChanged` is the one addition, the change notification the constraints allow; the runtime notifies only after a successful `putCatalog` or `putSecrets`, and the plugin clears its listener set through `ctx.effect` at fiber unload. No new persistence, no new validation, no new engine behavior.

The manager plugin publishes the service and continues to register the same provider instance:

```ts
ctx.effect(() => ctx.web.registerSearchProvider(runtime.provider()), 'dsh-web-search.provider')
ctx.provide('webSearchManager', runtime)
```

The bridge declares the same members as a local structural service, with `onChanged` optional so a build that publishes the service before adding notification still yields a working section. `getCatalog`, `putCatalog`, `describeSecrets`, `putSecrets`, and `available` are required.

### Why a service and not a settings namespace

Neither catalog is a DSH settings namespace. Both are plugin-owned files (`$DSH_HOME/mcp/servers.json`, `$DSH_HOME/web-search/config.json`) with their own validation, atomic writes, and live effects, and MCP additionally holds process-lifetime connection state that no settings document can express. Modelling them as namespaces would duplicate validation and split ownership. The new sections therefore carry no `SettingsNamespaceWire`, take no `expectedRevision`, and never reach `settings.mutate`.

## 4. Protocol version 6

Protocol version rises from 5 to 6 in `packages/contract/src/protocol.ts`. Extension and bridge ship together; a version-5 peer is rejected by the existing handshake mismatch path with no shim.

### Section identifiers

```ts
type SettingsSectionId =
  | "general" | "models" | "plugins" | "agent-presets" | "mcp" | "web-search";

/** Sections that exist only while their plugin service is mounted. */
type OptionalSettingsSectionId = "mcp" | "web-search";
```

`SettingsErrorWire.code` gains `"mcp-rejected"` and `"web-search-rejected"`. `SettingsInvalidatedMessage.reason` gains `"mcp"` and `"web-search"`.

### Capability announcement

Nav rows appear dynamically through one message:

```ts
interface SettingsCapabilitiesMessage {
  kind: "settingsCapabilities";
  /** Present only in reply to `getSettingsCapabilities`. */
  requestId?: string;
  /** Optional sections whose service is mounted now, in nav order. */
  sections: OptionalSettingsSectionId[];
}

interface GetSettingsCapabilitiesCommand {
  kind: "getSettingsCapabilities";
  requestId: string;
}
```

The webview requests capabilities on every bridge ready and reconnect, alongside the existing background General load, and the bridge answers with a correlated message. The bridge also pushes an unsolicited `settingsCapabilities` without `requestId` whenever an `internal/service` event changes the mounted set, so mounting or unloading a plugin mid-session updates the nav without a user action. Validation requires `sections` to be a duplicate-free subset of the two optional ids and `requestId`, when present, to be a non-empty string. Capabilities are solicited rather than replayed by the host because the extension host relays outbound messages without retaining them; adding retention for one message family would put protocol knowledge into the relay.

`general`, `models`, `plugins`, and `agent-presets` are never listed: they are unconditional and their own unavailable states already cover a missing service.

A request for an optional section whose service is absent — a webview that asks before a capability update lands, or a plugin unloaded between the request and its handling — answers `settings-unavailable` rather than an empty view, and every operation on that capability answers the same way. Capability announcement decides what the nav offers; the per-request check decides what the bridge does.

### Inbound families

`McpTransportWire`, `McpAuthWire`, and `WebSearchCatalogWire` are shared by both directions and are defined under shared wire types below.

```ts
interface GetMcpServerCommand {
  kind: "getMcpServer";
  requestId: string;
  serverId: string;
}

interface GetMcpLogsCommand {
  kind: "getMcpLogs";
  requestId: string;
  serverId: string;
  /** Exclusive cursor from a prior logs response. */
  after?: number;
}

/**
 * Editable record fields. The bridge owns the id, both timestamps, and the
 * routing of validation to the plugin. `disabledTools` is absent because tool
 * selection belongs to `setToolEnabled`; an edit preserves the stored list.
 */
interface McpServerInputWire {
  /** Absent for a create; the target record for an edit. */
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

type McpOperationWire =
  | { kind: "upsertServer"; server: McpServerInputWire }
  | { kind: "removeServer"; serverId: string }
  | { kind: "setServerEnabled"; serverId: string; enabled: boolean }
  | { kind: "connectServer"; serverId: string }
  | { kind: "disconnectServer"; serverId: string }
  | { kind: "setToolEnabled"; serverId: string; toolName: string; enabled: boolean }
  | { kind: "setServerSecrets"; serverId: string; secrets: { name: string; value: string }[] }
  | { kind: "clearOAuthTokens"; serverId: string };

interface RunMcpOperationCommand {
  kind: "runMcpOperation";
  requestId: string;
  operation: McpOperationWire;
}

interface SetWebSearchConfigCommand {
  kind: "setWebSearchConfig";
  requestId: string;
  catalog: WebSearchCatalogWire;
  /** Non-empty values only; omitted refs stay unchanged. */
  secrets: { ref: WebSearchSecretRefWire; value: string }[];
}
```

`getSettingsSection` accepts `"mcp"` and `"web-search"` and answers with the two new views. `mutateSettings`, `setCredential`, and `unsetCredential` are unchanged and never target the new sections.

Inbound records may carry secret values, exactly as `SetCredentialCommand` already does; the outbound credential-leak scan applies only to outbound messages.

### Shared wire types

Transport, auth, and catalog records below travel in both directions; every other record is outbound only.

```ts
type McpTransportWire = "stdio" | "streamable-http";

type McpAuthWire =
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

interface McpServerWire {
  id: string;
  serverName: string;
  enabled: boolean;
  transport: McpTransportWire;
  command?: string;
  args?: string[];
  /** Environment pairs; an array keeps every key inside the closed scan. */
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

type McpStatusWire =
  | { state: "disconnected" }
  | { state: "connecting"; attempt: number }
  | { state: "connected"; toolCount: number; connectedAt: string }
  | { state: "reconnecting"; attempt: number; nextDelayMs: number }
  | { state: "failed"; error: string; at: string };

type McpSecretStateWire =
  | { kind: "known"; secrets: { name: string; configured: boolean }[] }
  | { kind: "unknown" };

interface McpServerListItemWire {
  server: McpServerWire;
  status: McpStatusWire;
  /** Tools listed by the most recent successful connection. */
  toolCount: number;
  /** Tools withheld from the harness registry by `disabledTools`. */
  disabledToolCount: number;
}

interface McpToolWire {
  name: string;
  description: string;
  enabled: boolean;
}

interface McpServerDetailWire {
  server: McpServerWire;
  status: McpStatusWire;
  tools: McpToolWire[];
  secrets: McpSecretStateWire;
}

interface McpLogEntryWire {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
}

/** Authorization launch support in the active profile. */
type McpOAuthSupportWire =
  | { kind: "manual"; reason: "no-callback-origin" };

interface McpSettingsView {
  section: "mcp";
  servers: McpServerListItemWire[];
  /** Whether the runtime can report server secret states. */
  secretStates: "available" | "unavailable";
  oauth: McpOAuthSupportWire;
}

type WebSearchEngineWire = "tavily" | "brave" | "searxng";
type WebSearchSecretRefWire = "TAVILY_API_KEY" | "BRAVE_API_KEY";

interface WebSearchCatalogWire {
  engine: WebSearchEngineWire | null;
  engines: { engine: WebSearchEngineWire; baseURL?: string }[];
}

interface WebSearchEngineWireInfo {
  engine: WebSearchEngineWire;
  /** Configured override, absent when the engine uses its default. */
  baseURL?: string;
  /** Published default, absent for SearXNG, which has none. */
  defaultBaseURL?: string;
  /** Whether a base URL is required once this engine is selected. */
  baseURLRequired: boolean;
  /** Secret this engine needs, absent for SearXNG. */
  secretRef?: WebSearchSecretRefWire;
}

interface WebSearchSecretStateWire {
  ref: WebSearchSecretRefWire;
  configured: boolean;
  writable: boolean;
}

interface WebSearchSettingsView {
  section: "web-search";
  engine: WebSearchEngineWire | null;
  engines: WebSearchEngineWireInfo[];
  secrets: WebSearchSecretStateWire[];
  /** The provider's own availability for the current catalog. */
  available: boolean;
}
```

### Outbound message families

```ts
interface McpServerMessage {
  kind: "mcpServer";
  requestId: string;
  result:
    | { ok: true; detail: McpServerDetailWire }
    | { ok: false; error: SettingsErrorWire };
}

interface McpLogsMessage {
  kind: "mcpLogs";
  requestId: string;
  result:
    | { ok: true; serverId: string; next: number; entries: McpLogEntryWire[] }
    | { ok: false; error: SettingsErrorWire };
}

interface McpOperationMessage {
  kind: "mcpOperation";
  requestId: string;
  result:
    | { ok: true; detail?: McpServerDetailWire }
    | { ok: false; error: SettingsErrorWire };
}

interface WebSearchMutationMessage {
  kind: "webSearchMutation";
  requestId: string;
  result:
    | {
        ok: true;
        view: WebSearchSettingsView;
        /** Empty on full success; one generic ref-only entry per key that failed to store. */
        secretFailures: { ref: WebSearchSecretRefWire; message: string }[];
      }
    | { ok: false; error: SettingsErrorWire };
}
```

`mcpOperation` omits `detail` when the operation removed the server. Every other operation returns the fresh detail so the UI does not wait for a poll.

`SETTINGS_INBOUND_KINDS` gains `getSettingsCapabilities`, `getMcpServer`, `getMcpLogs`, `runMcpOperation`, and `setWebSearchConfig`. `SETTINGS_OUTBOUND_KINDS` gains `settingsCapabilities`, `mcpServer`, `mcpLogs`, `mcpOperation`, and `webSearchMutation`.

### No Node or plugin types on the wire

Every new record above is a plain structural type in `@dsh-vscode/contract` with no import from `@deepseek-ai/*` or `@anht3889/*`. Server ids and tool names are plain strings validated by pattern and length; the bridge is the only place that converts them toward plugin brands. `env` is an array of `{ name, value }` pairs rather than a `Record<string, string>` so that closed-key validation applies to every key on the wire, and so that the outbound leak scan cannot be defeated by an attacker-chosen key name.

### Bounds

Every bound is a safety valve above a realistic install, never a product limit. Exceeding one fails the request closed with an explicit error; it never silently truncates a server, tool, or log entry.

| Bound | Value |
|---|---|
| Servers per MCP view | 64 |
| Tools per server detail | 256 |
| Log entries per response | 512 |
| `args` entries / `env` entries | 64 / 64 |
| `headerNames` / `scopes` / `disabledTools` | 32 / 32 / 256 |
| Secret entries per `setServerSecrets` | 32 |
| Identifier, name, command, path, header, tool-name characters | 1,024 |
| URL characters | 2,048 |
| Log message / log detail characters | 2,048 / 4,096 |
| Secret value characters | 8,192 |
| MCP list-view nodes / detail nodes / logs-message nodes | 40,960 / 8,192 / 16,384 |
| Web Search view nodes | 256 |
| Projection depth for any new view | 16 |

`SETTINGS_WIRE_SCAN_NODE_LIMIT` stays at 65,536: it exceeds the largest producer, a maximal MCP list message at 36,874 visited nodes including its three-node envelope, and its 40,960 bridge ceiling. The Models view is the second-largest producer. A cap-consistency test asserts that relation for each new ceiling, so raising a bridge cap past the scan budget fails the suite instead of turning a legitimate large message into a suspected leak.

The MCP list ceiling accounts for the validator's actual scan cost: one maximal list item costs 576 visited nodes because the mutually exclusive transports cannot emit `command` and `url` together, so 64 items plus the seven-node view shell cost 36,871 nodes. The three-node message envelope raises the total to 36,874. The 40,960 ceiling admits that documented maximum while remaining below the 65,536 wire budget; 8,192 would reject a payload that satisfied every per-collection cap.

Numeric fields are validated as finite numbers in their documented ranges: `toolCallTimeoutMs` and every `reconnect` duration must be positive integers, `maxAttempts` a non-negative integer, `attempt` and `nextDelayMs` non-negative, `toolCount` and `disabledToolCount` non-negative, `next` a non-negative integer. Timestamps are non-empty strings; the bridge emits ISO-8601 values produced by the plugin and does not reformat them.

## 5. MCP section

### Data model and load path

Opening the section issues `getSettingsSection { section: "mcp" }`. The bridge reads `list()` and, per record, `getStatus(id)` and `getTools(id)`, and projects one `McpServerListItemWire` each. `secretStates` reports whether the mounted runtime offers `describeSecrets`. `oauth` is always `{ kind: "manual", reason: "no-callback-origin" }` in this phase.

Selecting a server issues `getMcpServer`, which adds tools with their registration state and, when `describeSecrets` exists, the value-free configured state of every secret the record implies — the declared header names for `headers` auth, and `OAUTH_ACCESS`, `OAUTH_REFRESH`, `OAUTH_EXPIRES_AT`, `OAUTH_CLIENT_SECRET` for `oauth` auth. Without `describeSecrets` the detail carries `{ kind: "unknown" }` and the UI states that this DSH build cannot report key state.

Log reading is incremental: the first `getMcpLogs` for a selection omits `after` and replaces the view, and each later request passes the previous `next` and appends. Changing selection resets the cursor and the buffer. The plugin retains 500 entries per server, so a client that polls slower than the server logs loses intermediate lines by design; the response cursor makes that loss visible rather than silent.

### Commands

| UI action | Operation | Runtime call |
|---|---|---|
| Add server, Save edits | `upsertServer` | `upsert(record)` |
| Delete server | `removeServer` | `remove(id)` |
| Enable / Disable | `setServerEnabled` | `setEnabled(id, enabled)` |
| Connect / Disconnect | `connectServer`, `disconnectServer` | `connect(id)`, `disconnect(id)` |
| Tool toggle | `setToolEnabled` | `setToolEnabled(id, name, enabled)` |
| Save header or client secret | `setServerSecrets` | `setSecrets(id, record)` |
| Clear OAuth tokens | `clearOAuthTokens` | `clearOAuth(id)` |

`upsertServer` composes the full record. For a new server the bridge generates the id and the `createdAt`/`updatedAt` timestamps; for an edit it preserves `createdAt` from the stored record and sets `updatedAt`. The webview never supplies timestamps and never chooses an id. The bridge rejects an `upsertServer` whose `serverId` is unknown for an edit, and rejects a create whose generated id collides with an existing record.

`setToolEnabled` is rejected with `mcp-rejected` when the named tool is absent from `getTools(id)`, mirroring the plugin's HTTP guard: a name the server never listed would persist into `disabledTools` and outlive the mistake.

`setServerSecrets` accepts only names the record authorizes — the declared `headerNames` for `headers` auth, and `OAUTH_CLIENT_SECRET` for `oauth` auth. Any other name, including `OAUTH_ACCESS`, `OAUTH_REFRESH`, and `OAUTH_EXPIRES_AT`, is rejected with `mcp-rejected`, because those are exchange outputs the manager owns. Values must be non-empty; there is no unset, matching the runtime, and the UI says a key can be replaced but not removed here. When `setSecrets` fails, the bridge returns an extension-owned generic message naming only the server id and secret name; it never forwards plugin exception text, because a foreign implementation could echo the submitted literal.

Record validation stays with the plugin. `upsert` runs the plugin's `validateRecord` through its save path, so name pattern, duplicate enabled names, `stdio` requiring a flag-free `command`, `streamable-http` requiring `url`, OAuth requiring a `redirectPath` starting with `/`, and `disabledTools` content are all enforced by the owner. The bridge validates only wire form and bounds, and maps a rejection to `mcp-rejected` with the plugin's message truncated to 512 characters.

### Save ordering

The editor saves the record first and secrets second, matching the Models section's settings-then-credential order. A record failure aborts before any secret is written, so a failed save cannot leave an orphan secret. A record success followed by a secret failure keeps the editor open, reports the secret failure with the generic server/ref message, and offers Retry, which resubmits only `setServerSecrets`; the record mutation is not replayed. The staged secret value is retained for retry and clears only on success or disconnect; a committed record requires explicit key re-entry after success because the staged value is cleared and is never held elsewhere.

### Polling and invalidation

While the modal is open and MCP is the active section, the webview refreshes the list every 2,000 ms, and refreshes the selected server's detail and newer log entries on the same tick. That cadence mirrors DSH Web's MCP section, which is the observable behavior users compare against; it is a UI refresh interval in webview code, not a deployment-varying plugin tunable.

Polling is single-flight per key: list, detail, and logs each skip a tick while their previous request is unanswered. Polling stops when the modal closes, when another section becomes active, and on disconnect. A command in flight does not suspend polling — its own result and the next poll converge on the same runtime state.

When the runtime offers `onCatalogChanged`, the bridge subscribes and emits `settingsInvalidated { sections: ["mcp"], reason: "mcp" }` on each notification, so a catalog change made elsewhere in the process marks the section stale immediately. The coordinator's existing mutation-quiescence rule applies: an invalidation raised while an MCP operation is in flight is deferred until that operation settles, so a form never flashes an older view.

### State machine

Section data uses the existing `SettingsSectionState` machine — `idle`, `loading`, `ready`, `error`, with `stale` and `available`. The section adds its own controller state:

- selection: `undefined` or a server id, with detail and log cursor scoped to it;
- editor: `closed`, `{ mode: "create" }`, or `{ mode: "edit"; serverId }` with a non-secret draft plus component-local secret inputs;
- per-server pending operation: at most one; conflicting actions on that server are disabled while it runs, other servers stay operable;
- confirmation: `undefined`, `{ kind: "delete"; serverId }`, or `{ kind: "clear-oauth"; serverId }`;
- `secretEpoch`, incremented on disconnect and after a successful secret write, which clears every staged secret input.

A server that disappears from the list while selected clears the selection, closes its editor, and states that the server is gone. A pending operation whose server vanished settles as an explicit error rather than hanging.

### Dialogs

The server editor is an inline panel inside the section, like the Models provider editor, not a nested dialog. It exposes transport choice, name, `stdio` command, args, env pairs, cwd, `streamable-http` url, auth kind, header names with write-only value inputs, the OAuth configuration fields, `toolCallTimeoutMs`, and the four reconnect fields. Transport choice hides the fields the other transport does not use, and the bridge omits them from the record.

Delete and Clear OAuth tokens use the existing labelled confirmation dialog: focus starts on Cancel, Escape dismisses, focus returns to the invoking control. Delete states that the plugin also wipes that server's stored secrets. Clear OAuth tokens states that the server disconnects and stays down until it is authorized again from DSH Web.

### Secret staging

Header and client-secret inputs are `type="password"`, live only in component state, never enter the reducer, controller snapshots, retained webview state, or any outbound record, and are cleared when `secretEpoch` advances. A failed secret write retains the typed value for retry; it clears only on success or disconnect.

### OAuth in this phase

The `vscode` profile mounts no web server and configures no `publicOrigin`, so the plugin cannot name a redirect origin. `startOAuth` and `discoverOAuth` would throw when called, so the section never calls them and never renders an Authorize or Discover button.

OAuth is nevertheless a fully supported configuration type. The editor lets the user create and edit an `oauth` server with all five fields, and the section shows a persistent note on any OAuth server: authorization must be completed from DSH Web, after which the editor uses the tokens the manager stored. That is accurate — token refresh uses the refresh-token grant, which carries no redirect URI, so an already-authorized server keeps working in the editor indefinitely. `OAUTH_CLIENT_SECRET` remains settable here, and Clear OAuth tokens remains available. The UI never states that OAuth is unsupported.

## 6. Web Search section

### Data model

`getSettingsSection { section: "web-search" }` reads `getCatalog()`, `describeSecrets()`, and `available()`, and projects one `WebSearchSettingsView`. `engines` lists Tavily, Brave, and SearXNG in that fixed order with their configured override, their published default (`https://api.tavily.com`, `https://api.search.brave.com`, and none for SearXNG), whether a base URL is required once selected (SearXNG only), and the secret each needs (`TAVILY_API_KEY`, `BRAVE_API_KEY`, none).

`configured` comes from the runtime. `writable` is `true` for both refs, because `putSecrets` accepts a non-empty value for either one regardless of where the current value resolved from. `source` is omitted: the runtime resolves credentials, then the private file, then the environment, and reports only a configured flag, so the extension has no source to report and states nothing about it. Reporting a source is a plugin-side extension, listed as a deferral in section 14.

### Command and staged save ordering

The section is one staged form: engine selection, three base-URL fields, and two write-only key fields, with Save and Discard. Save sends one `setWebSearchConfig` carrying the full catalog and only the non-empty typed keys.

The bridge applies it in a fixed order: `putCatalog` first, then `putSecrets`, then a fresh `getCatalog`/`describeSecrets`/`available` read for the returned view. A catalog failure returns `{ ok: false, error }` with code `web-search-rejected`, carries the plugin's validation message truncated to 512 characters — that call receives no secret literal — and writes no secret. A catalog success proceeds to the keys, and reports per-key failures in `secretFailures` alongside `ok: true` and the refreshed view, so the user sees which key did not land while the catalog change is already live. Each `secretFailures` entry carries an extension-owned generic message naming only the ref; the bridge never forwards plugin exception text from `putSecrets`, because a foreign implementation could echo the submitted literal.

On `ok: true` with an empty `secretFailures`, the controller clears both key inputs and marks the form clean. On `ok: true` with failures, it keeps the failed keys' typed values for retry, keeps the form dirty, and rebases the non-secret draft on the refreshed view; those values clear only on success or disconnect. On `ok: false`, it keeps the whole draft including typed keys and shows the error.

Changes apply live within the editor's `dsh` child. The provider reads the catalog and resolves keys per call, so the next tool call in that process uses the new configuration with no restart. The `web.searchProvider` pin that would need a restart is already set by the plugin's own patch layer, so the section never asks for one.

When the runtime offers `onChanged`, the bridge subscribes and emits `settingsInvalidated { sections: ["web-search"], reason: "web-search" }` on each notification, so a catalog or secret change made elsewhere in the process marks the section stale immediately.

### Validation

The webview validates before enabling Save: a selected SearXNG requires a base URL, and any non-empty base URL must be an absolute HTTP or HTTPS URL. The bridge validates wire form and bounds. The plugin owns authoritative catalog validation through `putCatalog`, including the same SearXNG requirement, so a bypassed client check still fails loud.

A base URL equal to the engine's published default is sent as an absent override, matching the plugin's own persistence rule, so the catalog does not pin a default that later changes upstream.

### Core card suppression

While the external service is mounted, `buildPluginsView` omits the core `web-search-deepseek` configurable card and its namespace projection, because the top-level section is the authority for web search in that deployment and two differently-scoped Web Search cards would be ambiguous. When the service is absent, the Plugins card and its namespace are projected exactly as they are today. Suppression is derived from the probe, not from a setting, so it cannot drift from the nav row it complements.

## 7. UI, navigation, localization, accessibility, responsiveness

### Navigation

`SettingsNav` renders General, Models, Plugins, MCP, Web Search, Agent Presets, Extension, filtering the two optional rows by the capability set. MCP and Web Search sit after Plugins because they are plugin capabilities, and before Agent Presets and Extension, which remain the last two rows. Before the first capability reply, neither optional row renders; nothing flickers into place and no row leads to an empty pane.

If the active section becomes unavailable — its plugin unloaded — the reducer moves activation to General, drops that section's cached view, and closes any editor and confirmation it owned.

### MCP layout

The section shows a server list with, per row, the name, transport, enabled state, a status pill, tool counts, and row actions for connect/disconnect, enable/disable, edit, and delete. Selecting a row opens the detail pane below the list with tools, secret state, and the log view; the editor replaces the detail pane while open. An empty catalog shows an explanatory empty state with the Add server action, never a bare table.

Status pills map one-to-one to `McpStatusWire`: disconnected, connecting with attempt, connected with tool count and time, reconnecting with attempt and next delay, failed with the error text. The failed message is the plugin's, rendered as text.

### Web Search layout

The section shows the engine choice as a radio group, then the selected engine's base URL and key rows, then the other engines' base URL rows in a collapsed group, then an availability line stating whether search is usable now and, when it is not, which piece is missing. Save and Discard sit in the section action area with the standard dirty and busy states.

### Localization

Both sections add English and Chinese entries with identical keys to the existing dictionary: nav labels, transport and auth names, every field label and hint, status and log level names, empty states, confirmations, the OAuth authorization note, the unknown-secret-state note, validation messages, and error text. Language follows the resolved DSH locale and switches immediately, as elsewhere in the modal. Server names, tool names, tool descriptions, log text, and plugin error messages stay verbatim and are never machine translated.

### Accessibility

- The server list is a list of rows with accessible names; row actions are buttons with explicit labels, not icon-only controls without names.
- The selected row carries `aria-current`, and the detail pane is associated with it by `aria-labelledby`.
- The log view is a scrollable region with `role="log"` and `aria-live="polite"`, so appended lines are announced without stealing focus.
- Status changes announce through a polite live region; a poll that returns identical data announces nothing.
- Tool toggles are checkboxes with the tool name as their accessible name and a busy state while their write is in flight.
- Secret inputs use password semantics, never repopulate after save, and carry a hint stating that the current value cannot be read back.
- Confirmations trap focus and return it to the invoking control; errors use `role="alert"` without moving focus.
- Every control stays operable at 200% zoom and at narrow sidebar widths.

### Responsiveness

Below 560px the nav becomes the existing horizontally scrollable tab strip and both sections stack: list above detail, labels above controls, row actions wrapping without horizontal page overflow. The log view keeps a bounded height and its own scroll at every width. No virtualization: 64 servers, 256 tools, and 512 log lines render directly, and section 14 records the condition under which that decision is revisited.

## 8. Lifecycle, concurrency, disconnect, reconnect, disposal

The settings coordinator keeps its single generation counter and its latest-request map, and the new families join both. Request keys are `section:mcp`, `section:web-search`, `mcp-detail:<serverId>`, `mcp-logs:<serverId>`, `mcp-op:<serverId>`, and `web-search-save`, so a later request for the same key suppresses an earlier reply while independent servers proceed in parallel.

The coordinator disposes with the bridge: it advances its generation, clears pending state, and removes the MCP catalog listener and the Web Search change listener. Every in-flight adapter reply is suppressed after disposal, so a slow `getTools` or a slow `putCatalog` cannot post into a disposed relay.

Optional services are probed at runner creation and re-probed on Cordis global `internal/service` events for `mcp` and `webSearchManager`. A service that disappears makes its section unavailable, drops the capability, pushes a capability update, and removes any listener the bridge held on it. A service that appears does the reverse. Per-request adapters re-read `ctx` on every call and hold no probed reference across requests, so an unloaded plugin cannot be called through a stale reference.

On disconnect the webview marks both sections unavailable, stops polling, settles pending operations as errors, advances `secretEpoch` to clear staged secrets, and preserves non-secret drafts and the current selection. On reconnect it requests capabilities and General, then refreshes the active section; a preserved draft survives, and a draft whose server no longer exists reports that explicitly instead of silently resurrecting a deleted record.

Section state and drafts survive session changes, new chats, and modal close/open. Closing the modal with a dirty MCP editor or a dirty Web Search form uses the existing dirty-close confirmation.

## 9. Security and secret handling

- No stored secret value reaches the extension host, the webview, the reducer, a controller snapshot, retained webview state, a log, or a snapshot. The two runtimes expose only configured flags, and the bridge projects only those flags.
- Secret values travel one way, inbound, inside `setServerSecrets` and `setWebSearchConfig`, and are never echoed. Both adapters return value-free state.
- `setSecrets` and `putSecrets` failures return extension-owned generic messages naming only the server id or secret ref. The bridge never forwards plugin exception text from those calls, because a foreign implementation could include the submitted literal in its error. Catalog and record validation errors may carry bounded plugin text, because `putCatalog`, `upsert`, and related calls receive no secret literal.
- Failed secret input stays component-local for retry and clears only on success or disconnect.
- The contract's outbound scan for credential-value field names, `{ ref, value }` pairs, prototype-pollution keys, and cycles covers every new outbound family, and the new records use `name`/`value` and `ref`/`configured` pairings that the scan can reason about.
- `env` pairs are user-authored durable record content, not managed secrets. They are stored in the plugin's non-secret catalog by the plugin's own design and are projected as such; the UI states that env values are stored in plain text in the MCP catalog and that credentials belong in header secrets.
- Secret writes are restricted to names the target record authorizes; the manager's own exchange outputs are not writable from the editor.
- Every action is trusted: it originates in the extension's own webview over the existing relay, and the bridge validates wire form, bounds, identifiers, and authorization before any runtime call.
- The webview supplies no filesystem path, no URL to fetch on the host, and no plugin module name. It cannot cause the bridge to load code.
- The webview CSP is unchanged and no remote asset is added.
- Server names, tool descriptions, log lines, and plugin error text render as text, never as trusted HTML.
- Destructive actions — delete server, clear OAuth tokens — require confirmation.
- Message truncation is applied to plugin validation error text before it leaves the bridge, so an unexpectedly large error cannot be used to push a message past the wire scan. Secret-operation failures do not use plugin error text.

## 10. Error handling and partial failures

| Failure | Behavior |
|---|---|
| Plugin absent | No nav row, no request, no error |
| Service mounted but structurally incomplete | No nav row, one bridge warning per registration generation; no request, no error banner |
| Section read failure | Last good data remains with Retry; polling continues |
| `describeSecrets` absent or failing | Secret state renders as unknown with a stated reason; every other control stays usable |
| Log request failure | Already-loaded controls and prior entries remain; the next tick retries |
| Record rejected by the plugin | Inline editor error with the plugin's validation message; draft preserved |
| Record saved, secret failed | Editor stays open, generic message naming server and secret ref, secret-only Retry; staged value retained until success or disconnect |
| Catalog saved, key failed | `ok: true` with `secretFailures` carrying generic ref-only messages; catalog change is live, failed key retained until success or disconnect and form stays dirty |
| Catalog rejected | `ok: false` with bounded plugin validation message; nothing written, whole draft preserved |
| Tool toggle failure | Toggle returns to its server-reported state with an inline error |
| Selected server removed elsewhere | Selection cleared with an explicit message; list refreshes |
| Bounds exceeded | Request fails closed with an explicit bound error; nothing is truncated silently |
| Disconnect | Both sections unavailable, polling stopped, pending operations settled as errors, drafts preserved |

Errors name the server, engine, or key they concern and the corrective action when one exists. Internal stack traces never reach the webview. A poll failure never replaces a healthy view with an error pane; it marks the view stale.

## 11. Testing matrix

### Contract, negative cases

Accept each new inbound command and outbound message at its exact form, and reject: unknown message kinds; missing, empty, or non-string `requestId`; unknown section ids; a capability list with duplicates or an unknown id; undeclared fields on every new record; prototype-pollution keys anywhere in a payload; a cycle; an `McpAuthWire` whose fields belong to another `kind`; a `stdio` record carrying `url` and a `streamable-http` record carrying `command`; a `McpStatusWire` variant with the wrong fields; each numeric field out of range or non-integer; each collection over its cap; each string over its length cap; a `{ ref, value }` pair or a credential-value field name in any outbound message; an `mcpOperation` result that is neither the success nor the error variant.

### Web Search plugin, `dsh-web-search`

Service publication on `ctx.webSearchManager` through the real loader entry; every method delegating to the runtime; `available()` agreeing with the registered provider for each engine and for a missing SearXNG URL; `onChanged` firing only after a successful `putCatalog` or `putSecrets` and not before persistence completes, with disposal removing the listener at fiber unload; the provider still registered on `ctx.web` with the same instance; `putSecrets` ignoring empty values; `describeSecrets` reporting both refs; `putCatalog` rejecting an invalid catalog and leaving the previous one live; the seam package exporting the interface and types with no Node import; the HTTP API behaving exactly as before.

### Bridge

Adapters against fake services covering: full projection of every record, status, tool, secret, and log variant; an MCP runtime without `describeSecrets` and without `onCatalogChanged`; a Web Search runtime without `onChanged`; each bound at its cap accepted and one over its cap rejected; every operation mapped to the right runtime call; unauthorized secret names rejected; unknown tool names rejected; unknown server ids rejected; create id generation and edit timestamp preservation; record-then-secret ordering including the abort-on-record-failure and secret-only-retry paths; catalog-then-secret ordering including per-key failures; generic secret-operation error messages and bounded plugin validation messages for catalog/record rejections; Plugins-view suppression of `web-search-deepseek` with the service present and its unchanged projection with the service absent.

Coordinator tests covering: capability probe results and unsolicited capability pushes driven by `internal/service` events on mount and unload; latest-request-wins per request key; suppression after disposal; MCP invalidation deferred while an operation is in flight and delivered afterward; Web Search invalidation via `onChanged`; disconnect and reconnect; listener removal on disposal.

Boot tests extending the existing probe fixture with a mounted fake MCP service and a mounted fake web-search service, asserting the capability list, simulating mount and unload through `internal/service` events, asserting that a structurally incomplete mounted service is withheld from the capability list with one bridge warning per registration generation, and with neither mounted, asserting an empty capability list and unchanged behavior of the other four sections.

### Webview

Reducer: new section states; capability application, including an active section becoming unavailable; request/epoch suppression; invalidation marking stale; disconnect and reconnect transitions.

Controllers: MCP selection, detail, incremental log cursor, per-server single-flight, editor drafts, secret staging and `secretEpoch` clearing, save ordering and secret-only retry, confirmations, and vanished-server handling; Web Search drafts, validation gating, save ordering, partial secret failure, discard, and rebasing on a refreshed view. Assert that no snapshot from either controller contains a secret value.

Components: MCP list, detail, editor, log view, and Web Search form, in English and Chinese, covering empty states, every status variant, unknown secret state, the OAuth note, disabled states while busy, and narrow layout.

Integrated App: open the modal with both plugins mounted and see both rows; with neither mounted and see neither; mount one mid-session and see the row appear; add, edit, enable, connect, toggle a tool, read logs, and delete a server; save web-search config with and without keys; hit a partial secret failure; disconnect with a dirty editor and reconnect; close with dirty forms.

### Cross-capability bounds

Extend `packages/bridge/test/settings-wire-bounds.test.ts` with a maximal MCP list view, a maximal MCP detail, a maximal logs message, and a maximal Web Search view, asserting the contract validator accepts each, plus the cap-consistency assertions that `SETTINGS_WIRE_SCAN_NODE_LIMIT` exceeds every new ceiling plus the message envelope.

### Gates and manual smoke

Run the full package gates in both repos: recursive typecheck, unit tests, build, e2e typecheck, and the extension's deterministic host tests; in `dsh-web-search`, its package verification alongside tests and build. Inspect the produced VSIX for content and scan it for any secret-shaped string. Then smoke-test manually in VS Code and in Cursor: both sections at narrow and wide sidebar widths, English and Chinese, light and dark themes, with a real stdio MCP server, a real `streamable-http` MCP server, and a real Tavily or SearXNG configuration; confirm a live search after saving a key, and confirm that the Extension Host log and retained webview state hold no secret value.

## 12. File boundaries

### `/Users/anhtra/workspace/dsh-web-search`

New:

- `packages/service/{package.json,tsconfig.json,README.md}` and `packages/service/src/{index.ts,types.ts}` — the `@anht3889/dsh-web-search-service` seam with the `WebSearchManagement` interface, its declaration merging, `webSearchManagerOf`, and the catalog/secret types. The existing `packages/*` workspace glob and the root vitest `packages/*/tests/**/*.spec.ts` include already cover it.
- `packages/service/tests/service.spec.ts`.

Changed:

- `packages/bundle/src/manager/runtime.ts` — `available()`, `onChanged`, change notification after successful `putCatalog` or `putSecrets`, listener disposal.
- `packages/bundle/src/manager/index.ts` — `ctx.provide('webSearchManager', runtime)` and the listener-clearing effect.
- `packages/bundle/src/manager/types.ts`, `catalog.ts`, `secrets.ts` — re-export from the seam package instead of declaring the shared types locally.
- `packages/bundle/package.json` — dependency on the seam package, version bump.
- root `package.json` — the seam package's tsconfig added to the enumerated `typecheck` script; `clean` and `build` already run recursively.
- `packages/bundle/tests/manager/runtime.spec.ts`, `tests/manager/loader.spec.ts`, `tests/manager/provider.spec.ts`.
- `README.md`, `docs/design.md`.

### `/Users/anhtra/workspace/dsh-vscode-extension`

New:

- `packages/bridge/src/settings/optional-services.ts` — local structural services and the bounded probes.
- `packages/bridge/src/settings/capabilities.ts` — capability computation, `internal/service` subscription, and change notification.
- `packages/bridge/src/settings/mcp.ts`, `packages/bridge/src/settings/web-search.ts` — adapters, with `.test.ts` beside each.
- `packages/extension/src/webview/media/settings/sections/mcp/{McpController.ts,McpSection.tsx,McpServerList.tsx,McpServerDetail.tsx,McpServerEditor.tsx,McpLogView.tsx}` with tests.
- `packages/extension/src/webview/media/settings/sections/web-search/{WebSearchController.ts,WebSearchSection.tsx}` with tests.

Changed:

- `packages/contract/src/settings.ts` and `settings.test.ts` — section ids, error codes, invalidation reasons, new records, new families, validators, bounds.
- `packages/contract/src/protocol.ts` and `protocol.test.ts` — version 6 and the message unions.
- `packages/bridge/src/settings/coordinator.ts` and `types.ts` — new request keys and entry points.
- `packages/bridge/src/settings/plugins.ts` and `plugins.test.ts` — core card suppression.
- `packages/bridge/src/commands.ts` — dispatch for the five new inbound kinds.
- `packages/bridge/src/runner.ts` — capability announcement at ready and on `internal/service` events.
- `packages/bridge/test/{boot.ts,boot-probe.test.ts,settings-wire-bounds.test.ts}`.
- `packages/extension/src/webview/media/settings/{types.ts,reducer.ts,SettingsNav.tsx,SettingsModal.tsx}` and `localization/{en.ts,zh.ts}`.
- `packages/extension/src/webview/media/App.tsx` — capability request, controller wiring, poll scheduling.
- `packages/extension/src/webview/media/style.css`.
- `packages/extension/README.md`.

The extension host is unchanged: `panel.ts` already forwards outbound messages it does not interpret, and the new families need no host action, no host command, and no path resolution.

## 13. Migration and deployment

Web Search requires a plugin release. Build and publish `@anht3889/dsh-web-search-bundle` with its new `@anht3889/dsh-web-search-service` dependency, then install the updated bundle into the profile the editor launches. Until that build is installed, `ctx.webSearchManager` is absent, the Web Search row does not appear, and the core `web-search-deepseek` card remains in the Plugins section unchanged. There is no fallback path through the plugin's HTTP API, because the `vscode` profile runs no web server.

MCP requires no plugin release. The installed `@anht3889/dsh-mcp-mgmt-bundle` 0.0.5 publishes `ctx.mcp` as a concrete `McpManagerRuntime` that satisfies every required member and both optional ones, so the section is complete against it. An older or reduced build that lacks `describeSecrets` or `onCatalogChanged` yields the documented degraded behavior; a build that lacks a required member yields no section. When the recommended `McpRuntime` change lands, no extension change is needed.

Extension and bridge ship as one VSIX at protocol version 6. A version-5 `dsh` child and a version-6 extension fail the handshake with the existing mismatch status; there is no negotiated subset and no shim.

Both catalogs and both secret stores live under the same `$DSH_HOME` paths for the `vscode` and `web` profiles, but each profile's plugin runtime caches its catalog in memory and does not watch those files. A change written in one already-running profile becomes visible to another only after that profile restarts; simultaneous mutations can overwrite stale snapshots, and this phase does not promise live cross-profile sync. Connection state remains process-local: enabling a server in the editor connects it in the editor's `dsh` child, not in a separately running DSH Web process.

## 14. Rulings and known deferrals

1. OAuth authorization launch and callback handling are deferred. The `vscode` profile has no web server and no `publicOrigin`, so no redirect can be received. OAuth remains a first-class configuration type, existing tokens keep working through refresh, and the UI directs authorization to DSH Web. Superseded by `2026-08-24-dsh-vscode-mcp-oauth-onboarding-design.md`.
2. OAuth endpoint discovery is deferred with authorization, for the same reason: the plugin's discovery path composes a redirect URI and would throw without an origin. Superseded by `2026-08-24-dsh-vscode-mcp-oauth-onboarding-design.md`.
3. No dynamic plugin-UI framework. The extension ships UI for these two known capabilities only. A third-party plugin gains no editor settings surface; adding one is a separate design with its own security review.
4. Web Search keys cannot be unset from the editor, because the runtime offers no unset and writes non-empty values only. The UI says a key can be replaced but not removed. Unset arrives when the plugin supports it.
5. Web Search secret `source` is not reported, because the runtime reports only a configured flag. Adding source reporting is a plugin-side change.
6. MCP server secrets cannot be unset either; the runtime's `setSecrets` has no removal path, and removal happens only when a server is deleted.
7. No virtualization for the server list, tool list, or log view. Revisit when a real install exceeds roughly 40 servers or 150 tools on one server, or when profiling shows a poll tick exceeding one frame.
8. `env` values stay in the plugin's non-secret catalog, as the plugin defines. The editor states this rather than inventing a second storage location.
9. Neither section introduces a settings namespace or a revision. Optimistic concurrency for these catalogs stays with the owning plugins.
10. The 2,000 ms poll cadence matches DSH Web. Replacing polling with runtime push is a plugin-side capability the current MCP surface does not offer beyond catalog membership changes.

## Acceptance criteria

1. With both plugins mounted and passing the bounded probe, the settings modal shows MCP and Web Search rows after Plugins; with neither mounted, neither row exists, no request is issued, and no error is shown; a structurally incomplete mounted service yields no nav row and one bridge warning per registration generation; mount and unload mid-session update the nav through Cordis global `internal/service` events without a reload.
2. `@anht3889/dsh-web-search-service` exists, the manager plugin publishes `ctx.webSearchManager`, the same provider instance stays registered on `ctx.web`, and the service exposes exactly `getCatalog`, `putCatalog`, `describeSecrets`, `putSecrets`, `available`, and `onChanged`.
3. The bridge imports nothing from `@anht3889/*`, reads both services through local structural interfaces and a bounded member probe, and typechecks and builds in a workspace where neither plugin is installed.
4. `dsh-mcp-management` needs no change for this phase, and the spec records the recommendation to declare `describeSecrets` and `onCatalogChanged` on `McpRuntime` in a later release.
5. Protocol version is 6; the contract validates the five new inbound kinds and five new outbound kinds as closed discriminated families, with no `@deepseek-ai/*` or `@anht3889/*` type on the wire.
6. The MCP section lists servers with live status, opens a detail pane with tools and secret state, adds, edits, deletes, enables, disables, connects, disconnects, toggles tools, stores write-only header and client secrets with generic server/ref errors on failure, reads incremental logs, and configures OAuth servers without offering an authorization launch.
7. The MCP section states that OAuth authorization must be completed from DSH Web, never states that OAuth is unsupported, and keeps Clear OAuth tokens available.
8. The Web Search section selects Tavily, Brave, or SearXNG, edits per-engine base URLs, stores write-only Tavily and Brave keys, reports availability, applies changes live within the editor process, and reports a partial key failure with a generic ref-only message alongside a committed catalog.
9. While the external web-search service is mounted, the Plugins section omits the core `web-search-deepseek` card and its namespace; while it is absent, that card is projected unchanged.
10. No outbound message, reducer state, controller snapshot, retained webview state, log, or snapshot contains a secret value; secret-operation failures use extension-owned generic messages naming only the server id or secret ref; and the contract's outbound scan covers every new family.
11. Every new collection and string is bounded, an over-cap payload fails closed with an explicit error, and the wire-bounds test proves `SETTINGS_WIRE_SCAN_NODE_LIMIT` exceeds every new ceiling plus the message envelope.
12. Latest-request-wins holds per request key, disposed-generation replies are suppressed, reconnect refreshes both sections while preserving non-secret drafts, and disconnect clears staged secrets.
13. Both sections are fully bilingual with identical dictionary keys, switch language immediately, meet the accessibility rules in section 7, and remain operable at 200% zoom and narrow sidebar widths.
14. The testing matrix in section 11 passes in both repositories, the VSIX contains no secret-shaped string, and the manual smoke covers VS Code and Cursor with a real MCP server and a real search engine. Cross-profile catalog edits under `$DSH_HOME` do not live-sync between an already-running DSH Web process and the editor's `dsh` child; each side sees the other's on-disk changes only after restart.

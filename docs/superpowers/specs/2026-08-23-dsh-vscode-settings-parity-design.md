# DSH VS Code Settings Parity Design

## Status

Approved in chat on 2026-08-23. This document defines the settings modal opened by the DSH header gear in VS Code and Cursor.

## Goal

Provide the settings functionality of DSH Web inside the extension while preserving the same DSH settings document, credentials store, validation, revision conflicts, and agent-preset operations. Add one extension-owned section for process launch settings and native editor actions.

## Non-goals

- Do not embed or launch DSH Web.
- Do not write `$DSH_HOME/settings.yaml` directly from the extension or webview.
- Do not place settings in the composer picker state.
- Do not expose credential values after submission.
- Do not make current-session model and permission selectors global; they remain in the composer.
- Do not add a compatibility path for older bridge protocols.
- Do not reproduce DSH Web onboarding flows tied to its blank-session hero.

## Locked decisions

1. The extension renders a native React settings modal backed by the existing DSH services.
2. The first release includes General, Models, Plugins, Agent Presets, and Extension sections.
3. Settings copy is bilingual. Changing the DSH language preference switches the modal between English and Chinese immediately.
4. DSH appearance preference is editable, but the extension continues to follow the VS Code or Cursor theme.
5. DSH data stays under the active DSH home and profile. The extension does not create a second settings store.
6. DSH settings use revision-checked operations. A conflict preserves the local draft and reloads the current remote value.
7. Credentials are write-only. The webview receives only whether a credential is configured.
8. Restart-required writes do not restart the child automatically. The user explicitly chooses Restart DSH.
9. Current agent work may continue while the modal is open. Restart and destructive actions are disabled while a turn or approval is active.
10. Protocol version 5 is shipped by the extension and bridge together without a version 4 shim.

## Source behavior

The design follows these DSH Web owners:

- `packages/client/ui-settings` for settings mirror and namespace scope behavior.
- `packages/client/ui-settings-general` for dialog chrome and General section.
- `packages/client/ui-settings-models` for provider and credential editing.
- `packages/client/ui-settings-plugins` and `ui-settings-plugin-inventory` for plugin cards and inventory.
- `packages/client/ui-agent-preset` for preset operations.
- `packages/host/apiproxy/src/api/settings.ts` for revisioned settings operations.
- `packages/settings/settings-file` for durable persistence.

The extension contract uses dependency-free projections of these APIs. DSH package types do not cross into `@dsh-vscode/contract`.

## Architecture

### Ownership

| Layer | Responsibilities |
|---|---|
| Webview | Modal navigation, form drafts, bilingual copy, client validation hints, dirty state, conflict presentation, accessibility |
| Extension host | VS Code configuration, native file/folder/settings actions, child restart confirmation and execution |
| Bridge | DSH settings, credentials, model-provider projection, plugin inventory, agent-preset operations, revision checks, invalidation |
| DSH services | Validation, persistence, credential storage, catalog rebuilds, plugin and preset authority |

The extension host forwards protocol messages without interpreting DSH settings. Host-only commands remain outside the NDJSON contract.

### Modal placement

The gear button becomes enabled and exposes `aria-haspopup="dialog"` and `aria-expanded`. The modal is rendered at the App level, not inside `PickerState`.

Desktop layout:

- fixed overlay under the webview root;
- maximum width 800px;
- height `min(800px, calc(100vh - 48px))`;
- 188px left navigation rail;
- independently scrolling content pane;
- fixed header and action area where a section needs one.

Narrow layout:

- at widths below 560px, navigation becomes a horizontally scrollable tab strip;
- content fills the remaining width;
- field labels stack above controls;
- provider and plugin card actions wrap without horizontal page overflow.

Opening settings closes Recent and any composer picker, but preserves the draft, chips, command claim, and transcript. Closing settings restores focus to the gear. Escape and pointer-down on the mask close the modal unless a destructive confirmation or dirty-form confirmation is active.

### Section loading

Every bridge ready or reconnect loads General in the background when its cache is idle, stale, or unavailable, so persisted locale and Busy Enter behavior apply before the modal opens. Opening the modal reuses a clean cache, joins an in-flight General request, or refreshes stale/error state without duplicating requests. A General invalidation while the modal is closed marks the cache stale and waits for the next ready or open. Models, Plugins, and Agent Presets load lazily on first activation and keep their last good data until invalidated. Extension settings are read from the host without starting a bridge request.

Each bridge-backed section records its request id. Responses with a stale request id or bridge generation are ignored. A reconnect invalidates all bridge-backed section data, refreshes General, and also refreshes a different active bridge section when the modal is open.

## Protocol version 5

### Busy-submission transport addendum

Task 7 includes the submission transport required for the General Busy Enter row. `SubmitCommand` carries a required non-empty `requestId` and required `mode: "queue" | "steer"`. The bridge answers admission, not turn completion, with the closed correlated result `{ kind: "submitResult", requestId, result: { ok: true } | { ok: false, detail } }`; protocol v4 submit records are rejected without a compatibility path.

Idle submission always uses queue. While the active agent is busy, plain Enter uses resolved `ui-conversation.busyEnter`, Cmd/Ctrl+Enter uses the opposite mode, and Shift+Enter remains a newline. Queue maps to `agent.followup`; steer maps to `agent.steer`. Admission releases bridge serialization immediately after image admission and inbox insertion, while live-agent/generation-correlated observation handles later flush, context, and idle publication. Cancellation, session replacement, resume, disconnect, and a newer admission invalidate stale observers.

The webview tracks a pending prompt by request id, mode, and the submitted draft/chip snapshot. Only a matching successful `submitResult` clears an unchanged snapshot; matching failure retains it, later edits survive success, and session replacement or disconnect clears pending state. `turn/start` is not an admission acknowledgement. Queue/steer intent is durably represented by existing `agent/inbox/spliced` target and eventual `user/message` events; the preference is not model-visible.

### Common wire types

```ts
interface SettingsErrorWire {
  code:
    | "settings-unavailable"
    | "settings-rejected"
    | "settings-conflict"
    | "credentials-rejected"
    | "preset-rejected"
    | "cancelled"
    | "internal";
  message: string;
  namespace?: string;
  currentRevision?: number;
}

interface SettingsNamespaceWire {
  namespace: string;
  revision: number;
  applies: "live" | "restart";
  writable: boolean;
  base: Record<string, unknown>;
  user: Record<string, unknown>;
  value: Record<string, unknown>;
  secrets: { path: string[]; set: boolean }[];
}

type SettingsPathOpWire =
  | { op: "set"; path: string[]; value: unknown }
  | { op: "unset"; path: string[] };

interface CredentialStateWire {
  ref: string;
  set: boolean;
  source?: string;
  writable: boolean;
}
```

The bridge validates all namespace names, paths, operation tags, primitive values, identifiers, and request ids at the wire boundary. DSH services perform schema validation for namespace content.

### Inbound messages

```ts
interface GetSettingsSectionCommand {
  kind: "getSettingsSection";
  requestId: string;
  section: "general" | "models" | "plugins" | "agent-presets";
}

interface MutateSettingsCommand {
  kind: "mutateSettings";
  requestId: string;
  namespace: string;
  expectedRevision: number;
  ops: SettingsPathOpWire[];
}

interface SetCredentialCommand {
  kind: "setCredential";
  requestId: string;
  ref: string;
  value: string;
}

interface UnsetCredentialCommand {
  kind: "unsetCredential";
  requestId: string;
  ref: string;
}

interface CopyAgentPresetCommand {
  kind: "copyAgentPreset";
  requestId: string;
  fromPresetId: string;
  presetId: string;
  name: string;
}

interface DeleteAgentPresetCommand {
  kind: "deleteAgentPreset";
  requestId: string;
  presetId: string;
}

interface ReadAgentPresetCommand {
  kind: "readAgentPreset";
  requestId: string;
  presetId: string;
}

interface ResolveSettingsPathCommand {
  kind: "resolveSettingsPath";
  requestId: string;
  target:
    | { kind: "dsh-home" }
    | { kind: "settings-document"; prepare: boolean }
    | { kind: "agent-preset"; presetId: string };
}
```

Native operations are host-only webview commands:

```ts
type SettingsHostCommand =
  | { kind: "getExtensionSettings"; requestId: string }
  | {
      kind: "updateExtensionSettings";
      requestId: string;
      binaryPath: string;
      handshakeTimeoutMs: number;
    }
  | { kind: "openExtensionSettings" }
  | { kind: "openSettingsDocument" }
  | { kind: "revealDshHome" }
  | { kind: "openAgentPreset"; presetId: string }
  | { kind: "restartDsh" };
```

For `openSettingsDocument`, `revealDshHome`, and `openAgentPreset`, the host sends an internal `resolveSettingsPath` request, intercepts the matching `settingsPath` response, and performs the final filesystem action. The webview never supplies an arbitrary path.

### Outbound messages

```ts
interface GeneralSettingsView {
  section: "general";
  namespaces: SettingsNamespaceWire[];
  agentPresets: { id: string; label: string }[];
  permissionPresets: { id: string; label: string; dangerous: boolean }[];
}

type ModelCatalogStatusWire =
  | { kind: "dormant" }
  | { kind: "ready" }
  | { kind: "failed"; message: string };

type CredentialMetadataStatusWire =
  | { kind: "none" }
  | { kind: "ready" }
  | { kind: "failed"; message: string };

interface ModelProviderSettingsWire {
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

interface ModelsSettingsView {
  section: "models";
  namespaces: SettingsNamespaceWire[];
  providers: ModelProviderSettingsWire[];
  credentials: CredentialStateWire[];
}

interface PluginsSettingsView {
  section: "plugins";
  namespaces: SettingsNamespaceWire[];
  configurable: ConfigurablePluginWire[];
  inventory: PluginInventoryItemWire[];
}

interface AgentPresetsSettingsView {
  section: "agent-presets";
  namespace?: SettingsNamespaceWire;
  presets: AgentPresetSettingsItemWire[];
}

type SettingsSectionMessage = {
  kind: "settingsSection";
  requestId: string;
  view:
    | GeneralSettingsView
    | ModelsSettingsView
    | PluginsSettingsView
    | AgentPresetsSettingsView;
} | {
  kind: "settingsSection";
  requestId: string;
  error: SettingsErrorWire;
};

interface SettingsMutationMessage {
  kind: "settingsMutation";
  requestId: string;
  result:
    | { ok: true; namespace?: SettingsNamespaceWire; restartRequired?: boolean }
    | { ok: false; error: SettingsErrorWire };
}

interface SettingsInvalidatedMessage {
  kind: "settingsInvalidated";
  sections: ("general" | "models" | "plugins" | "agent-presets")[];
  reason: "document" | "credentials" | "models" | "plugins" | "presets";
}

interface AgentPresetContentMessage {
  kind: "agentPresetContent";
  requestId: string;
  result:
    | { ok: true; presetId: string; trust: "system" | "user"; content: string }
    | { ok: false; error: SettingsErrorWire };
}

interface SettingsPathMessage {
  kind: "settingsPath";
  requestId: string;
  result:
    | { ok: true; path: string; target: ResolveSettingsPathCommand["target"]["kind"] }
    | { ok: false; error: SettingsErrorWire };
}
```

Provider, plugin, inventory, and preset wire records expose only fields required by the settings UI. Opaque ids use named aliases in the dependency-free contract and are converted to DSH branded ids in the bridge.

### Mutation and conflict flow

1. The webview reads the namespace revision from the latest section view.
2. A write carries `expectedRevision` and path operations.
3. The bridge delegates to the DSH settings service.
4. Success returns the updated redacted namespace view and whether restart is required.
5. A revision conflict returns `settings-conflict` plus the current revision and invalidates the section.
6. The webview refreshes remote data but preserves its draft.
7. The user chooses Retry, which reapplies the draft against the new revision, or Discard.

Only one mutation per form is active. General rows serialize writes per namespace. Staged cards reject a second Save while one is pending.

### Invalidation

The bridge forwards invalidation after:

- `settings/document-updated`;
- credential set or unset;
- model adapter/catalog changes;
- plugin inventory changes;
- agent-preset list changes;
- bridge reconnect.

An invalidation marks cached data stale. The active section refreshes immediately; inactive sections refresh when opened. A local mutation response is accepted before its corresponding invalidation to prevent the form from flashing an older view.

## State model

Settings presentation state is separate from conversation state:

```ts
interface SettingsState {
  open: boolean;
  activeSection: SettingsSectionId;
  locale: "en" | "zh";
  sections: Record<SettingsSectionId, SettingsSectionState>;
  restartRequired: boolean;
  confirmation?: SettingsConfirmation;
}

type SettingsSectionState =
  | { status: "idle" }
  | { status: "loading"; requestId: string; previous?: SettingsSectionView }
  | { status: "ready"; view: SettingsSectionView; stale: boolean }
  | { status: "error"; detail: string; previous?: SettingsSectionView };
```

Staged forms own typed drafts and dirty state inside their section controller. Secrets are never stored in `SettingsState`; credential inputs remain component-local, are cleared after submission, and are not passed to VS Code webview persistence.

Session changes do not close settings or discard settings drafts. A bridge disconnect marks bridge-backed sections unavailable while preserving drafts. Extension settings remain available.

## General section

General rows are ordered:

1. Agent preset default.
2. Permission default.
3. Language.
4. Appearance.
5. Busy Enter.

Writes save immediately.

- Agent preset default writes `agent-presets.default`.
- Permission writes `permission.defaultPreset`. Danger Full Access requires the existing host confirmation.
- Language writes `locale.preference` and changes modal copy immediately after success. Clearing delegates to DSH/browser detection where supported.
- Appearance writes `ui-theme.preference`. A note states that the editor extension follows the host theme.
- Busy Enter writes `ui-conversation.busyEnter`; the composer submission policy reads the same resolved value.

Unavailable namespaces hide their row, matching DSH Web. Read-only namespaces show their resolved value with disabled controls.

## Models section

The provider list and editor follow DSH Web model settings:

- list configured and available providers;
- add a provider profile;
- edit display name, protocol/provider type, base URL, and model configuration exposed by the provider schema;
- set, replace, or unset the provider credential;
- delete a provider after confirmation;
- show validation and connection/catalog availability separately;
- refresh the bridge model catalog after a successful live-applying write.

`active` reports whether the provider route is registered. `catalog.kind` is `dormant` when the route is inactive, `ready` after the provider model list succeeds including an empty result, and `failed` when that list fails. Within a ready catalog, a listed model whose metadata cannot resolve is omitted without discarding resolved siblings; its label is the listed name or the model id, and context is present only when resolution supplies it. `models` remains present in every state and is empty for `dormant` and `failed`. Failure messages are fixed bridge text and never include provider errors, stacks, or credential data.

`declared` preserves provider-directory route metadata when available. `credentialStatus` is `none` when the profile has no credential reference, `ready` only when `credential` contains successfully described metadata, and `failed` when metadata cannot be read. Credential records are closed `{ ref, set, source?, writable }` metadata and never carry a value.

Models invalidation waits for section mutation quiescence before requesting a composer catalog refresh. The settings coordinator owns an abort signal for those refreshes, so disconnect or coordinator disposal prevents an in-flight settings-originated catalog read from publishing.

Only one provider editor is active. Edits are staged until Apply. Reset unsets the user override and restores the composition value. Delete removes the provider subtree and its associated credential when the user confirms both effects.

Credential save ordering follows DSH Web: settings are written first and a credential is written only after settings succeed. If a settings write succeeds but a credential write fails, the editor remains open and reports the credential failure; custom-provider profile fields stay locked and credential Retry does not repeat the committed settings mutation. Settings failure cannot create an orphan credential under this ordering.

The persistent Models controller owns non-secret directory, custom, and edit drafts across modal mounts. Disconnect advances its secret-clear epoch, settles pending busy states, preserves drafts and conflicts, and rejects late mutation results; the next Models view restores writability, refreshes custom-card revision ownership, and detects a route created elsewhere. A custom settings conflict clears the component-local secret, preserves the profile draft, and exposes Retry only after a refreshed revision; Retry writes settings without replaying a credential and a committed profile requires explicit key re-entry.

Custom and directory base URLs must be absolute HTTP or HTTPS URLs. Provider deletion uses a labelled confirmation dialog with Cancel focus, Escape dismissal, and focus return. Credential-removal failure does not send the provider mutation. If provider removal fails after credential success, the UI states that the removed credential cannot be restored and reconciles from a fresh Models view.

## Plugins section

Tabs:

- **Configurable:** specialized cards for namespaces mounted in this deployment.
- **All:** read-only plugin inventory.

Initial configurable cards:

- Shell: `timeoutMs`, `maxOutputBytes`.
- Agent Loop: `maxParallelToolCalls`.
- Web Search: credential, `baseURL`, `maxUses`.

Cards use staged Save, Discard, per-field Reset, overridden indicators, validation, and read-only states. Fields, numeric bounds and steps, defaults, and overrides come from redacted namespace descriptors. A card is absent when its namespace is unavailable. The Web Search card carries only closed credential metadata `{ ref, set, source?, writable }` plus `none`/`ready`/`failed` status; the bridge never resolves or returns its value.

Inventory includes the loader entry id, module name, enabled state, and fiber phase exposed by the DSH inventory service. The current service does not provide package descriptions. The view never exposes plugin configuration objects or secrets.

## Agent Presets section

The section supports:

- list presets and inspect built-in composition;
- mark default;
- copy with a validated new name;
- delete user-owned presets after confirmation;
- open user-owned preset folders through the host;

Built-in or read-only presets cannot be deleted. A preset that is active in a session may still be inspected or copied. Deleting the configured default requires choosing a distinct healthy preset as its replacement before deletion.

DSH Web's optional preset-creator action depends on its conversation hero and workspace-session client flow, not the agent-preset service. The extension does not advertise that action until an equivalent assembled-session entry point exists.

## Extension section

Fields:

- DSH binary path, string, empty means automatic probing.
- Handshake timeout in milliseconds, integer range 1,000–300,000.

Actions:

- Save extension settings.
- Open VS Code Settings filtered to DSH.
- Open the DSH settings document.
- Reveal DSH home.
- Restart DSH.

The host reads and writes the existing `dsh` configuration scope. A binary-path change is restart-required. Restart is disabled while the bridge is starting, thinking, or awaiting approval; it remains available after a child disconnect so the user can recover with updated launch settings. Restart closes the current child cleanly when one is running, starts the same `vscode` profile and cwd, then refreshes settings and restores or resumes the current session when supported. Restart failure leaves the modal open with a host error and the normal process recovery action.

## Localization

The settings feature owns an English and Chinese dictionary with identical keys. It covers modal chrome, sections, fields, descriptions, validation, confirmations, empty states, conflict actions, and restart messages.

The active language is the resolved DSH locale. Before the ready-time General bootstrap resolves, the extension uses English; a reconnect retains the last resolved locale while refreshing General. Unknown locale values retain the current UI language and remain visible as a settings error rather than being silently rewritten.

Provider- or plugin-supplied names and descriptions remain authoritative and are not machine translated.

## Accessibility

- Gear: button with dialog semantics and expanded state.
- Modal: `role="dialog"`, `aria-modal`, labelled heading.
- Close receives initial focus; closing restores gear focus.
- Navigation uses buttons with `aria-current`.
- Plugin tabs use `tablist`, `tab`, and `tabpanel`; Arrow keys, Home, and End switch tabs.
- Field errors and mutation failures use `role="alert"` without moving focus unexpectedly.
- Confirmations trap focus and return it to the invoking control.
- Secret fields use password input semantics and never repopulate after save.
- Loading states preserve the prior content and announce refresh through a polite live region.
- All controls remain operable at 200% zoom and narrow sidebar widths.

## Error behavior

| Failure | UI behavior |
|---|---|
| Section unavailable | Section-specific unavailable state; Extension remains usable |
| Read failure | Last good data remains with Retry |
| Validation rejection | Inline field or card error; draft remains |
| Revision conflict | Reload current value, preserve draft, show Retry/Discard |
| Credential rejection | Clear secret input value, retain non-secret draft, show error |
| External invalidation | Refresh active clean form; mark dirty form stale |
| Bridge disconnect | Preserve drafts, disable bridge writes, show reconnect state |
| Restart failure | Keep modal and drafts, show host error |
| Destructive operation failure | Keep item visible and confirmation context recoverable |

Errors name the affected namespace, provider, plugin, or preset and the corrective action when known. Internal stack traces and credential values never reach the webview.

## Security

- The webview cannot read stored credentials.
- Secret input values are excluded from reducer state, retained webview state, logs, diagnostics, and snapshots.
- Credential references and preset/provider ids are validated before service calls.
- Native filesystem actions accept bridge-resolved known paths, not arbitrary webview paths.
- Settings writes require revisions and DSH schema validation.
- The extension does not broaden webview CSP or add remote assets.
- Provider and plugin descriptions render as text, never trusted HTML.
- Full Access default and destructive deletes require confirmation.

## Files and boundaries

Expected new modules:

- `packages/bridge/src/settings/` with one coordinator plus focused adapters for general, models, plugins, and presets.
- `packages/extension/src/webview/media/settings/` with modal shell, state/reducer, localization, and one directory per section.
- `packages/extension/src/settingsHost.ts` for VS Code configuration, native paths, and restart actions.

The `vscode` bridge profile must also mount the host registrars absent from `dsh-base`: agent presets, locale settings, UI theme settings, conversation submission settings, and plugin inventory. These plugins register settings/services only; browser UI packages are not imported into the extension webview.

Existing files changed:

- contract protocol and validation;
- bridge runner and command dispatch;
- header and App wiring;
- extension host panel and process manager;
- README and package configuration descriptions.

Do not expand `store.ts` with all section-form logic. Conversation reducer integration is limited to opening, section snapshots, invalidation, and host lifecycle; section controllers own their drafts.

## Verification

### Contract

- Protocol version 5.
- Every message and tagged section view.
- Invalid request ids, sections, revisions, paths, operations, identifiers, secrets, and result tags.
- No credential value in any outbound type.

### Bridge

- Read and write every supported namespace through real mounted service fixtures.
- Revision success and conflict.
- Read-only and unavailable settings.
- External invalidation and stale-request suppression.
- Credential set/unset/redaction and cleanup failure.
- Model catalog refresh.
- Plugin configuration and inventory.
- Preset list/copy/delete/default behavior.
- Disconnect, cancellation, and reconnect.

### Webview state and components

- Lazy section loading and stale request ids.
- Dirty draft preservation through refresh/conflict/disconnect.
- General optimistic success and rollback.
- Model, plugin, and preset staged save/discard/reset.
- Secret input clearing and absence from reducer snapshots.
- Bilingual labels and immediate language switch.
- Modal focus, Escape, mask click, confirmations, tabs, and narrow layout.
- Restart-required banner and action gating.

### Integrated App

Use real App, settings reducer/controllers, modal, and section components. Mock only webview ports:

- open gear and load General;
- switch all sections and lazy load once;
- save each field/card class;
- resolve conflict;
- credential replace/unset;
- provider add/delete and model catalog refresh;
- preset copy/delete/default/open;
- plugin inventory;
- Extension read/write/native actions/restart;
- disconnect/reconnect with dirty draft;
- close with and without dirty forms.

### Extension host

- VS Code configuration scope and validation.
- Open Settings, settings document, DSH home, and preset path.
- Unsafe path rejection.
- Restart gating, child lifecycle, failure, and session restoration.

### Release checks

- Recursive typecheck, tests, and build.
- E2E typecheck and deterministic host tests.
- VSIX archive inspection.
- Manual smoke in VS Code and Cursor at narrow and wide sidebar widths, English and Chinese, light and dark themes.
- Manual credential redaction check in Extension Host logs and webview retained state.

## Documentation

Update the extension README with:

- section inventory;
- settings scope (`$DSH_HOME`, not workspace/session);
- current-session versus future-session defaults;
- credential redaction;
- live versus restart-required behavior;
- conflict behavior;
- Extension section ownership;
- unsupported cross-version protocol behavior.

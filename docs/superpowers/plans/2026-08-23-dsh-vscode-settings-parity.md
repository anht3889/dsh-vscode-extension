# DSH VS Code Settings Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the DSH header gear and deliver the General, Models, Plugins, Agent Presets, and Extension settings sections with the same durable DSH data and safety behavior as DSH Web.

**Architecture:** Protocol v5 carries dependency-free projections of DSH settings, credentials, models, plugin inventory, presets, invalidations, and trusted native paths. The bridge adapts mounted Cordis services; the extension host owns VS Code configuration, native filesystem actions, and restart; isolated webview settings controllers own bilingual modal state and drafts.

**Tech Stack:** TypeScript, React, VS Code Webview API, Cordis, DSH settings/credentials/preset services, NDJSON protocol, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-23-dsh-vscode-settings-parity-design.md`

## Global Constraints

- Include General, Models, Plugins, Agent Presets, and Extension in the first release.
- Use the existing DSH settings and credentials services; never parse or write YAML in the webview or extension host.
- Bump `PROTOCOL_VERSION` from `4` to `5`; do not add a v4 compatibility path.
- Call `settings.describe({ redactSecrets: true })` for every wire projection.
- Never send credential values from the bridge or store secret input values in reducer or retained webview state.
- Every DSH settings write includes the latest known namespace revision.
- Preserve dirty drafts across conflicts, invalidations, bridge disconnects, and reconnects.
- Current-session model and permission controls stay in the composer; settings edit defaults for future sessions.
- Keep settings state outside conversation `store.ts` and outside composer `PickerState`.
- The extension follows the editor theme; `ui-theme.preference` configures DSH Web only.
- DSH Web's preset creator is not exposed because it depends on the Web conversation/workspace client flow, not `ctx.agentPresets`.
- Plugin inventory projects only `entryId`, `moduleName`, `enabled`, and `fiberPhase`.
- Native filesystem operations accept only paths resolved by the bridge from known targets.
- Restart is explicit, preserves the current session id, and remains available after disconnect.
- Do not create commits unless the user explicitly requests them; each task ends at a commit-ready checkpoint.

---

## File Structure

### Contract

- `packages/contract/src/settings.ts` — protocol-v5 settings wire records and runtime validators.
- `packages/contract/src/settings.test.ts` — dependent-field, redaction, identifier, path, and union tests.
- `packages/contract/src/protocol.ts` — protocol unions and version bump.
- `packages/contract/src/index.ts` — exports settings records.

### Bridge

- `packages/bridge/src/settings/types.ts` — internal coordinator interfaces.
- `packages/bridge/src/settings/project.ts` — redacted namespace and error projection.
- `packages/bridge/src/settings/coordinator.ts` — request lifecycle, dispatch, and invalidation.
- `packages/bridge/src/settings/general.ts` — General section view.
- `packages/bridge/src/settings/models.ts` — provider, credential-state, and catalog projection.
- `packages/bridge/src/settings/plugins.ts` — configurable cards and loader inventory.
- `packages/bridge/src/settings/presets.ts` — preset list/read/copy/delete/default/path projection.
- `packages/bridge/src/settings/paths.ts` — trusted DSH home, settings document, and preset paths.
- Matching focused `*.test.ts` files.
- `packages/bridge/cordis.patch.yml` — mounts settings registrars, agent presets, and inventory.
- `packages/bridge/src/runner.ts` and `commands.ts` — coordinator lifecycle and inbound dispatch.

### Extension host

- `packages/extension/src/settingsHost.ts` and `test/settingsHost.test.ts` — VS Code configuration, trusted native actions, and restart.
- `packages/extension/src/webview/panel.ts` — routes host settings commands and intercepts path responses.
- `packages/extension/src/processManager.ts` and test — only if a focused restart primitive is needed.
- `packages/extension/package.json` — handshake maximum and settings descriptions.

### Webview

- `packages/extension/src/webview/media/settings/types.ts` — settings presentation and draft types.
- `settings/reducer.ts` and test — section cache, requests, invalidation, conflicts, host state.
- `settings/localization/{en,zh,index}.ts` — complete bilingual dictionary.
- `settings/SettingsModal.tsx`, `SettingsNav.tsx`, confirmation components, tests.
- `settings/sections/general/*`
- `settings/sections/extension/*`
- `settings/sections/models/*`
- `settings/sections/plugins/*`
- `settings/sections/agent-presets/*`
- `Header.tsx`, `App.tsx`, `vscode.ts`, `style.css`, and integration tests.

---

### Task 1: Protocol v5 settings contract

**Files:**
- Create: `packages/contract/src/settings.ts`
- Create: `packages/contract/src/settings.test.ts`
- Modify: `packages/contract/src/protocol.ts`
- Modify: `packages/contract/src/index.ts`
- Modify: `packages/contract/src/protocol.test.ts`

**Interfaces:**

```ts
export type SettingsSectionId =
  | "general"
  | "models"
  | "plugins"
  | "agent-presets";

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

export type SettingsInboundCommand =
  | GetSettingsSectionCommand
  | MutateSettingsCommand
  | SetCredentialCommand
  | UnsetCredentialCommand
  | CopyAgentPresetCommand
  | DeleteAgentPresetCommand
  | ReadAgentPresetCommand
  | ResolveSettingsPathCommand;
```

- [ ] **Step 1: Write failing validator tests**

Pin valid section, mutation, credential, preset, path, section-view, mutation-result, invalidation, preset-content, and settings-path messages. Add explicit rejection cases:

```ts
expect(isInboundMessage({
  kind: "mutateSettings",
  requestId: "m1",
  namespace: "permission",
  expectedRevision: 3,
  ops: [{ op: "set", path: ["defaultPreset"], value: "workspace-write" }],
})).toBe(true);

expect(isOutboundMessage({
  kind: "settingsSection",
  requestId: "s1",
  view: {
    section: "general",
    namespaces: [],
    agentPresets: [],
    permissionPresets: [],
  },
})).toBe(true);

expect(isOutboundMessage({
  kind: "settingsSection",
  requestId: "s1",
  view: { section: "models", credentialValue: "secret" },
})).toBe(false);
```

Reject empty request ids, unknown sections, namespace names outside kebab-case, negative/non-integer revisions, empty paths, forbidden object keys (`__proto__`, `constructor`, `prototype`), empty credential values, invalid credential refs, invalid preset ids, arbitrary path strings from inbound messages, malformed result tags, and any outbound credential value.

- [ ] **Step 2: Run contract tests and observe failure**

```bash
pnpm --filter @dsh-vscode/contract exec vitest run src/settings.test.ts src/protocol.test.ts
```

Expected: module-not-found and unknown-kind failures.

- [ ] **Step 3: Implement wire records and validators**

Keep settings validators in `settings.ts`:

```ts
export function isSettingsInboundCommand(value: unknown): value is SettingsInboundCommand;
export function isSettingsOutboundMessage(value: unknown): value is SettingsOutboundMessage;
```

Set `PROTOCOL_VERSION = 5`, add settings kinds to `InboundMessage` and `OutboundMessage`, and delegate payload checks from `protocol.ts`.

- [ ] **Step 4: Export and run contract checks**

```bash
pnpm --filter @dsh-vscode/contract run typecheck
pnpm --filter @dsh-vscode/contract run test
```

- [ ] **Step 5: Commit-ready checkpoint**

```bash
git diff --check
git diff -- packages/contract
```

Suggested message if explicitly requested: `feat(contract): add settings protocol v5`

---

### Task 2: Compose settings services in the vscode profile

**Files:**
- Modify: `packages/bridge/package.json`
- Modify: `packages/bridge/cordis.patch.yml`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/bridge/test/boot-probe.test.ts`

**Produces:** The vscode profile mounts `settings`, `credentials`, `agentPresets`, General namespaces, and plugin inventory.

- [ ] **Step 1: Add a failing boot probe**

Extend the real profile boot probe to assert:

```ts
expect(ctx.get("settings")).toBeDefined();
expect(ctx.get("credentials")).toBeDefined();
expect(ctx.get("agentPresets")).toBeDefined();
expect(ctx.get("pluginInventory")).toBeDefined();

const namespaces = ctx.get("settings")!
  .describe({ redactSecrets: true })
  .map((item) => String(item.ns));

expect(namespaces).toEqual(expect.arrayContaining([
  "permission",
  "agent-presets",
  "locale",
  "ui-theme",
  "ui-conversation",
  "agent-loop",
]));
```

- [ ] **Step 2: Run the probe and observe missing services**

```bash
pnpm --filter @dsh-vscode/bridge exec vitest run test/boot-probe.test.ts
```

- [ ] **Step 3: Add direct dependencies through pnpm**

```bash
pnpm --filter @dsh-vscode/bridge add \
  @deepseek-ai/dsh-settings \
  @deepseek-ai/dsh-credentials \
  @deepseek-ai/dsh-home-paths \
  @deepseek-ai/dsh-agent-presets \
  @deepseek-ai/dsh-client-locale \
  @deepseek-ai/dsh-client-ui-theme \
  @deepseek-ai/dsh-client-ui-conversation \
  @deepseek-ai/dsh-host-plugin-inventory
```

Use the versions pnpm resolves from the repository's current DSH release line.

- [ ] **Step 4: Mount missing host registrars**

Insert each plugin before `vscode-runner`, with ids matching DSH Web composition:

```yaml
- id: agent-presets
  name: '@deepseek-ai/dsh-agent-presets'
- id: locale-settings
  name: '@deepseek-ai/dsh-client-locale'
- id: theme-settings
  name: '@deepseek-ai/dsh-client-ui-theme'
- id: conversation-settings
  name: '@deepseek-ai/dsh-client-ui-conversation'
- id: plugin-inventory
  name: '@deepseek-ai/dsh-host-plugin-inventory'
```

Use each package's actual plugin export/config after inspecting its package entry point. Do not mount browser rendering plugins.

- [ ] **Step 5: Run boot, typecheck, and config verification**

```bash
pnpm --filter @dsh-vscode/bridge run typecheck
pnpm --filter @dsh-vscode/bridge exec vitest run test/boot-probe.test.ts
pnpm --filter @dsh-vscode/bridge run build
```

- [ ] **Step 6: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(bridge): mount settings services`

---

### Task 3: Bridge settings core, General view, paths, and invalidation

**Files:**
- Create: `packages/bridge/src/settings/types.ts`
- Create: `packages/bridge/src/settings/project.ts`
- Create: `packages/bridge/src/settings/general.ts`
- Create: `packages/bridge/src/settings/paths.ts`
- Create: `packages/bridge/src/settings/coordinator.ts`
- Create matching tests
- Modify: `packages/bridge/src/runner.ts`
- Modify: `packages/bridge/src/commands.ts`
- Modify: `packages/bridge/test/commands.test.ts`

**Interfaces:**

```ts
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

export function projectNamespace(
  descriptor: SettingsDescriptor,
  writable: boolean,
): SettingsNamespaceWire;
```

- [ ] **Step 1: Write projection and error tests**

Test redaction, revision, base/user/value defaults, applies, conflict mapping, rejected writes, cancelled requests, and no secret values:

```ts
const projected = projectNamespace(descriptor, true);
expect(projected.secrets).toEqual([{ path: ["apiKey"], set: true }]);
expect(JSON.stringify(projected)).not.toContain("actual-secret");
```

- [ ] **Step 2: Write General and path tests**

General must project only available namespaces plus agent and permission choices. Trusted paths:

```ts
expect(resolveSettingsTarget(ctx, { kind: "dsh-home" }))
  .resolves.toEqual({ target: "dsh-home", path: expectedHome });
expect(resolveSettingsTarget(ctx, {
  kind: "settings-document",
  prepare: true,
})).resolves.toEqual({
  target: "settings-document",
  path: expectedSettingsPath,
});
```

Reject system-preset paths and unknown preset ids.

- [ ] **Step 3: Write coordinator lifecycle tests**

Assert latest request wins, old-Agent/bridge generation replies are suppressed, dispose aborts, mutation returns the refreshed redacted namespace, and events emit:

```ts
{
  kind: "settingsInvalidated",
  sections: ["general"],
  reason: "document",
}
```

Map namespace invalidation exactly:

- locale/ui-theme/ui-conversation/permission/agent-presets → General;
- provider namespaces → Models;
- shell/agent-loop/web-search-deepseek → Plugins.

- [ ] **Step 4: Implement service adapters**

Always call:

```ts
ctx.settings.describe({ redactSecrets: true });
await ctx.settings.mutate(
  settingsNamespace(message.namespace),
  message.ops,
  message.expectedRevision,
);
```

Convert branded ids only after wire validation. Catch `SettingsConflictError` separately and include `actual` as `currentRevision`.

Until Tasks 4 and 5 install their adapters, requests for Models, Plugins, or Agent Presets return an explicit `settings-unavailable` result. They must never hang or return an empty view that claims availability.

- [ ] **Step 5: Wire runner and dispatcher**

`SessionController` gains the coordinator methods. `dispatchCommand` forwards each settings inbound kind. Create the coordinator once per bridge process, not once per session; its section reads resolve current services at request time. Dispose on disconnect/context cleanup.

- [ ] **Step 6: Run focused and bridge checks**

```bash
pnpm --filter @dsh-vscode/bridge exec vitest run \
  src/settings/project.test.ts \
  src/settings/general.test.ts \
  src/settings/paths.test.ts \
  src/settings/coordinator.test.ts \
  test/commands.test.ts
pnpm --filter @dsh-vscode/bridge run typecheck
```

- [ ] **Step 7: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(bridge): expose core settings services`

---

### Task 4: Models and credential bridge adapter

**Files:**
- Create: `packages/bridge/src/settings/models.ts`
- Create: `packages/bridge/src/settings/models.test.ts`
- Modify: `packages/bridge/src/settings/coordinator.ts`
- Modify: `packages/bridge/src/settings/coordinator.test.ts`

**Produces:**

```ts
export interface ModelProviderSettingsWire {
  id: string;
  namespace: string;
  label: string;
  api?: string;
  baseURL?: string;
  credential?: CredentialStateWire;
  models: { id: string; label: string; contextWindow?: number }[];
  removable: boolean;
  fields: SettingsFieldWire[];
}

export async function buildModelsView(
  ctx: Context,
): Promise<ModelsSettingsView>;
```

- [ ] **Step 1: Write failing model projection tests**

Use configurable provider fixtures for DeepSeek and pi-ai. Assert provider namespace/profile mapping, credential configured/writable state, model groups, catalog failures, and no resolved credential value.

- [ ] **Step 2: Write credential mutation tests**

Pin set/unset success, read-only shadow rejection, empty secret rejection, `credentials/updated` invalidation, and cleanup after a provider-settings failure:

```ts
expect(credentialValuesSeenBySend).toEqual([]);
expect(messages).toContainEqual({
  kind: "settingsInvalidated",
  sections: ["models"],
  reason: "credentials",
});
```

- [ ] **Step 3: Implement Models projection**

Use `ctx.llm.listConfigurableProviders()`, provider namespace descriptors, `ctx.llm.listModels()`, and `ctx.credentials.describe(credentialRef(ref))`. Catch catalog failure per provider and keep other providers.

- [ ] **Step 4: Integrate refresh**

Listen for `llm/adapters-updated` and relevant settings/credential events. After a successful live model write, emit both Models invalidation and the existing composer `catalog` refresh.

- [ ] **Step 5: Run checks**

```bash
pnpm --filter @dsh-vscode/bridge exec vitest run src/settings/models.test.ts
pnpm --filter @dsh-vscode/bridge run typecheck
pnpm --filter @dsh-vscode/bridge run test
```

- [ ] **Step 6: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(bridge): expose model settings`

---

### Task 5: Plugins and Agent Presets bridge adapters

**Files:**
- Create: `packages/bridge/src/settings/plugins.ts`
- Create: `packages/bridge/src/settings/plugins.test.ts`
- Create: `packages/bridge/src/settings/presets.ts`
- Create: `packages/bridge/src/settings/presets.test.ts`
- Modify: `packages/bridge/src/settings/coordinator.ts`

**Produces:**

```ts
export interface PluginInventoryItemWire {
  entryId: string;
  moduleName: string;
  enabled: boolean;
  fiberPhase:
    | "pending" | "loading" | "active" | "failed" | "unloading" | null;
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
```

- [ ] **Step 1: Write plugin tests**

Assert configurable cards exist only for mounted namespaces, exact fields and numeric constraints are projected, inventory uses only the four authoritative fields, and no plugin config object leaks into inventory.

- [ ] **Step 2: Write preset tests**

Assert list, default, read content, copy name/id validation, user-only delete, built-in delete rejection, default deletion fallback requirement, and user preset path resolution.

- [ ] **Step 3: Implement plugin adapter**

Read redacted `shell`, `agent-loop`, and `web-search-deepseek` descriptors. Call `ctx.pluginInventory.list()` for inventory. Web Search credential state comes from the referenced credential, never from descriptor value.

- [ ] **Step 4: Implement preset adapter**

Use:

```ts
await ctx.agentPresets.list();
await ctx.agentPresets.read(id);
await ctx.agentPresets.copy(from, id, name);
await ctx.agentPresets.remove(id);
```

Invalidate presets after local copy/delete/default mutation. Do not expose a preset-creator command.

- [ ] **Step 5: Run bridge checks**

```bash
pnpm --filter @dsh-vscode/bridge exec vitest run \
  src/settings/plugins.test.ts \
  src/settings/presets.test.ts
pnpm --filter @dsh-vscode/bridge run typecheck
pnpm --filter @dsh-vscode/bridge run test
```

- [ ] **Step 6: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(bridge): expose plugin and preset settings`

---

### Task 6: Settings state, localization, modal shell, and gear

**Files:**
- Create: `packages/extension/src/webview/media/settings/types.ts`
- Create: `packages/extension/src/webview/media/settings/reducer.ts`
- Create: `packages/extension/src/webview/media/settings/reducer.test.ts`
- Create: `packages/extension/src/webview/media/settings/localization/en.ts`
- Create: `packages/extension/src/webview/media/settings/localization/zh.ts`
- Create: `packages/extension/src/webview/media/settings/localization/index.ts`
- Create: `packages/extension/src/webview/media/settings/SettingsModal.tsx`
- Create: `packages/extension/src/webview/media/settings/SettingsModal.test.tsx`
- Create: `packages/extension/src/webview/media/settings/SettingsNav.tsx`
- Modify: `packages/extension/src/webview/media/components/Header.tsx`
- Modify: `packages/extension/src/webview/media/App.tsx`
- Modify: `packages/extension/src/webview/media/style.css`

**Interfaces:**

```ts
export interface SettingsState {
  open: boolean;
  activeSection: SettingsSectionId | "extension";
  locale: "en" | "zh";
  sections: Record<SettingsSectionId, SettingsSectionState>;
  connectionEpoch: number;
  restartRequired: boolean;
  confirmation?: SettingsConfirmation;
}

export type SettingsAction =
  | { kind: "openSettings" }
  | { kind: "closeSettings" }
  | { kind: "activateSettingsSection"; section: SettingsUiSectionId }
  | { kind: "settingsSectionReceived"; message: SettingsSectionMessage }
  | { kind: "settingsInvalidated"; message: SettingsInvalidatedMessage }
  | { kind: "settingsDisconnected"; detail: string };
```

- [ ] **Step 1: Write reducer tests**

Cover open/close, lazy request ids, stale response rejection, invalidation, disconnect preserving views/drafts, reconnect refresh, locale, restart-required, and section selection.

- [ ] **Step 2: Write modal tests**

Assert gear semantics, dialog/heading, initial close focus, gear focus restoration, Escape, mask dismissal, dirty-close confirmation seam, active navigation, horizontal narrow nav class, and no conversation draft mutation.

- [ ] **Step 3: Add complete dictionaries**

Export identical key sets:

```ts
export type SettingsCopyKey = keyof typeof en;
export function settingsText(locale: "en" | "zh", key: SettingsCopyKey): string;
```

Add a test comparing sorted keys and rejecting empty translations.

- [ ] **Step 4: Implement shell and App orchestration**

Bridge ready/reconnect bootstraps General when its cache is idle, stale, or unavailable. Opening settings reuses clean General data, joins an in-flight request, or refreshes stale/error data:

```ts
setRecentOpen(false);
dispatch({ kind: "pickerDismissed" });
settingsDispatch({ kind: "openSettings" });
requestSettingsSection("general");
```

Synchronously reserve each section request in the settings-state ref before posting so ready/open effects cannot duplicate it in one render. Closed invalidation marks General stale without immediate work; the next ready or open refreshes it. Do not place settings state in conversation `UiState`. Forward settings outbound messages to `settingsReducer` before normal conversation reduction.

- [ ] **Step 5: Implement responsive CSS**

Use fixed overlay, 800px cap, 188px rail, scrollable content, and `@media (max-width: 560px)` horizontal navigation. Verify no horizontal overflow at 320px.

- [ ] **Step 6: Run focused tests**

```bash
pnpm --filter dsh exec vitest run \
  src/webview/media/settings/reducer.test.ts \
  src/webview/media/settings/SettingsModal.test.tsx
pnpm --filter dsh run typecheck
```

- [ ] **Step 7: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(extension): add settings modal shell`

---

### Task 7: General section

**Files:**
- Modify: `packages/contract/src/protocol.ts` and tests
- Modify: `packages/bridge/src/{commands,runner}.ts` and tests
- Modify: `packages/extension/src/webview/media/{store,App}.tsx` and tests
- Modify: `packages/extension/src/webview/media/components/Composer.tsx` and tests
- Modify: `packages/extension/src/webview/{panel,panel.test}.ts`
- Create: `settings/sections/general/GeneralController.ts`
- Create: `settings/sections/general/GeneralController.test.ts`
- Create: `settings/sections/general/GeneralSection.tsx`
- Create: `settings/sections/general/GeneralSection.test.tsx`
- Modify: `settings/SettingsModal.tsx`
- Modify: `packages/extension/src/webview/media/App.test.tsx`

**Produces:** Immediate revisioned rows for default preset, permission, language, appearance, and busy Enter.

- [ ] **Step 0: Add correlated queue/steer admission**

Require submit `requestId` and `mode`, return a closed correlated `submitResult`, route queue to `agent.followup` and steer to `agent.steer`, and release the runner queue after admission rather than full idle. Observe later idle/context with live-agent and generation checks so cancellation, replacement, resume, disconnect, and newer admissions suppress stale publication. Preserve image-admission abort races and cover steer variants.

Track pending webview snapshots by request id and mode. Matching success clears only an unchanged snapshot; failure retains it. Idle Enter queues, busy plain Enter follows resolved `ui-conversation.busyEnter`, busy Cmd/Ctrl+Enter uses the opposite, and Shift+Enter remains a newline. Keep Stop available while busy. Whole-queue steering and queue editing remain out of scope.

Bootstrap General on ready/reconnect before the modal opens so persisted Busy Enter is available to Composer. Cover ready-time persisted steer, opening during the in-flight bootstrap without a duplicate request, reconnect refresh, and closed invalidation deferred to next ready/open. Assert queue admission logs `agent/inbox/spliced` target `next-turn`, symmetric with steer target `next-step`.

- [ ] **Step 1: Write controller tests**

Test field-path mapping:

```ts
expect(mutationFor("locale", "en", 4)).toEqual({
  kind: "mutateSettings",
  namespace: "locale",
  expectedRevision: 4,
  ops: [{ op: "set", path: ["preference"], value: "en" }],
});
```

Cover optimistic success, rollback, conflict preserving chosen value, unavailable/read-only rows, and serialized writes per namespace.

- [ ] **Step 2: Write component tests**

Assert all five rows, dangerous permission confirmation, immediate bilingual switch only after successful locale write, DSH Web appearance note, and busy-Enter options.

- [ ] **Step 3: Implement controller and section**

Use namespace descriptors by exact id. Missing namespaces omit rows. Values come from `value`, overridden state from field presence in `user`, and reset emits `unset`.

- [ ] **Step 4: Integrate Full Access confirmation**

Reuse the host modal behavior through a settings-specific host command that resolves to the same warning copy and then posts the mutation. A rejected confirmation does not mutate.

- [ ] **Step 5: Add App integration**

Open gear → receive General → change locale → post mutation → receive success → modal labels switch to Chinese. Also prove session model/permission values in Composer do not change until their existing session commands run.

- [ ] **Step 6: Run extension checks**

```bash
pnpm --filter dsh exec vitest run \
  src/webview/media/settings/sections/general/GeneralSection.test.tsx \
  src/webview/media/App.test.tsx
pnpm --filter dsh run typecheck
```

- [ ] **Step 7: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(extension): add general settings`

---

### Task 8: Extension settings and safe restart

**Files:**
- Create: `packages/extension/src/settingsHost.ts`
- Create: `packages/extension/test/settingsHost.test.ts`
- Create: `settings/sections/extension/ExtensionSection.tsx`
- Create: `settings/sections/extension/ExtensionSection.test.tsx`
- Modify: `packages/extension/src/webview/media/vscode.ts`
- Modify: `packages/extension/src/webview/panel.ts`
- Modify: `packages/extension/src/processManager.ts` and test if required
- Modify: `packages/extension/package.json`
- Modify: `settings/SettingsModal.tsx`

**Interfaces:**

```ts
export interface ExtensionSettingsView {
  binaryPath: string;
  handshakeTimeoutMs: number;
}

export interface SettingsHost {
  read(): ExtensionSettingsView;
  write(view: ExtensionSettingsView): Promise<void>;
  openExtensionSettings(): Promise<void>;
  openTrustedPath(path: string, mode: "open" | "reveal"): Promise<void>;
}
```

- [ ] **Step 1: Write host tests**

Mock VS Code configuration and commands. Assert user/workspace target preservation, timeout range 1,000–300,000, empty binary path, filtered settings command, and rejection of a path not returned by the pending bridge resolution request.

- [ ] **Step 2: Write restart tests**

Pin:

1. capture `currentSessionId`;
2. increment start generation;
3. stop current running child without clearing captured session;
4. start same folder/profile;
5. send `resume` after handshake;
6. preserve disconnected recovery;
7. report failure without losing the modal.

```ts
await provider.restart();
expect(secondClient.send).toHaveBeenCalledWith({
  kind: "resume",
  sessionId: "session-1",
});
```

- [ ] **Step 3: Implement trusted path interception**

For native actions, panel creates a request id, sends `resolveSettingsPath`, records expected target, intercepts the matching `settingsPath`, and opens/reveals only that returned path. Time out and clear pending requests on disconnect.

- [ ] **Step 4: Implement Extension section**

Use staged Save, inline validation, Open VS Code Settings, Open settings document, Reveal DSH home, and Restart. Restart is disabled during starting/thinking/approval but enabled after disconnect.

- [ ] **Step 5: Update package contribution**

Add `"maximum": 300000` and describe automatic binary probing accurately.

- [ ] **Step 6: Run host and UI checks**

```bash
pnpm --filter dsh exec vitest run \
  test/settingsHost.test.ts \
  test/processManager.test.ts \
  src/webview/media/settings/sections/extension/ExtensionSection.test.tsx
pnpm --filter dsh run typecheck
pnpm --filter dsh run typecheck:e2e
```

- [ ] **Step 7: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(extension): add extension settings and restart`

---

### Task 9: Models section

**Files:**
- Create: `settings/sections/models/ModelsController.ts`
- Create: `settings/sections/models/ModelsSection.tsx`
- Create: `settings/sections/models/ProviderEditor.tsx`
- Create focused tests
- Modify: `settings/SettingsModal.tsx`
- Modify: `packages/extension/src/webview/media/App.test.tsx`

- [ ] **Step 1: Write controller tests**

Cover provider selection, staged field edits, whole-card validation, reset/unset, add/delete provider, revision conflict, credential configured state, secret replacement/unset, and dirty state.

- [ ] **Step 2: Write secret-safety test**

Render an API key, type `super-secret`, save, then assert:

```ts
expect(postedSetCredential.value).toBe("super-secret");
expect(JSON.stringify(settingsState)).not.toContain("super-secret");
expect(vscodeSetState).not.toHaveBeenCalledWith(
  expect.stringContaining("super-secret"),
);
expect(screen.getByLabelText("API key")).toHaveValue("");
```

- [ ] **Step 3: Implement provider list/editor**

Show provider label, namespace, configured credential state, catalog availability, and one active editor. Render descriptors as text/select/number/model-list fields with specialized DeepSeek and pi-ai grouping.

- [ ] **Step 4: Implement Apply/Delete**

Apply posts settings mutation and credential operation with distinct request ids. Keep the editor open until both settle. On partial failure, display the exact failed stage and keep non-secret draft state. Delete requires confirmation and removes both configured profile and credential.

- [ ] **Step 5: Integrate composer catalog refresh**

After model invalidation/catalog outbound, prove the existing composer selector shows the new catalog and does not inject stale retired models.

- [ ] **Step 6: Run checks**

```bash
pnpm --filter dsh exec vitest run \
  src/webview/media/settings/sections/models \
  src/webview/media/App.test.tsx
pnpm --filter dsh run typecheck
```

- [ ] **Step 7: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(extension): add model settings`

---

### Task 10: Plugins section

**Files:**
- Create: `settings/sections/plugins/PluginsController.ts`
- Create: `settings/sections/plugins/PluginsSection.tsx`
- Create: `settings/sections/plugins/PluginCard.tsx`
- Create focused tests
- Modify: `settings/SettingsModal.tsx`

- [ ] **Step 1: Write controller tests**

Cover Configurable/All tabs, one form per namespace, dirty/save/discard/reset, revision conflict, read-only/unavailable cards, shell numeric fields, agent-loop integer field, and web-search credential staging.

- [ ] **Step 2: Write tab accessibility tests**

Assert `tablist`, selected `tab`, associated `tabpanel`, and ArrowLeft/Right/Home/End behavior.

- [ ] **Step 3: Implement configurable cards**

Validate:

- shell timeout/max output > 0;
- agent-loop parallel calls integer ≥ 1;
- web-search max uses integer ≥ 1;
- base URL is blank or valid URL.

Secrets stay component-local as in Models.

- [ ] **Step 4: Implement inventory**

Render only module name, entry id, enabled state, and fiber phase. Do not fabricate descriptions.

- [ ] **Step 5: Run checks**

```bash
pnpm --filter dsh exec vitest run src/webview/media/settings/sections/plugins
pnpm --filter dsh run typecheck
```

- [ ] **Step 6: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(extension): add plugin settings`

---

### Task 11: Agent Presets section

**Files:**
- Create: `settings/sections/agent-presets/AgentPresetsController.ts`
- Create: `settings/sections/agent-presets/AgentPresetsSection.tsx`
- Create: `settings/sections/agent-presets/PresetViewer.tsx`
- Create focused tests
- Modify: `settings/SettingsModal.tsx`
- Modify: `packages/extension/src/webview/media/App.test.tsx`

- [ ] **Step 1: Write controller tests**

Cover list/sort, read content, stale read response, set default, copy id/name validation, user-only delete, deleting default fallback confirmation, trusted open action, conflict, and invalidation.

- [ ] **Step 2: Implement list/viewer**

Show trust, broken state, description, default badge, and actions. Read composition lazily through `readAgentPreset`; render YAML as inert preformatted text.

- [ ] **Step 3: Implement copy/delete/default**

Copy validates kebab-case id and non-empty display name. Delete is absent for system presets. Deleting the current default requires selecting a distinct healthy replacement before deletion.

- [ ] **Step 4: Implement native open**

The webview posts only preset id. The host resolves it through the trusted path protocol and opens/reveals the returned user preset directory. System presets remain view-only.

- [ ] **Step 5: Add App integration and checks**

```bash
pnpm --filter dsh exec vitest run \
  src/webview/media/settings/sections/agent-presets \
  src/webview/media/App.test.tsx
pnpm --filter dsh run typecheck
```

- [ ] **Step 6: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(extension): add agent preset settings`

---

### Task 12: Conflict, dirty-close, reconnect, and cross-section integration

**Files:**
- Modify: `settings/reducer.ts` and test
- Modify all section controllers and focused tests
- Modify: `settings/SettingsModal.tsx` and test
- Modify: `packages/extension/src/webview/media/App.test.tsx`
- Modify: `packages/bridge/src/settings/coordinator.test.ts`

- [ ] **Step 1: Add the conflict matrix**

For General, Models, Plugins, and Presets, prove stale revision:

- preserves local draft;
- stores refreshed remote view;
- marks form stale;
- Retry uses new revision and same draft;
- Discard accepts remote value.

- [ ] **Step 2: Add dirty-close tests**

Escape, mask click, gear toggle, and close button show confirmation when any staged form is dirty. General immediate writes do not count as dirty. Confirm Discard clears staged non-secret drafts and closes; Cancel restores modal focus.

- [ ] **Step 3: Add disconnect/reconnect tests**

Disconnect preserves settings modal, drafts, locale, and Extension section. Bridge writes disable. Reconnect refreshes active section and rejects stale pre-disconnect replies by generation.

- [ ] **Step 4: Add simultaneous conversation tests**

While settings is open:

- incoming stream continues rendering;
- current session model/permission remain usable outside modal;
- restart/destructive actions disable during thinking/approval;
- closing settings restores composer state unchanged.

- [ ] **Step 5: Run complete settings integration**

```bash
pnpm --filter @dsh-vscode/bridge run test
pnpm --filter dsh exec vitest run src/webview/media/settings src/webview/media/App.test.tsx
pnpm -r run typecheck
```

- [ ] **Step 6: Commit-ready checkpoint**

Suggested message if explicitly requested: `test(settings): cover lifecycle and conflicts`

---

### Task 13: Documentation, packaging, and manual verification

**Files:**
- Modify: `packages/extension/README.md`
- Verify: `docs/superpowers/specs/2026-08-23-dsh-vscode-settings-parity-design.md`
- Verify all settings source and test files

- [ ] **Step 1: Update README**

Document:

- five sections and gear behavior;
- `$DSH_HOME` global scope;
- current-session versus future-session defaults;
- credentials redaction;
- live/restart-required changes;
- revision conflicts and external synchronization;
- Extension section ownership;
- protocol v5 incompatibility.

- [ ] **Step 2: Run all automated checks**

```bash
pnpm -r run typecheck
pnpm -r run test
pnpm -r run build
pnpm --filter dsh run typecheck:e2e
git diff --check
```

- [ ] **Step 3: Package and inspect**

```bash
pnpm --filter dsh run package
unzip -t packages/extension/dsh-0.1.0.vsix
unzip -l packages/extension/dsh-0.1.0.vsix
```

Confirm protocol v5 and settings UI are bundled, source/tests/master artwork are excluded, and no credential fixture is present.

- [ ] **Step 4: Manual smoke in VS Code and Cursor**

For both editors, at wide and narrow sidebar widths:

1. Open/close gear with mouse, Escape, mask, and keyboard.
2. Verify English/Chinese switching and light/dark host themes.
3. Exercise every General row and revision conflict.
4. Add/edit/delete a test model provider and verify credential redaction.
5. Save/reset each plugin card and inspect inventory.
6. Copy/view/default/delete a user preset and open its folder.
7. Edit Extension settings, restart, and resume the session.
8. Disconnect, change binary path, recover with Restart.
9. Inspect Extension Host logs and retained webview state for secret absence.

- [ ] **Step 5: Final review**

```bash
git status --short --untracked-files=all
git diff --stat
git diff --check
```

Verify no credential files, `.env`, generated `dist/`, VSIX, settings YAML, preset copies, or unrelated changes are tracked.

- [ ] **Step 6: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(extension): add DSH settings parity`

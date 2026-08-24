# DSH VS Code Plugin Settings Implementation Plan — MCP and Web Search

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver MCP and Web Search settings sections in the DSH VS Code extension that exist exactly while their optional out-of-tree plugin service is mounted, with full MCP management short of OAuth authorization launch and full Web Search engine/key management, and publish the `dsh-web-search` management runtime as a named Cordis service so the `vscode` profile can reach it without a web server.

**Architecture:** Protocol v6 carries closed, dependency-free projections of the two optional plugin runtimes. The bridge probes `ctx.mcp` and `ctx.webSearchManager` through Cordis's untyped `get(name)` accessor plus global `internal/service` events, publishes the result as a capability list, and adapts each runtime per request without holding a probed reference. The `dsh-web-search` repository gains a dependency-minimal seam package that declares the `WebSearchManagement` Service Definition; its manager plugin provides the existing runtime on `ctx.webSearchManager` and notifies listeners after successful writes. Webview section controllers own selection, drafts, staged secrets, polling, and bilingual presentation; secret values travel inbound only and never enter reducer state, controller snapshots, or retained state.

**Tech Stack:** TypeScript, React, VS Code Webview API, Cordis, NDJSON protocol over the existing extension relay, Vitest, Testing Library, tsdown (web-search bundle), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-23-dsh-vscode-plugin-settings-design.md`

## Global Constraints

- No dynamic browser plugin loading, no web server, and no plugin-UI framework: the extension ships UI for these two known capabilities only.
- The bridge imports nothing from `@anht3889/*` at build time. Both optional runtimes are read through bridge-local structural interfaces and `ctx.get(name)`; the workspace typechecks and builds with neither plugin installed.
- Service availability is the only gate. A missing or structurally incomplete service yields no nav row, no request, and no error banner; an incomplete mounted service logs exactly one bridge warning per registration generation.
- Probes run at runner creation and re-run on Cordis global `internal/service` events (`{ global: true }`) for the names `mcp` and `webSearchManager`.
- Protocol version rises from `5` to `6`. No v5 compatibility path, no negotiated subset, no shim.
- Every new wire record is a closed discriminated record in `@dsh-vscode/contract` with no `@deepseek-ai/*` and no `@anht3889/*` type on the wire.
- Optional nav rows render only for sections listed in the latest `settingsCapabilities`; unconditional sections are never listed.
- The Web Search service name is `webSearchManager` and its methods are exactly `getCatalog`, `putCatalog`, `describeSecrets`, `putSecrets`, `available`, and `onChanged`. `onChanged` fires only after a successful `putCatalog` or a successful `putSecrets`.
- The MCP service name is `mcp`. Required members: `list`, `get`, `upsert`, `remove`, `setEnabled`, `connect`, `disconnect`, `getStatus`, `getLogs`, `getTools`, `setToolEnabled`, `clearOAuth`, `setSecrets`. Optional members: `describeSecrets`, `onCatalogChanged`. `dsh-mcp-management` is not modified by this plan.
- Secret-operation failures (`setSecrets`, `putSecrets`) use extension-owned generic copy naming only the server id or the secret ref. Plugin exception text is never forwarded from a call that receives a secret literal. Catalog and record validation text may be forwarded, truncated to 512 characters.
- Web Search saves the catalog first and secrets second. A catalog failure writes no secret; a catalog success with per-key failures returns `ok: true` with `secretFailures`. There is no secret unset.
- MCP saves the record first and secrets second, aborts secrets on record failure, and offers a secret-only retry. OAuth configuration, `OAUTH_CLIENT_SECRET`, and Clear OAuth tokens are supported; authorize, discover, and callback are not called and not rendered.
- Active polling exists only for MCP, at 2,000 ms, while the modal is open and MCP is active; Web Search relies on same-process `onChanged` invalidation.
- While the external web-search service is mounted, `buildPluginsView` omits the core `web-search-deepseek` card and its namespace projection; while it is absent, both are projected exactly as today.
- The cross-process catalog cache limitation is documented, not fixed: each profile caches its catalog in memory and sees another profile's on-disk change only after restart.
- Existing settings behavior is reused, not re-implemented: dirty-close confirmation, `dialogFocus`, section state machine, accessibility conventions, and the bilingual dictionary with identical keys.
- Every new collection and string is bounded; an over-cap payload fails the request closed with an explicit error and never truncates silently. Bounds stay consistent with `SETTINGS_WIRE_SCAN_NODE_LIMIT = 65_536`, and the bounds test builds maximal messages.
- No secret value appears in an outbound message, reducer state, a controller snapshot, retained webview state, a log, a test snapshot, or the packaged VSIX.
- Do not push, publish, merge, or install globally. Local builds, package verification, and manual smoke are verification only.
- Do not create commits unless the user explicitly requests them; each task ends at a commit-ready checkpoint.

---

## Rulings Made While Planning

These resolve gaps or arithmetic conflicts found while inspecting the two repositories. Implement the ruling, not the superseded spec value.

1. **MCP list-view node ceiling is 40,960, not 8,192.** One maximal `McpServerListItemWire` costs 576 scan nodes (server record 569 + status 4 + two counts 2 + item record 1), because the mutually exclusive transports cannot emit `command` and `url` together. Sixty-four items plus the seven-node view shell cost 36,871 nodes, and the three-node message envelope raises the total to 36,874. An 8,192 ceiling would fail closed on a payload that satisfies every documented per-collection cap — a product limit, which section 4 forbids. The 40,960 ceiling stays below the 65,536 scan budget. Detail (8,192 vs 1,695 maximal), logs (16,384 vs 2,569 maximal), and Web Search (256 vs 32 maximal) ceilings are unchanged.
2. **`packages/bundle/tests/manager/runtime.spec.ts` does not exist yet and is created by Task 1.** Section 12 lists it as changed; the repository has no such file.
3. **The seam dependency is recorded as the literal version `"0.1.0"` and `pnpm-workspace.yaml` gains `linkWorkspacePackages: true`.** `scripts/publish-npm.sh` runs `npm publish`, which does not rewrite pnpm's `workspace:` protocol, so a `workspace:` range would publish an uninstallable manifest. The literal version plus workspace linking keeps local development linked and the published manifest valid.
4. **`.github/workflows/publish.yml` is not modified.** It publishes the bundle only. Because the seam is a production dependency inlined by neither build half, a published bundle needs a published seam; that release decision belongs to the user and this plan contains no publish step. Task 11 records the prerequisite in the deployment docs.
5. **Web Search `available()` is synchronous (`available(): boolean`)** because `MultiEngineSearchProvider.available()` is synchronous; the seam mirrors the runtime rather than widening it to a promise.
6. **`McpServerInputWire.serverId` absent means create.** The bridge generates the id with `crypto.randomUUID()` and both timestamps with `new Date().toISOString()`, and preserves `createdAt` from the stored record on edit.
7. **The capability watcher owns the `internal/service` subscription, and the coordinator owns per-service change listeners.** `runner.ts` wires the watcher's push callback to the relay so a capability change needs no webview action.

---

## File Structure

### `/Users/anhtra/workspace/dsh-web-search`

New:

- `packages/service/package.json`, `tsconfig.json`, `README.md`, `LICENSE`, `scripts/clean.mjs`
- `packages/service/src/index.ts` — `WebSearchManagement`, Cordis declaration merging, `webSearchManagerOf`
- `packages/service/src/types.ts` — catalog, engine, and secret-ref types and constants
- `packages/service/tests/service.spec.ts`
- `packages/bundle/tests/manager/runtime.spec.ts`

Changed:

- `packages/bundle/src/manager/runtime.ts` — `available()`, `onChanged()`, notification after successful writes, listener clearing
- `packages/bundle/src/manager/index.ts` — `ctx.provide('webSearchManager', runtime)` plus the listener-clearing effect
- `packages/bundle/src/manager/types.ts`, `secrets.ts` — re-export the moved types from the seam
- `packages/bundle/package.json`, `packages/bundle/tsconfig.manager.json`, `packages/bundle/tests/pack-smoke.mjs`, `packages/bundle/tests/manager/loader.spec.ts`
- root `package.json`, root `tsconfig.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- `README.md`, `docs/design.md`

### `/Users/anhtra/workspace/dsh-vscode-extension`

New:

- `packages/bridge/src/settings/optional-services.ts` + `optional-services.test.ts`
- `packages/bridge/src/settings/capabilities.ts` + `capabilities.test.ts`
- `packages/bridge/src/settings/mcp.ts` + `mcp.test.ts`
- `packages/bridge/src/settings/web-search.ts` + `web-search.test.ts`
- `packages/extension/src/webview/media/settings/sections/mcp/{McpController.ts,McpSection.tsx,McpServerList.tsx,McpServerDetail.tsx,McpServerEditor.tsx,McpLogView.tsx}` + tests
- `packages/extension/src/webview/media/settings/sections/web-search/{WebSearchController.ts,WebSearchSection.tsx}` + tests

Changed:

- `packages/contract/src/settings.ts`, `settings.test.ts`, `protocol.ts`, `protocol.test.ts`
- `packages/bridge/src/settings/{coordinator.ts,types.ts,plugins.ts}` and `coordinator.test.ts`, `plugins.test.ts`
- `packages/bridge/src/commands.ts`, `packages/bridge/src/runner.ts`, `packages/bridge/test/{commands.test.ts,boot.ts,boot-probe.test.ts,settings-wire-bounds.test.ts}`
- `packages/extension/src/webview/media/settings/{types.ts,reducer.ts,reducer.test.ts,SettingsNav.tsx,SettingsModal.tsx}`
- `packages/extension/src/webview/media/settings/localization/{en.ts,zh.ts,models.test.ts}`
- `packages/extension/src/webview/media/App.tsx`, `App.test.tsx`, `media/style.css`
- `packages/extension/README.md`

The extension host is unchanged: `panel.ts` already forwards outbound messages it does not interpret.

---

### Task 1: Publish the web-search management runtime as a service

**Repository:** `/Users/anhtra/workspace/dsh-web-search` (this task runs entirely there; the repository has no `AGENTS.md` or `CLAUDE.md`, so `README.md` and `docs/design.md` are the authority)

**Files:**
- Create: `packages/service/package.json`
- Create: `packages/service/tsconfig.json`
- Create: `packages/service/README.md`
- Create: `packages/service/LICENSE` (copy of the repository `LICENSE`)
- Create: `packages/service/scripts/clean.mjs`
- Create: `packages/service/src/types.ts`
- Create: `packages/service/src/index.ts`
- Create: `packages/service/tests/service.spec.ts`
- Create: `packages/bundle/tests/manager/runtime.spec.ts`
- Modify: `packages/bundle/src/manager/runtime.ts`
- Modify: `packages/bundle/src/manager/index.ts`
- Modify: `packages/bundle/src/manager/types.ts`
- Modify: `packages/bundle/src/manager/secrets.ts`
- Modify: `packages/bundle/package.json`
- Modify: `packages/bundle/tsconfig.manager.json`
- Modify: `packages/bundle/tests/pack-smoke.mjs`
- Modify: `packages/bundle/tests/manager/loader.spec.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `README.md`
- Modify: `docs/design.md`

**Interfaces produced** (`@anht3889/dsh-web-search-service`):

```ts
// packages/service/src/types.ts
export type SearchEngineId = 'tavily' | 'brave' | 'searxng'

export interface EngineEndpoints {
  tavily?: { baseURL?: string }
  brave?: { baseURL?: string }
  searxng?: { baseURL?: string }
}

export interface WebSearchCatalog {
  engine: SearchEngineId | null
  engines: EngineEndpoints
}

export const EMPTY_CATALOG: WebSearchCatalog = { engine: null, engines: {} }
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com'
export const BRAVE_DEFAULT_BASE_URL = 'https://api.search.brave.com'
export const ENGINE_IDS: readonly SearchEngineId[] = ['tavily', 'brave', 'searxng']
export const TAVILY_API_KEY_REF = 'TAVILY_API_KEY' as const
export const BRAVE_API_KEY_REF = 'BRAVE_API_KEY' as const
export type WebSearchSecretRef = typeof TAVILY_API_KEY_REF | typeof BRAVE_API_KEY_REF
export const WEB_SEARCH_SECRET_REFS: readonly WebSearchSecretRef[] = [
  TAVILY_API_KEY_REF,
  BRAVE_API_KEY_REF,
]
```

```ts
// packages/service/src/index.ts
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webSearchManager: WebSearchManagement
  }
}

export interface WebSearchManagement {
  getCatalog(): WebSearchCatalog
  putCatalog(catalog: WebSearchCatalog): Promise<WebSearchCatalog>
  describeSecrets(): Promise<Record<WebSearchSecretRef, { configured: boolean }>>
  putSecrets(partial: Partial<Record<WebSearchSecretRef, string>>): Promise<void>
  available(): boolean
  onChanged(listener: () => void): () => void
}

export function webSearchManagerOf(ctx: Context): WebSearchManagement | undefined
export const WEB_SEARCH_MANAGER_SERVICE = 'webSearchManager' as const
```

**Interfaces consumed:** `@deepseek-ai/cordis` `Context` (peer, type-only in the seam); the existing `WebSearchRuntime`, `MultiEngineSearchProvider`, and `SecretStore` inside `packages/bundle`.

- [ ] **Step 1: Write the failing seam and runtime tests**

Create `packages/service/tests/service.spec.ts` covering the seam in isolation:

```ts
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  BRAVE_API_KEY_REF,
  BRAVE_DEFAULT_BASE_URL,
  EMPTY_CATALOG,
  ENGINE_IDS,
  TAVILY_API_KEY_REF,
  TAVILY_DEFAULT_BASE_URL,
  WEB_SEARCH_MANAGER_SERVICE,
  WEB_SEARCH_SECRET_REFS,
  webSearchManagerOf,
  type WebSearchManagement,
} from '@anht3889/dsh-web-search-service'

const fake: WebSearchManagement = {
  getCatalog: () => EMPTY_CATALOG,
  putCatalog: async catalog => catalog,
  describeSecrets: async () => ({
    [TAVILY_API_KEY_REF]: { configured: false },
    [BRAVE_API_KEY_REF]: { configured: false },
  }),
  putSecrets: async () => {},
  available: () => false,
  onChanged: () => () => {},
}

describe('@anht3889/dsh-web-search-service', () => {
  it('exports the catalog constants the bundle re-exports', () => {
    expect(ENGINE_IDS).toEqual(['tavily', 'brave', 'searxng'])
    expect(TAVILY_DEFAULT_BASE_URL).toBe('https://api.tavily.com')
    expect(BRAVE_DEFAULT_BASE_URL).toBe('https://api.search.brave.com')
    expect(EMPTY_CATALOG).toEqual({ engine: null, engines: {} })
    expect(WEB_SEARCH_SECRET_REFS).toEqual(['TAVILY_API_KEY', 'BRAVE_API_KEY'])
    expect(WEB_SEARCH_MANAGER_SERVICE).toBe('webSearchManager')
  })

  it('resolves a provided manager and reports absence without throwing', async () => {
    const ctx = new Context()
    expect(webSearchManagerOf(ctx)).toBeUndefined()
    const dispose = ctx.provide('webSearchManager', fake)
    expect(webSearchManagerOf(ctx)).toBe(fake)
    await dispose()
    expect(webSearchManagerOf(ctx)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('carries no Node import in its sources', async () => {
    const { readFile } = await import('node:fs/promises')
    for (const file of ['src/index.ts', 'src/types.ts']) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
      expect(source).not.toMatch(/from 'node:/)
      expect(source).not.toMatch(/require\('node:/)
    }
  })
})
```

Create `packages/bundle/tests/manager/runtime.spec.ts` covering the two runtime additions against a temporary directory, mirroring the existing `tests/manager/catalog.spec.ts` fixture style:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSearchRuntime } from '../../src/manager/runtime.ts'
```

Assert, in separate cases:

- `available()` is `false` for `EMPTY_CATALOG`, `true` after `putCatalog({ engine: 'tavily', engines: {} })`, `false` after `putCatalog({ engine: 'searxng', engines: {} })`, and `true` after `putCatalog({ engine: 'searxng', engines: { searxng: { baseURL: 'https://searx.example' } } })`, and equals `runtime.provider().available()` in every one of those states.
- `onChanged` listeners run once per successful `putCatalog`, and `getCatalog()` inside the listener already returns the new catalog.
- `onChanged` listeners run once per `putSecrets` that stored at least one non-empty value, and do not run for `putSecrets({})` or `putSecrets({ TAVILY_API_KEY: '' })`.
- `onChanged` listeners do not run when `putCatalog` rejects (inject `persistCatalogForTest` that throws) and the previous catalog stays live.
- the disposer returned by `onChanged` removes only that listener.

- [ ] **Step 2: Run both suites and observe failure**

```bash
cd /Users/anhtra/workspace/dsh-web-search
pnpm exec vitest run packages/service/tests/service.spec.ts packages/bundle/tests/manager/runtime.spec.ts
```

Expected: `service.spec.ts` fails to resolve `@anht3889/dsh-web-search-service`; `runtime.spec.ts` fails with `runtime.available is not a function` and `runtime.onChanged is not a function`.

- [ ] **Step 3: Create the seam package**

`packages/service/package.json`:

```json
{
  "name": "@anht3889/dsh-web-search-service",
  "version": "0.1.0",
  "description": "Service Definition for DeepSeek Harness web-search configuration management",
  "keywords": ["web-search", "deepseek-harness", "dsh", "cordis", "service"],
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/anht3889/dsh-web-search.git",
    "directory": "packages/service"
  },
  "license": "MIT",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib/**/*.js", "lib/**/*.d.ts", "LICENSE", "README.md"],
  "scripts": {
    "clean": "node scripts/clean.mjs",
    "build": "pnpm run clean && tsc -p tsconfig.json"
  },
  "peerDependencies": { "@deepseek-ai/cordis": "*" },
  "devDependencies": { "@deepseek-ai/cordis": "4.0.1" }
}
```

`packages/service/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib",
    "tsBuildInfoFile": ".cache/tsconfig.tsbuildinfo",
    "composite": true,
    "rewriteRelativeImportExtensions": true,
    "types": []
  },
  "include": ["src"]
}
```

`packages/service/scripts/clean.mjs`:

```js
import { rm } from 'node:fs/promises'

await Promise.all([
  'lib',
  '.cache',
].map((path) => rm(new URL(`../${path}`, import.meta.url), { recursive: true, force: true })))
```

`src/types.ts` and `src/index.ts` carry exactly the interfaces above, each export with JSDoc stating its contract, and `webSearchManagerOf` implemented as `return ctx.get(WEB_SEARCH_MANAGER_SERVICE)`. `src/index.ts` re-exports everything from `./types.ts`. `types: []` in the tsconfig proves the package compiles with no Node typings.

`packages/service/README.md` states what the service is, that a provider publishes it with `ctx.provide('webSearchManager', runtime)`, the six members and when `onChanged` fires, and that the package is dependency-free apart from the `@deepseek-ai/cordis` peer.

```bash
cp LICENSE packages/service/LICENSE
```

- [ ] **Step 4: Wire the package graph**

Add `linkWorkspacePackages: true` to `pnpm-workspace.yaml` beside the existing `autoInstallPeers: false`, add `"@anht3889/dsh-web-search-service": "0.1.0"` to `packages/bundle/package.json` `dependencies`, bump `packages/bundle/package.json` `version` to `0.2.0`, then install and prove the link:

```bash
pnpm install
node -p "require('node:fs').realpathSync('packages/bundle/node_modules/@anht3889/dsh-web-search-service')"
```

Expected: the printed path ends with `dsh-web-search/packages/service`.

Add `{ "path": "./packages/service" }` as the first entry of the root `tsconfig.json` `references`, add `"references": [{ "path": "../service" }]` to `packages/bundle/tsconfig.manager.json`, and extend the root `package.json` `typecheck` script so `tsc -p packages/service/tsconfig.json` runs first:

```json
"typecheck": "tsc -p packages/service/tsconfig.json && tsc -p packages/bundle/tsconfig.manager.json && tsc -p packages/bundle/tsconfig.json && tsc -p packages/bundle/tsconfig.tests.manager.json && tsc -p packages/bundle/tsconfig.tests.client.json"
```

- [ ] **Step 5: Move the shared types and add the runtime members**

In `packages/bundle/src/manager/types.ts`, delete the local declarations and re-export, keeping the module JSDoc:

```ts
export type { EngineEndpoints, SearchEngineId, WebSearchCatalog } from '@anht3889/dsh-web-search-service'
export {
  BRAVE_DEFAULT_BASE_URL,
  EMPTY_CATALOG,
  ENGINE_IDS,
  TAVILY_DEFAULT_BASE_URL,
} from '@anht3889/dsh-web-search-service'
```

In `packages/bundle/src/manager/secrets.ts`, replace the two local `*_API_KEY_REF` constants and the `SecretRef` alias with re-exports, keeping every other export unchanged:

```ts
export {
  BRAVE_API_KEY_REF,
  TAVILY_API_KEY_REF,
} from '@anht3889/dsh-web-search-service'
export type { WebSearchSecretRef as SecretRef } from '@anht3889/dsh-web-search-service'
```

Import them locally where `secrets.ts` uses them. `catalog.ts` keeps its existing `export { EMPTY_CATALOG } from './types.ts'` re-export chain and needs no edit.

In `packages/bundle/src/manager/runtime.ts`, declare the class as `export class WebSearchRuntime implements WebSearchManagement`, add a private `#listeners = new Set<() => void>()`, and add:

```ts
  /** @returns whether the selected engine and its base URL are usable now. */
  available(): boolean {
    return this.#provider.available()
  }

  /**
   * @param listener - called after a successful `putCatalog` or `putSecrets`.
   * @returns a disposer that removes this listener.
   */
  onChanged(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Removes every change listener; the plugin calls this at fiber unload. */
  clearChangeListeners(): void {
    this.#listeners.clear()
  }

  #notifyChanged(): void {
    for (const listener of [...this.#listeners]) listener()
  }
```

`putCatalog` calls `this.#notifyChanged()` inside the mutation queue after `this.#catalog = catalog`, so a listener reading `getCatalog()` sees the new value and a rejected persistence never notifies. `putSecrets` collects the per-ref results of `setWhenPresent` and notifies once when at least one value was stored; change `setWhenPresent` to return `boolean` (`false` for `undefined` or empty).

- [ ] **Step 6: Provide the service from the manager plugin**

In `packages/bundle/src/manager/index.ts`, after the existing provider effect:

```ts
  ctx.effect(
    () => ctx.web.registerSearchProvider(runtime.provider()),
    'dsh-web-search.provider',
  )
  ctx.provide('webSearchManager', runtime)
  ctx.effect(
    () => () => runtime.clearChangeListeners(),
    'dsh-web-search.manager-listeners',
  )
```

Add `import type {} from '@anht3889/dsh-web-search-service'` so the declaration merging that types `ctx.provide('webSearchManager', ...)` is in scope, and re-export the seam's public types from `manager/index.ts` alongside the existing `WebSearchRuntime` exports.

- [ ] **Step 7: Extend the loader test and pack verification**

In `packages/bundle/tests/manager/loader.spec.ts`, add a case asserting that after loading the plugin through the real loader entry, `ctx.get('webSearchManager')` is defined, exposes the six members as functions, returns the same object across two reads, and that `ctx.get('webSearchManager')!.available()` matches the registered provider's `available()`; after `fiber.dispose()`, assert `ctx.get('webSearchManager')` is `undefined` and that a listener registered before disposal is no longer called by a later `putCatalog` on the retained runtime reference.

In `packages/bundle/tests/pack-smoke.mjs`, after the existing `providers.has('dsh-web-search')` assertion and before `fiber.dispose()`:

```js
const manager = ctx.get('webSearchManager')
assert.ok(manager, 'manager plugin did not provide webSearchManager')
for (const member of ['getCatalog', 'putCatalog', 'describeSecrets', 'putSecrets', 'available', 'onChanged']) {
  assert.equal(typeof manager[member], 'function', `webSearchManager.${member} is missing`)
}
```

Leave the packed-file assertions unchanged; the bundle's own file surface does not move.

- [ ] **Step 8: Run the repository gates**

```bash
cd /Users/anhtra/workspace/dsh-web-search
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run verify:package
```

All four must pass. `verify:package` runs `pnpm pack --dry-run` and prints the packed file list; confirm it is unchanged apart from nothing being added.

- [ ] **Step 9: Document the seam**

In `README.md`, add a "Management service" subsection stating that the bundle publishes `ctx.webSearchManager` from `@anht3889/dsh-web-search-service`, that the seam package must be installed alongside the bundle because it is a production dependency, and that hosts without a web server use the service instead of the loopback HTTP API. In `docs/design.md`, document the seam package, the six members, the `onChanged` firing rule (after successful `putCatalog` or a `putSecrets` that stored a value), listener clearing at fiber unload, and that the HTTP API is unchanged.

- [ ] **Step 10: Commit-ready checkpoint**

```bash
cd /Users/anhtra/workspace/dsh-web-search
git status --short
git diff --check
```

Suggested message if explicitly requested: `feat(service): publish web-search management as ctx.webSearchManager`

---

### Task 2: Protocol v6 contract, capabilities, and bounds

**Repository:** `/Users/anhtra/workspace/dsh-vscode-extension` (Tasks 2 through 11 all run here)

**Files:**
- Modify: `packages/contract/src/settings.ts`
- Modify: `packages/contract/src/settings.test.ts`
- Modify: `packages/contract/src/protocol.ts`
- Modify: `packages/contract/src/protocol.test.ts`
- Modify: `packages/contract/src/index.ts`

**Interfaces produced:** everything in spec sections 4 (Section identifiers, Capability announcement, Inbound families, Shared wire types, Outbound message families) plus these exported bound constants and validators:

```ts
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

export function isSettingsInboundCommand(value: unknown): value is SettingsInboundCommand;
export function isSettingsOutboundMessage(value: unknown): value is SettingsOutboundMessage;
```

**Interfaces consumed:** the existing `settings.ts` helpers `isClosedRecord`, `isNonEmptyString`, `isNonEmptyRequestId`, `isNonNegativeInteger`, `containsOutboundCredentialValueField`, `scanWirePayload`, and the existing `SettingsErrorWire`.

- [ ] **Step 1: Write failing contract tests**

In `packages/contract/src/settings.test.ts`, pin acceptance of each new command and message at its exact form:

```ts
expect(isSettingsInboundCommand({
  kind: "getSettingsCapabilities",
  requestId: "c1",
})).toBe(true);

expect(isSettingsInboundCommand({
  kind: "runMcpOperation",
  requestId: "o1",
  operation: {
    kind: "upsertServer",
    server: {
      serverName: "docs",
      enabled: true,
      transport: "stdio",
      command: "mcp-docs",
      args: ["--stdio"],
      env: [{ name: "DOCS_ROOT", value: "/tmp/docs" }],
      cwd: "/tmp",
      auth: { kind: "none" },
      toolCallTimeoutMs: 30_000,
      reconnect: {
        enabled: true,
        initialDelayMs: 500,
        maxDelayMs: 30_000,
        maxAttempts: 5,
      },
    },
  },
})).toBe(true);

expect(isSettingsInboundCommand({
  kind: "setWebSearchConfig",
  requestId: "w1",
  catalog: {
    engine: "searxng",
    engines: [{ engine: "searxng", baseURL: "https://searx.example" }],
  },
  secrets: [{ ref: "TAVILY_API_KEY", value: "tvly-x" }],
})).toBe(true);

expect(isSettingsOutboundMessage({
  kind: "settingsCapabilities",
  sections: ["mcp", "web-search"],
})).toBe(true);

expect(isSettingsOutboundMessage({
  kind: "webSearchMutation",
  requestId: "w1",
  result: {
    ok: true,
    view: {
      section: "web-search",
      engine: "tavily",
      engines: [{
        engine: "tavily",
        defaultBaseURL: "https://api.tavily.com",
        baseURLRequired: false,
        secretRef: "TAVILY_API_KEY",
      }],
      secrets: [{ ref: "TAVILY_API_KEY", configured: true, writable: true }],
      available: true,
    },
    secretFailures: [{ ref: "BRAVE_API_KEY", message: "Could not store BRAVE_API_KEY" }],
  },
})).toBe(true);
```

Add explicit rejection cases, each as its own `expect(...).toBe(false)`:

- `settingsCapabilities` with `sections: ["mcp", "mcp"]`, with `sections: ["general"]`, with `requestId: ""`, and with an undeclared field.
- `getSettingsSection` with `section: "mcp-servers"`.
- `getMcpLogs` with `after: -1`, `after: 1.5`, and `after: "0"`.
- `runMcpOperation` with an `McpAuthWire` mixing variants (`{ kind: "none", clientId: "x" }`, `{ kind: "headers", scopes: [] }`), a `stdio` server carrying `url`, a `streamable-http` server carrying `command`, `toolCallTimeoutMs: 0`, `toolCallTimeoutMs: 1.5`, `reconnect.maxAttempts: -1`, `args` with `MAX_MCP_ARGS + 1` entries, `env` with `MAX_MCP_ENV_ENTRIES + 1` entries, `auth.headerNames` with `MAX_MCP_HEADER_NAMES + 1` entries, a `serverName` of `MAX_WIRE_IDENTIFIER_LENGTH + 1` characters, a `url` of `MAX_WIRE_URL_LENGTH + 1` characters, `setServerSecrets` with `MAX_MCP_SECRET_ENTRIES + 1` entries, a secret `value` of `MAX_SECRET_VALUE_LENGTH + 1` characters, an empty secret `value`, and an unknown operation `kind`.
- `setWebSearchConfig` with `engine: "google"`, a duplicate engine entry in `catalog.engines`, a `baseURL` over `MAX_WIRE_URL_LENGTH`, `secrets: [{ ref: "OTHER_KEY", value: "x" }]`, and `secrets: [{ ref: "TAVILY_API_KEY", value: "" }]`.
- `mcpServer` with a status variant carrying the wrong fields (`{ state: "connected", attempt: 1 }`), a tool list of `MAX_MCP_TOOLS + 1`, and `secrets: { kind: "known" }` without `secrets`.
- `mcpLogs` with `MAX_MCP_LOG_ENTRIES + 1` entries, a `message` over `MAX_MCP_LOG_MESSAGE_LENGTH`, a `detail` over `MAX_MCP_LOG_DETAIL_LENGTH`, and `level: "debug"`.
- `mcpOperation` with `result: { ok: true, error: { code: "internal", message: "x" } }` and with `result: {}`.
- Any outbound message carrying `{ ref: "TAVILY_API_KEY", value: "tvly-x" }`, `apiKey`, `secret`, `token`, or `password`, at any nesting depth, and any payload with `__proto__`, `constructor`, or `prototype` as a key.
- A cyclic outbound payload (assign `view.self = view` before validating).

In `packages/contract/src/protocol.test.ts`, assert `PROTOCOL_VERSION === 6`, that `isInboundMessage` and `isOutboundMessage` accept one instance of each new kind, and that they reject `{ kind: "mcpServer" }` without a `result`.

- [ ] **Step 2: Run contract tests and observe failure**

```bash
cd /Users/anhtra/workspace/dsh-vscode-extension
pnpm --filter @dsh-vscode/contract exec vitest run src/settings.test.ts src/protocol.test.ts
```

Expected: unknown-kind failures returning `false` where `true` is asserted, plus `PROTOCOL_VERSION` expected `6` received `5`.

- [ ] **Step 3: Extend the section, error, and invalidation vocabularies**

In `settings.ts`, extend `SettingsSectionId` with `"mcp"` and `"web-search"`, add `OptionalSettingsSectionId` and `OPTIONAL_SETTINGS_SECTION_IDS`, append `"mcp"` and `"web-search"` to `SETTINGS_SECTION_IDS`, append `"mcp-rejected"` and `"web-search-rejected"` to `SETTINGS_ERROR_CODES`, and append `"mcp"` and `"web-search"` to `INVALIDATION_REASONS`. Widen `SettingsInvalidatedMessage.reason` to the same union, replacing the inline literal list with a `SettingsInvalidationReason` exported alias so the coordinator stops repeating it.

- [ ] **Step 4: Add the new records, families, and validators**

Add every record from spec section 4 verbatim, add the five inbound and five outbound kinds to `SETTINGS_INBOUND_KINDS`, `SETTINGS_OUTBOUND_KINDS`, `SettingsInboundCommand`, `SettingsOutboundMessage`, `SettingsSectionView`, and the `isSettingsInboundCommand` / `isSettingsOutboundMessage` switches. Validate with the existing closed-record helpers plus these new local predicates:

```ts
function isBoundedString(value: unknown, max: number): value is string;
function isBoundedArray<T>(value: unknown, max: number, item: (v: unknown) => v is T): value is T[];
function isPositiveInteger(value: unknown): value is number;
function isMcpTransportWire(value: unknown): value is McpTransportWire;
function isMcpAuthWire(value: unknown): value is McpAuthWire;
function isMcpServerWire(value: unknown): value is McpServerWire;
function isMcpServerInputWire(value: unknown): value is McpServerInputWire;
function isMcpStatusWire(value: unknown): value is McpStatusWire;
function isMcpToolWire(value: unknown): value is McpToolWire;
function isMcpSecretStateWire(value: unknown): value is McpSecretStateWire;
function isMcpLogEntryWire(value: unknown): value is McpLogEntryWire;
function isMcpOperationWire(value: unknown): value is McpOperationWire;
function isWebSearchCatalogWire(value: unknown): value is WebSearchCatalogWire;
function isWebSearchSettingsView(value: unknown): value is WebSearchSettingsView;
function isMcpSettingsView(value: unknown): value is McpSettingsView;
```

Transport coupling is enforced inside `isMcpServerWire` and `isMcpServerInputWire`: `stdio` requires `command`, forbids `url`; `streamable-http` requires `url`, forbids `command`, `args`, `env`, and `cwd`. `WebSearchCatalogWire.engines` rejects duplicate `engine` values. Every new outbound validator ends with the existing `containsOutboundCredentialValueField(value)` guard, exactly as the current five do.

- [ ] **Step 5: Bump the protocol and exports**

Set `PROTOCOL_VERSION = 6` in `protocol.ts`, add the five inbound and five outbound kinds to the `InboundMessage` and `OutboundMessage` unions by delegating to the settings validators, and export every new type, constant, and union member from `packages/contract/src/index.ts`.

- [ ] **Step 6: Run contract gates**

```bash
pnpm --filter @dsh-vscode/contract run typecheck
pnpm --filter @dsh-vscode/contract run test
```

- [ ] **Step 7: Commit-ready checkpoint**

```bash
git diff --check
git diff -- packages/contract
```

Suggested message if explicitly requested: `feat(contract): add MCP and web-search protocol v6`

---

### Task 3: Optional service probes and capability lifecycle

**Files:**
- Create: `packages/bridge/src/settings/optional-services.ts`
- Create: `packages/bridge/src/settings/optional-services.test.ts`
- Create: `packages/bridge/src/settings/capabilities.ts`
- Create: `packages/bridge/src/settings/capabilities.test.ts`
- Modify: `packages/bridge/src/settings/types.ts`
- Modify: `packages/bridge/src/settings/coordinator.ts`
- Modify: `packages/bridge/src/commands.ts`
- Modify: `packages/bridge/src/runner.ts`
- Modify: `packages/bridge/test/commands.test.ts`
- Modify: `packages/bridge/test/boot-probe.test.ts`
- Modify: `packages/extension/src/webview/media/settings/types.ts`
- Modify: `packages/extension/src/webview/media/settings/reducer.ts`
- Modify: `packages/extension/src/webview/media/settings/reducer.test.ts`
- Modify: `packages/extension/src/webview/media/settings/SettingsNav.tsx`
- Modify: `packages/extension/src/webview/media/settings/localization/en.ts`
- Modify: `packages/extension/src/webview/media/settings/localization/zh.ts`
- Modify: `packages/extension/src/webview/media/App.tsx`

**Interfaces produced:**

```ts
// packages/bridge/src/settings/optional-services.ts
export interface McpServerRecordLike {
  id: string;
  serverName: string;
  enabled: boolean;
  transport: "stdio" | "streamable-http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  auth:
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

export type McpConnectionStatusLike =
  | { state: "disconnected" }
  | { state: "connecting"; attempt: number }
  | { state: "connected"; toolCount: number; connectedAt: string }
  | { state: "reconnecting"; attempt: number; nextDelayMs: number }
  | { state: "failed"; error: string; at: string };

export interface McpToolInfoLike {
  name: string;
  description?: string;
  enabled: boolean;
}

export interface McpLogEntryLike {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
}

export interface McpManagementService {
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

export interface WebSearchCatalogLike {
  engine: "tavily" | "brave" | "searxng" | null;
  engines: {
    tavily?: { baseURL?: string };
    brave?: { baseURL?: string };
    searxng?: { baseURL?: string };
  };
}

export interface WebSearchManagementService {
  getCatalog(): WebSearchCatalogLike;
  putCatalog(catalog: WebSearchCatalogLike): Promise<WebSearchCatalogLike>;
  describeSecrets(): Promise<Record<string, { configured: boolean }>>;
  putSecrets(partial: Record<string, string>): Promise<void>;
  available(): boolean;
  onChanged?(listener: () => void): () => void;
}

export const MCP_SERVICE_NAME = "mcp" as const;
export const WEB_SEARCH_SERVICE_NAME = "webSearchManager" as const;

export const MCP_REQUIRED_MEMBERS: readonly string[] = [
  "list", "get", "upsert", "remove", "setEnabled", "connect", "disconnect",
  "getStatus", "getLogs", "getTools", "setToolEnabled", "clearOAuth", "setSecrets",
];
export const WEB_SEARCH_REQUIRED_MEMBERS: readonly string[] = [
  "getCatalog", "putCatalog", "describeSecrets", "putSecrets", "available",
];

export type OptionalServiceProbe<T> =
  | { state: "absent" }
  | { state: "incomplete"; missing: string[] }
  | { state: "ready"; service: T };

export function probeMcpService(ctx: Context): OptionalServiceProbe<McpManagementService>;
export function probeWebSearchService(ctx: Context): OptionalServiceProbe<WebSearchManagementService>;
```

```ts
// packages/bridge/src/settings/capabilities.ts
export interface OptionalCapabilityWatcher {
  /** Optional sections whose service passes the probe now, in nav order. */
  sections(): OptionalSettingsSectionId[];
  /** Runs the callback whenever the mounted set changes. */
  onChange(listener: (sections: OptionalSettingsSectionId[]) => void): () => void;
  dispose(): void;
}

export function createCapabilityWatcher(
  ctx: Context,
  warn: (message: string) => void = (message) => console.warn(message),
): OptionalCapabilityWatcher;
```

**Interfaces consumed:** `Context.get(name: string, strict?: boolean)`, `ctx.on("internal/service", listener, { global: true })`, `OptionalSettingsSectionId`, `OPTIONAL_SETTINGS_SECTION_IDS`, `SettingsCapabilitiesMessage`, `GetSettingsCapabilitiesCommand`.

- [ ] **Step 1: Write failing probe and watcher tests**

`packages/bridge/src/settings/optional-services.test.ts`:

```ts
import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import {
  MCP_REQUIRED_MEMBERS,
  probeMcpService,
  probeWebSearchService,
} from "./optional-services.js";

function completeMcp(): Record<string, unknown> {
  return Object.fromEntries(MCP_REQUIRED_MEMBERS.map((member) => [member, () => {}]));
}

describe("optional service probes", () => {
  it("reports absent when nothing is mounted", () => {
    const ctx = new Context();
    expect(probeMcpService(ctx)).toEqual({ state: "absent" });
    expect(probeWebSearchService(ctx)).toEqual({ state: "absent" });
  });

  it("reports the missing members of an incomplete service", () => {
    const ctx = new Context();
    const partial = completeMcp();
    delete partial.getTools;
    delete partial.setSecrets;
    ctx.provide("mcp", partial as never);
    expect(probeMcpService(ctx)).toEqual({
      state: "incomplete",
      missing: ["getTools", "setSecrets"],
    });
  });

  it("accepts a complete service and ignores absent optional members", () => {
    const ctx = new Context();
    const service = completeMcp();
    ctx.provide("mcp", service as never);
    const probe = probeMcpService(ctx);
    expect(probe.state).toBe("ready");
    expect(probe.state === "ready" && probe.service.describeSecrets).toBeUndefined();
  });
});
```

`packages/bridge/src/settings/capabilities.test.ts` asserts: an empty list with nothing mounted; `["web-search"]` after providing only a complete web-search service; `["mcp", "web-search"]` in that fixed order with both mounted; one `onChange` callback per transition when a service is provided and when its disposer runs; exactly one `warn` call for an incomplete service across repeated probes of the same registration, and a second `warn` after that service is removed and re-provided; and no listener invocation after `dispose()`.

`packages/bridge/test/boot-probe.test.ts` gains a case mounting fake `mcp` and `webSearchManager` services on the real booted tree and asserting `createCapabilityWatcher(ctx).sections()` equals `["mcp", "web-search"]`, plus a case with neither mounted asserting `[]` while `ctx.get("settings")`, `ctx.get("credentials")`, `ctx.get("agentPresets")`, and `ctx.get("pluginInventory")` stay defined.

`packages/bridge/test/commands.test.ts` gains a case asserting `dispatchCommand` routes `{ kind: "getSettingsCapabilities", requestId: "c1" }` to `runner.getCapabilities("c1")`.

`packages/extension/src/webview/media/settings/reducer.test.ts` gains cases asserting: `initialSettingsState.capabilities` is `[]` and `capabilitiesKnown` is `false`; `settingsCapabilitiesReceived` with `["mcp"]` sets `capabilities` and `capabilitiesKnown`; a capability update that drops the active section moves `activeSection` to `"general"` and resets that section's cached state to `{ status: "idle", stale: false, available: false }`; `settingsDisconnected` leaves `capabilities` intact but marks both optional sections unavailable.

- [ ] **Step 2: Run the failing suites**

```bash
pnpm --filter @dsh-vscode/bridge exec vitest run src/settings/optional-services.test.ts src/settings/capabilities.test.ts test/commands.test.ts test/boot-probe.test.ts
pnpm --filter dsh exec vitest run src/webview/media/settings/reducer.test.ts
```

Expected: module-not-found for the two new bridge modules, `runner.getCapabilities is not a function`, and `undefined` capabilities in the reducer.

- [ ] **Step 3: Implement the probes**

`probeMcpService` and `probeWebSearchService` read `ctx.get(MCP_SERVICE_NAME)` / `ctx.get(WEB_SEARCH_SERVICE_NAME)` through the untyped accessor, return `{ state: "absent" }` for `undefined`, collect `missing` as the required members whose `typeof` is not `"function"` in declaration order, and otherwise return `{ state: "ready", service }` with a single documented `as` cast explaining that the value crosses an untyped optional-plugin line and every required member was just verified.

- [ ] **Step 4: Implement the capability watcher**

`createCapabilityWatcher` computes the section list from both probes in `OPTIONAL_SETTINGS_SECTION_IDS` order, subscribes with `ctx.on("internal/service", handler, { global: true })`, and recomputes when the event names `mcp` or `webSearchManager`. It notifies listeners only when the computed list differs from the previous one, tracks a `Map<string, number>` of warned registration generations so an incomplete service warns exactly once per registration (incrementing the generation when that service disappears), and `dispose()` removes the `internal/service` listener and clears listeners.

- [ ] **Step 5: Wire capabilities through the coordinator, dispatcher, and runner**

Add to `SettingsCoordinator`:

```ts
  getCapabilities(requestId: string): void;
  capabilities(): OptionalSettingsSectionId[];
```

`createSettingsCoordinator` constructs the watcher, answers `getCapabilities` with `{ kind: "settingsCapabilities", requestId, sections }`, pushes `{ kind: "settingsCapabilities", sections }` without a `requestId` on every watcher change, and disposes the watcher in `dispose()`. Add `case "getSettingsCapabilities": hooks.runner.getCapabilities(msg.requestId); return;` to `dispatchCommand`, expose `getCapabilities` on `SessionController` in `runner.ts` alongside the existing settings methods, and send one unsolicited capability message when the runner reports ready.

- [ ] **Step 6: Extend webview state and navigation**

In `settings/types.ts`, add `capabilities: OptionalSettingsSectionId[]` and `capabilitiesKnown: boolean` to `SettingsState`, extend `sections` to the six ids, and add `{ kind: "settingsCapabilitiesReceived"; message: SettingsCapabilitiesMessage }` to `SettingsAction`. In `reducer.ts`, add `"mcp"` and `"web-search"` to `SECTION_IDS` and `initialSettingsState.sections`, handle the new action, and move activation to `"general"` when the active section leaves the capability set, clearing that section's cached view. In `SettingsNav.tsx`, insert `{ id: "mcp", label: "mcp" }` and `{ id: "web-search", label: "webSearch" }` between `plugins` and `agent-presets`, filter optional rows through a new `capabilities: readonly OptionalSettingsSectionId[]` prop, and give each a nav icon glyph (`"⇄"` for MCP, `"⌕"` for Web Search). Add `mcp` and `webSearch` keys to `localization/en.ts` and `localization/zh.ts`. In `App.tsx`, post `{ kind: "getSettingsCapabilities", requestId }` on bridge ready and on reconnect beside the existing background General load, handle inbound `settingsCapabilities` by dispatching the new action, and pass `settingsState.capabilities` to `SettingsNav`.

- [ ] **Step 7: Run the gates**

```bash
pnpm --filter @dsh-vscode/bridge run typecheck
pnpm --filter @dsh-vscode/bridge run test
pnpm --filter dsh run typecheck
pnpm --filter dsh exec vitest run src/webview/media/settings/reducer.test.ts src/webview/media/settings/SettingsModal.test.tsx
```

- [ ] **Step 8: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(bridge): probe optional plugin services and announce capabilities`

---

### Task 4: Web Search bridge adapter and core card suppression

**Files:**
- Create: `packages/bridge/src/settings/web-search.ts`
- Create: `packages/bridge/src/settings/web-search.test.ts`
- Modify: `packages/bridge/src/settings/project.ts`
- Modify: `packages/bridge/src/settings/project.test.ts`
- Modify: `packages/bridge/src/settings/coordinator.ts`
- Modify: `packages/bridge/src/settings/types.ts`
- Modify: `packages/bridge/src/settings/coordinator.test.ts`
- Modify: `packages/bridge/src/settings/plugins.ts`
- Modify: `packages/bridge/src/settings/plugins.test.ts`
- Modify: `packages/bridge/src/commands.ts`
- Modify: `packages/bridge/src/runner.ts`
- Modify: `packages/bridge/test/commands.test.ts`

**Interfaces produced:**

```ts
// packages/bridge/src/settings/web-search.ts
/** Aggregate node ceiling for one emitted Web Search view. */
export const MAX_WEB_SEARCH_VIEW_NODES = 256;
/** Projection depth ceiling for the Web Search view. */
export const MAX_WEB_SEARCH_VIEW_DEPTH = 16;

export async function buildWebSearchView(ctx: Context): Promise<WebSearchSettingsView>;

export interface WebSearchSaveOutcome {
  view: WebSearchSettingsView;
  secretFailures: { ref: WebSearchSecretRefWire; message: string }[];
}

export async function applyWebSearchConfig(
  ctx: Context,
  catalog: WebSearchCatalogWire,
  secrets: readonly { ref: WebSearchSecretRefWire; value: string }[],
): Promise<WebSearchSaveOutcome>;

export function catalogFromWire(catalog: WebSearchCatalogWire): WebSearchCatalogLike;
export function catalogToWire(catalog: WebSearchCatalogLike): WebSearchCatalogWire;
```

```ts
// packages/bridge/src/settings/project.ts — one home for both adapters
/** Characters retained from a plugin validation message before it leaves the bridge. */
export const MAX_PLUGIN_MESSAGE_LENGTH = 512;

/** @returns the message truncated to {@link MAX_PLUGIN_MESSAGE_LENGTH} characters. */
export function truncatePluginMessage(message: string): string;
```

**Interfaces consumed:** `probeWebSearchService`, `WebSearchManagementService`, `WebSearchSettingsView`, `WebSearchCatalogWire`, `SetWebSearchConfigCommand`, `WebSearchMutationMessage`, `SettingsErrorWire`.

- [ ] **Step 1: Write failing adapter, coordinator, and suppression tests**

`web-search.test.ts` against fake services:

- `buildWebSearchView` projects all three engines in `["tavily", "brave", "searxng"]` order, each with `defaultBaseURL` for Tavily and Brave and none for SearXNG, `baseURLRequired: true` only for SearXNG, `secretRef` for Tavily and Brave only, both secrets with `writable: true`, `engine` and per-engine `baseURL` from `getCatalog()`, and `available` from `available()`.
- A `baseURL` equal to the engine's published default is projected as an absent override.
- `buildWebSearchView` throws when the service is absent so the coordinator can answer `settings-unavailable`.
- `applyWebSearchConfig` calls `putCatalog` then `putSecrets` then a fresh `getCatalog`/`describeSecrets`/`available`, asserted by a recorded call order array.
- A rejecting `putCatalog` throws before `putSecrets` is called, and the thrown error carries the plugin message truncated by `truncatePluginMessage`; a `project.test.ts` case asserts that helper keeps a 512-character message intact and cuts a 513-character one to 512.
- A `putSecrets` that rejects yields `secretFailures` with one entry per submitted ref, each `message` generic and containing neither the submitted value nor the plugin error text, and the returned `view` still reflects the committed catalog.
- Empty secret values are dropped before `putSecrets`, and an empty `secrets` array skips `putSecrets` entirely.
- `catalogFromWire` and `catalogToWire` round-trip a catalog with all three overrides and with none.
- A maximal view (all three overrides at `MAX_WIRE_URL_LENGTH`, both secrets configured) passes `isOutboundMessage` inside a `settingsSection` message.

`coordinator.test.ts` gains: `getSection("web-search")` answers a view with a mounted service and `settings-unavailable` with none; `setWebSearchConfig` answers `webSearchMutation` under request key `web-search-save` with latest-request-wins; a rejected catalog answers `{ ok: false, error: { code: "web-search-rejected" } }`; an `onChanged` notification emits `settingsInvalidated { sections: ["web-search"], reason: "web-search" }`; that invalidation is deferred while a save is in flight and delivered after it settles; and `dispose()` removes the `onChanged` listener and suppresses a late reply.

`plugins.test.ts` gains: with a complete `webSearchManager` mounted, `buildPluginsView` omits the `web-search-deepseek` entry from both `configurable` and `namespaces` while keeping `shell` and `agent-loop`; with the service absent, the card and namespace are projected exactly as the existing test asserts; with an incomplete service mounted, the card is preserved because suppression follows the probe.

`test/commands.test.ts` gains a case routing `setWebSearchConfig` to `runner.setWebSearchConfig(msg)`.

- [ ] **Step 2: Run the failing suites**

```bash
pnpm --filter @dsh-vscode/bridge exec vitest run src/settings/web-search.test.ts src/settings/coordinator.test.ts src/settings/plugins.test.ts test/commands.test.ts
```

Expected: module-not-found for `web-search.js`, `coordinator.getSection` throwing on an unknown section, and the suppression assertions failing.

- [ ] **Step 3: Implement the adapter**

`buildWebSearchView` probes the service, throws `new Error("web-search management service is not available")` when the probe is not `ready`, reads `getCatalog()`, `describeSecrets()`, and `available()`, projects the fixed engine table with `defaultBaseURL` constants declared locally as `WEB_SEARCH_DEFAULT_BASE_URLS`, and calls this local guard before returning:

```ts
function assertBounded(value: unknown, maxNodes: number, label: string): void {
  let nodes = 0;
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > maxNodes || depth > MAX_WEB_SEARCH_VIEW_DEPTH) {
      throw new RangeError(`${label} exceeds bridge projection limits`);
    }
    if (typeof candidate !== "object" || candidate === null) return;
    if (seen.has(candidate)) throw new RangeError(`${label} contains a cycle`);
    seen.add(candidate);
    for (const child of Array.isArray(candidate) ? candidate : Object.values(candidate)) {
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
}
```

`applyWebSearchConfig` awaits `putCatalog(catalogFromWire(catalog))`, mapping a rejection to an error whose message is `truncatePluginMessage(pluginText)` from `project.ts`; then, for each non-empty submitted secret, calls `putSecrets` once with the whole record and, on rejection, retries each ref individually so a single bad key does not mask the others, recording `{ ref, message: \`Could not store ${ref}\` }` per failing ref with no plugin text; then rebuilds the view.

- [ ] **Step 4: Wire the coordinator and dispatcher**

Add `setWebSearchConfig(message: SetWebSearchConfigCommand): void` to `SettingsCoordinator`, implement it under request key `web-search-save` with `beginSectionMutation("web-search")` / `finishSectionMutation("web-search")` around the operation so the deferred-invalidation rule applies, extend `getSection` with the `"web-search"` branch and its `requiredServiceMissing` check, subscribe to `onChanged` when the probe is ready and the member exists, and re-subscribe from the capability watcher's change callback so a late-mounted service starts notifying. Add the dispatcher case and the `SessionController` method.

- [ ] **Step 5: Implement core card suppression**

In `plugins.ts`, filter `CARDS` and the namespace projection by `probeWebSearchService(ctx).state !== "ready"` for the `web-search-deepseek` entry, documenting that suppression derives from the probe so the card cannot drift from the nav row.

- [ ] **Step 6: Run the gates**

```bash
pnpm --filter @dsh-vscode/bridge run typecheck
pnpm --filter @dsh-vscode/bridge run test
```

- [ ] **Step 7: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(bridge): adapt the web-search management service`

---

### Task 5: Web Search webview controller, UI, and localization

**Files:**
- Create: `packages/extension/src/webview/media/settings/sections/web-search/WebSearchController.ts`
- Create: `packages/extension/src/webview/media/settings/sections/web-search/WebSearchController.test.ts`
- Create: `packages/extension/src/webview/media/settings/sections/web-search/WebSearchSection.tsx`
- Create: `packages/extension/src/webview/media/settings/sections/web-search/WebSearchSection.test.tsx`
- Modify: `packages/extension/src/webview/media/settings/localization/en.ts`
- Modify: `packages/extension/src/webview/media/settings/localization/zh.ts`
- Modify: `packages/extension/src/webview/media/settings/localization/models.test.ts`
- Modify: `packages/extension/src/webview/media/App.tsx`
- Modify: `packages/extension/src/webview/media/style.css`

**Interfaces produced:**

```ts
export interface WebSearchEngineDraft {
  engine: WebSearchEngineWire;
  baseURL: string;
  baseURLError?: SettingsCopyKey;
}

export interface WebSearchSnapshot {
  status: "idle" | "saving";
  dirty: boolean;
  engine: WebSearchEngineWire | null;
  engines: WebSearchEngineDraft[];
  secrets: { ref: WebSearchSecretRefWire; configured: boolean; staged: boolean }[];
  available: boolean;
  canSave: boolean;
  errorKey?: SettingsCopyKey;
  errorDetail?: string;
  secretFailures: WebSearchSecretRefWire[];
  connected: boolean;
}

export class WebSearchController {
  constructor(
    send: (command: SettingsInboundCommand) => void,
    refresh: () => void,
    requestId?: () => string,
  );
  subscribe: (listener: () => void) => () => void;
  updateView(view: WebSearchSettingsView): void;
  disconnect(): void;
  snapshot(): WebSearchSnapshot;
  selectEngine(engine: WebSearchEngineWire): void;
  setBaseURL(engine: WebSearchEngineWire, text: string): void;
  stageSecret(ref: WebSearchSecretRefWire, value: string): void;
  clearStagedSecret(ref: WebSearchSecretRefWire): void;
  save(): boolean;
  retrySecrets(): boolean;
  discardAll(): void;
  receive(message: WebSearchMutationMessage): boolean;
}
```

**Interfaces consumed:** `WebSearchSettingsView`, `WebSearchMutationMessage`, `SetWebSearchConfigCommand`, `settingsText`, `SettingsCopyKey`.

- [ ] **Step 1: Write failing controller and component tests**

`WebSearchController.test.ts` asserts:

- `updateView` seeds `engine`, per-engine `baseURL` drafts (empty when the view has no override), `secrets[].configured`, and `available`, with `dirty: false`.
- `selectEngine` and `setBaseURL` set `dirty: true`; `discardAll` restores the last view and clears staged secrets.
- `canSave` is `false` when SearXNG is selected with an empty base URL, `false` for a non-empty base URL that is not an absolute `http`/`https` URL (`"searx.example"`, `"ftp://searx.example"`), and `true` for a valid one.
- `save()` posts one `setWebSearchConfig` whose `catalog.engines` omits an override equal to the engine's published default, whose `secrets` carries only non-empty staged values, and returns `false` while a save is in flight.
- `receive` with `{ ok: true, secretFailures: [] }` clears both staged secrets, sets `dirty: false`, and rebases drafts on the returned view.
- `receive` with `{ ok: true, secretFailures: [{ ref: "BRAVE_API_KEY", ... }] }` keeps that staged value, keeps `dirty: true`, rebases non-secret drafts on the returned view, and reports `secretFailures: ["BRAVE_API_KEY"]`; `retrySecrets()` then posts a `setWebSearchConfig` carrying the current catalog and only the failed ref.
- `receive` with `{ ok: false, error }` preserves the whole draft including staged secrets and sets `errorKey`/`errorDetail`.
- `disconnect()` clears staged secrets, sets `connected: false`, and settles a pending save as an error.
- `JSON.stringify(controller.snapshot())` contains neither staged secret literal in any of the states above.

`WebSearchSection.test.tsx` asserts, with Testing Library, in both `"en"` and `"zh"`: the engine radio group has an accessible group name and one radio per engine; selecting SearXNG reveals a required base URL field and disables Save until it is filled; the two key inputs have `type="password"`, are empty after a successful save, and carry the "cannot be read back" hint; the availability line states usable or names the missing piece; a `secretFailures` state renders a `role="alert"` naming only the ref; Save and Discard are disabled while `status === "saving"`; and the non-selected engines' base URL rows live in a collapsed group.

`localization/models.test.ts` gains an assertion that every new key exists in both dictionaries with identical key sets.

- [ ] **Step 2: Run the failing suites**

```bash
pnpm --filter dsh exec vitest run src/webview/media/settings/sections/web-search
```

Expected: module-not-found for both new files.

- [ ] **Step 3: Implement the controller**

Mirror `PluginsController`'s shape: private `view`, `connected`, `secretEpoch`, `listeners`, a `pending?: { requestId: string; refs: WebSearchSecretRefWire[] }`, and `notify()`. Staged secret values live in a private `Map<WebSearchSecretRefWire, string>` that `snapshot()` projects only as `staged: boolean`. Validation runs in a pure `validateDraft` helper returning `SettingsCopyKey | undefined` per engine so the component renders copy keys rather than sentences.

- [ ] **Step 4: Implement the section component and styles**

`WebSearchSection.tsx` takes `{ controller, locale, state }` like `PluginsSection.tsx`, renders the radio group, the selected engine's base URL and key rows, a `<details>` group for the other engines, the availability line, and the Save/Discard action row. Add the new localization keys to `en.ts` and `zh.ts` (nav label, engine names, base URL labels and hints, key labels, the replace-not-remove note, the read-back hint, validation messages, availability copy, save/discard, and the generic secret failure sentence). Add the section's class names to `style.css`, reusing existing settings tokens and adding no new color literals.

- [ ] **Step 5: Wire the section into the modal**

In `App.tsx`, add a `webSearchControllerRef` with its `useReducer` re-render pair, construct it with the existing `post`/`refresh` closures, route inbound `webSearchMutation` to `webSearchController.receive`, include its `snapshot().dirty` in the aggregate dirty check and its `discardAll()` in the discard-all path, call `disconnect()` alongside the other controllers, and render `WebSearchSection` when `activeSection === "web-search"`.

- [ ] **Step 6: Run the gates**

```bash
pnpm --filter dsh run typecheck
pnpm --filter dsh exec vitest run src/webview/media/settings
```

- [ ] **Step 7: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(webview): add the Web Search settings section`

---

### Task 6: MCP bridge read path and projection

**Files:**
- Create: `packages/bridge/src/settings/mcp.ts`
- Create: `packages/bridge/src/settings/mcp.test.ts`
- Modify: `packages/bridge/src/settings/coordinator.ts`
- Modify: `packages/bridge/src/settings/types.ts`
- Modify: `packages/bridge/src/settings/coordinator.test.ts`
- Modify: `packages/bridge/src/commands.ts`
- Modify: `packages/bridge/src/runner.ts`
- Modify: `packages/bridge/test/commands.test.ts`

**Interfaces produced:**

```ts
// packages/bridge/src/settings/mcp.ts
/**
 * Aggregate node ceiling for one emitted MCP list view. Sixty-four maximal
 * `McpServerListItemWire` records cost 36,871 scan nodes, so this ceiling sits
 * above the documented per-collection caps and below the contract scan budget.
 */
export const MAX_MCP_LIST_VIEW_NODES = 40_960;
/** Aggregate node ceiling for one emitted MCP server detail. */
export const MAX_MCP_DETAIL_NODES = 8_192;
/** Aggregate node ceiling for one emitted MCP logs message. */
export const MAX_MCP_LOGS_MESSAGE_NODES = 16_384;
/** Projection depth ceiling for every MCP projection. */
export const MAX_MCP_VIEW_DEPTH = 16;

export async function buildMcpView(ctx: Context): Promise<McpSettingsView>;
export async function buildMcpDetail(ctx: Context, serverId: string): Promise<McpServerDetailWire>;
export function readMcpLogs(
  ctx: Context,
  serverId: string,
  after?: number,
): { serverId: string; next: number; entries: McpLogEntryWire[] };
export function projectMcpServer(record: McpServerRecordLike): McpServerWire;
export function projectMcpStatus(status: McpConnectionStatusLike): McpStatusWire;
export function secretNamesFor(record: McpServerRecordLike): string[];
```

**Interfaces consumed:** `probeMcpService`, `McpManagementService`, and the contract's MCP wire records.

- [ ] **Step 1: Write failing projection tests**

`mcp.test.ts` against a fake `McpManagementService`:

- `buildMcpView` projects one `McpServerListItemWire` per `list()` record, with `status` from `getStatus(id)`, `toolCount` as `getTools(id).length`, and `disabledToolCount` as the record's `disabledTools` length (`0` when absent).
- `env` is projected from the runtime's `Record<string, string>` into a `{ name, value }[]` in insertion order, and an absent `env` stays absent.
- Every `McpStatusWire` variant round-trips from its `McpConnectionStatusLike` counterpart, including `failed` carrying the plugin's error text verbatim.
- `secretStates` is `"available"` when `describeSecrets` exists and `"unavailable"` when it does not; `oauth` is always `{ kind: "manual", reason: "no-callback-origin" }`.
- `buildMcpDetail` returns tools with `enabled` from `getTools`, `description` defaulted to `""` when the runtime omits it, and `secrets` as `{ kind: "known", secrets: [...] }` from `describeSecrets`, listing the record's `headerNames` for `headers` auth and `OAUTH_ACCESS`, `OAUTH_REFRESH`, `OAUTH_EXPIRES_AT`, `OAUTH_CLIENT_SECRET` for `oauth` auth.
- `buildMcpDetail` returns `{ kind: "unknown" }` when `describeSecrets` is absent and when it rejects.
- `buildMcpDetail` and `readMcpLogs` throw for an unknown server id.
- `readMcpLogs` forwards `after` unchanged, returns the runtime's `next`, and truncates nothing: a `getLogs` returning `MAX_MCP_LOG_ENTRIES + 1` entries throws a bound error instead.
- `list()` returning `MAX_MCP_SERVERS + 1` records throws a bound error; exactly `MAX_MCP_SERVERS` maximal records produce a view accepted by `isOutboundMessage` inside a `settingsSection` message.
- Each projection function throws when the service probe is not `ready`.

`coordinator.test.ts` gains: `getSection("mcp")` under key `section:mcp`; `getMcpServer` under `mcp-detail:<serverId>` with latest-request-wins per server and independent servers proceeding in parallel; `getMcpLogs` under `mcp-logs:<serverId>`; `settings-unavailable` for every one of them with no service mounted; an `onCatalogChanged` notification emitting `settingsInvalidated { sections: ["mcp"], reason: "mcp" }`; and `dispose()` removing that listener.

`test/commands.test.ts` gains cases routing `getMcpServer` to `runner.getMcpServer(msg)` and `getMcpLogs` to `runner.getMcpLogs(msg)`.

- [ ] **Step 2: Run the failing suites**

```bash
pnpm --filter @dsh-vscode/bridge exec vitest run src/settings/mcp.test.ts src/settings/coordinator.test.ts test/commands.test.ts
```

Expected: module-not-found for `mcp.js` and missing runner methods.

- [ ] **Step 3: Implement the projections**

Implement the six exported functions with a shared local `requireMcp(ctx)` that probes and throws `new Error("MCP management service is not available")` when not ready, plus a local `assertBounded(value, maxNodes, label)` byte-identical to the guard added to `web-search.ts` in Task 4 except that its depth ceiling is `MAX_MCP_VIEW_DEPTH`. Call it with `MAX_MCP_LIST_VIEW_NODES` for the list view, `MAX_MCP_DETAIL_NODES` for a detail, and `MAX_MCP_LOGS_MESSAGE_NODES` for a logs payload. Collection caps are checked before projection and throw `new RangeError` naming the exceeded cap and its value. Switch on the status and auth discriminants with `assertNever` on the closed unions.

- [ ] **Step 4: Wire the coordinator and dispatcher**

Add to `SettingsCoordinator`:

```ts
  getMcpServer(message: GetMcpServerCommand): void;
  getMcpLogs(message: GetMcpLogsCommand): void;
```

Implement each under its documented request key, answering `mcpServer` / `mcpLogs` with `{ ok: false, error: { code: "mcp-rejected", message } }` for a projection failure and `settings-unavailable` when the service is absent. Extend `getSection` with the `"mcp"` branch, subscribe to `onCatalogChanged` when present, re-subscribe from the capability watcher change callback, and add the dispatcher cases plus the `SessionController` methods.

- [ ] **Step 5: Run the gates**

```bash
pnpm --filter @dsh-vscode/bridge run typecheck
pnpm --filter @dsh-vscode/bridge run test
```

- [ ] **Step 6: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(bridge): project MCP servers, details, and logs`

---

### Task 7: MCP mutations, secret authorization, and operation results

**Files:**
- Modify: `packages/bridge/src/settings/mcp.ts`
- Modify: `packages/bridge/src/settings/mcp.test.ts`
- Modify: `packages/bridge/src/settings/coordinator.ts`
- Modify: `packages/bridge/src/settings/types.ts`
- Modify: `packages/bridge/src/settings/coordinator.test.ts`
- Modify: `packages/bridge/src/commands.ts`
- Modify: `packages/bridge/src/runner.ts`
- Modify: `packages/bridge/test/commands.test.ts`

**Interfaces produced:**

```ts
export interface McpOperationOutcome {
  /** Absent only for a completed `removeServer`. */
  detail?: McpServerDetailWire;
}

export async function runMcpOperation(
  ctx: Context,
  operation: McpOperationWire,
  ids?: { newId: () => string; now: () => string },
): Promise<McpOperationOutcome>;

/** Names the target record authorizes for `setServerSecrets`. */
export function writableSecretNamesFor(record: McpServerRecordLike): string[];
```

- [ ] **Step 1: Write failing mutation tests**

Extend `mcp.test.ts` with a recorded-call fake:

- Each operation maps to exactly one runtime call: `upsertServer` → `upsert`, `removeServer` → `remove`, `setServerEnabled` → `setEnabled`, `connectServer` → `connect`, `disconnectServer` → `disconnect`, `setToolEnabled` → `setToolEnabled`, `setServerSecrets` → `setSecrets`, `clearOAuthTokens` → `clearOAuth`.
- A create (`serverId` absent) generates the id from the injected `newId`, sets `createdAt` and `updatedAt` from the injected `now`, and rejects when the generated id collides with an existing record.
- An edit preserves the stored `createdAt`, sets a new `updatedAt`, preserves the stored `disabledTools`, and rejects an unknown `serverId`.
- A `stdio` input omits `url` from the composed record and a `streamable-http` input omits `command`, `args`, `env`, and `cwd`.
- `setToolEnabled` for a name absent from `getTools(id)` rejects without calling the runtime.
- `setServerSecrets` accepts only the record's `headerNames` for `headers` auth and only `OAUTH_CLIENT_SECRET` for `oauth` auth; `OAUTH_ACCESS`, `OAUTH_REFRESH`, `OAUTH_EXPIRES_AT`, an undeclared header name, and any name under `auth: { kind: "none" }` reject without calling the runtime.
- A rejecting `setSecrets` produces an error whose message names only the server id and the secret names and contains neither the submitted value nor the plugin error text.
- A rejecting `upsert` produces an error carrying the plugin message passed through `truncatePluginMessage` from `packages/bridge/src/settings/project.ts`.
- Every operation except `removeServer` returns a fresh `detail`; `removeServer` returns `{}`.

Extend `coordinator.test.ts` with: `runMcpOperation` answering `mcpOperation` under key `mcp-op:<serverId>` (a create uses `mcp-op:new`); latest-request-wins per key with two servers proceeding in parallel; `settings-unavailable` with no service; a secret failure answering `{ ok: false, error: { code: "mcp-rejected", message } }` whose message contains no plugin text; an MCP invalidation raised during an in-flight operation deferred until it settles; and suppression of a reply after `dispose()`.

Extend `test/commands.test.ts` with a case routing `runMcpOperation` to `runner.runMcpOperation(msg)`.

- [ ] **Step 2: Run the failing suites**

```bash
pnpm --filter @dsh-vscode/bridge exec vitest run src/settings/mcp.test.ts src/settings/coordinator.test.ts test/commands.test.ts
```

Expected: `runMcpOperation is not a function` and missing coordinator/runner methods.

- [ ] **Step 3: Implement the operations**

`runMcpOperation` switches on the operation discriminant with `assertNever`, composes records through a local `composeRecord(existing, input, ids)`, authorizes secret names through `writableSecretNamesFor`, wraps `setSecrets` failures in an extension-owned generic message, and returns `{ detail }` from `buildMcpDetail` for every operation but `removeServer`. Default `ids` to `{ newId: () => crypto.randomUUID(), now: () => new Date().toISOString() }`.

- [ ] **Step 4: Wire the coordinator and dispatcher**

Add `runMcpOperation(message: RunMcpOperationCommand): void` to `SettingsCoordinator`, key it by target server (`mcp-op:new` for a create), wrap it in `beginSectionMutation("mcp")` / `finishSectionMutation("mcp")`, and add the dispatcher case plus the `SessionController` method.

- [ ] **Step 5: Run the gates**

```bash
pnpm --filter @dsh-vscode/bridge run typecheck
pnpm --filter @dsh-vscode/bridge run test
pnpm --filter @dsh-vscode/bridge run build
```

- [ ] **Step 6: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(bridge): run authorized MCP operations`

---

### Task 8: MCP webview controller

**Files:**
- Create: `packages/extension/src/webview/media/settings/sections/mcp/McpController.ts`
- Create: `packages/extension/src/webview/media/settings/sections/mcp/McpController.test.ts`

**Interfaces produced:**

```ts
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
  selectedServerId?: string;
  detail?: McpServerDetailWire;
  logs: McpLogEntryWire[];
  logCursor?: number;
  editor?: McpEditorDraft;
  pending: string[];
  confirmation?: { kind: "delete" | "clear-oauth"; serverId: string };
  secretEpoch: number;
  dirty: boolean;
  connected: boolean;
  noticeKey?: SettingsCopyKey;
}

export class McpController {
  constructor(
    send: (command: SettingsInboundCommand) => void,
    refresh: () => void,
    requestId?: () => string,
  );
  subscribe: (listener: () => void) => () => void;
  updateView(view: McpSettingsView): void;
  disconnect(): void;
  snapshot(): McpSnapshot;
  select(serverId: string | undefined): void;
  poll(): void;
  openCreate(): void;
  openEdit(serverId: string): void;
  closeEditor(): void;
  setEditorField(field: keyof McpEditorDraft, value: unknown): void;
  stageSecret(name: string, value: string): void;
  saveEditor(): boolean;
  retrySecrets(): boolean;
  setEnabled(serverId: string, enabled: boolean): boolean;
  connectServer(serverId: string): boolean;
  disconnectServer(serverId: string): boolean;
  toggleTool(serverId: string, toolName: string, enabled: boolean): boolean;
  confirm(kind: "delete" | "clear-oauth", serverId: string): void;
  cancelConfirmation(): void;
  runConfirmed(): boolean;
  discardAll(): void;
  receiveDetail(message: McpServerMessage): boolean;
  receiveLogs(message: McpLogsMessage): boolean;
  receiveOperation(message: McpOperationMessage): boolean;
}
```

- [ ] **Step 1: Write failing controller tests**

`McpController.test.ts` asserts:

- `updateView` seeds `servers` and `secretStates`; a selected server that disappears clears `selectedServerId`, `detail`, and `logs`, closes its editor, and sets `noticeKey` to the "server removed" key.
- `select` posts `getMcpServer` and, on the first `poll()` after selection, a `getMcpLogs` without `after`; each later tick posts `getMcpLogs` with the previous `next`; `receiveLogs` replaces the buffer for a cursor-free request and appends otherwise.
- `poll()` is single-flight per key: with a list request, a detail request, and a logs request unanswered, a second `poll()` posts nothing; after each answer, the next tick posts again.
- `select(undefined)` and selecting a different server reset `logCursor` and `logs`.
- `saveEditor()` posts one `runMcpOperation` with `{ kind: "upsertServer" }`, omits `url` for `stdio` and `command`/`args`/`env`/`cwd` for `streamable-http`, and never includes a staged secret value.
- A `receiveOperation` success with staged secrets posts `{ kind: "setServerSecrets" }` as the second stage; a record failure sets `editor.errorDetail` and posts no secret stage; a secret failure keeps the editor open, sets `editor.secretFailure`, retains the staged values, and `retrySecrets()` posts only `setServerSecrets`.
- A successful secret write advances `secretEpoch` and clears staged values; `disconnect()` advances `secretEpoch`, clears staged values, sets `connected: false`, and settles every pending operation as an error.
- `pending` holds at most one entry per server id; a second action on the same server returns `false` while another server's action returns `true`.
- `toggleTool` failure restores the tool's server-reported `enabled` state.
- `confirm`/`cancelConfirmation`/`runConfirmed` drive delete and clear-OAuth, and a pending operation whose server vanished settles as an error rather than hanging.
- `JSON.stringify(controller.snapshot())` contains no staged secret literal in any state above, including after a failed secret write.

- [ ] **Step 2: Run the failing suite**

```bash
pnpm --filter dsh exec vitest run src/webview/media/settings/sections/mcp/McpController.test.ts
```

Expected: module-not-found for `McpController.js`.

- [ ] **Step 3: Implement the controller**

Follow `ModelsController`'s structure: private `view`, `connected`, `secretEpoch`, `listeners`, `notify()`, a `Map<string, PendingOperation>` keyed by server id, `pendingByRequest`, an in-flight set keyed by `"list" | "detail" | "logs"` for single-flight polling, and a private `stagedSecrets: Map<string, string>` that `snapshot()` never projects. `poll()` posts `getSettingsSection { section: "mcp" }` through the injected `refresh` and the detail/logs requests directly.

- [ ] **Step 4: Run the gates**

```bash
pnpm --filter dsh run typecheck
pnpm --filter dsh exec vitest run src/webview/media/settings/sections/mcp
```

- [ ] **Step 5: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(webview): add the MCP settings controller`

---

### Task 9: MCP components, editor, detail, logs, and localization

**Files:**
- Create: `packages/extension/src/webview/media/settings/sections/mcp/McpSection.tsx`
- Create: `packages/extension/src/webview/media/settings/sections/mcp/McpSection.test.tsx`
- Create: `packages/extension/src/webview/media/settings/sections/mcp/McpServerList.tsx`
- Create: `packages/extension/src/webview/media/settings/sections/mcp/McpServerList.test.tsx`
- Create: `packages/extension/src/webview/media/settings/sections/mcp/McpServerDetail.tsx`
- Create: `packages/extension/src/webview/media/settings/sections/mcp/McpServerDetail.test.tsx`
- Create: `packages/extension/src/webview/media/settings/sections/mcp/McpServerEditor.tsx`
- Create: `packages/extension/src/webview/media/settings/sections/mcp/McpServerEditor.test.tsx`
- Create: `packages/extension/src/webview/media/settings/sections/mcp/McpLogView.tsx`
- Create: `packages/extension/src/webview/media/settings/sections/mcp/McpLogView.test.tsx`
- Modify: `packages/extension/src/webview/media/settings/localization/en.ts`
- Modify: `packages/extension/src/webview/media/settings/localization/zh.ts`
- Modify: `packages/extension/src/webview/media/settings/localization/models.test.ts`
- Modify: `packages/extension/src/webview/media/style.css`

**Interfaces produced:** each component takes `{ controller: McpController; locale: SettingsLocale }` plus the slice it renders, and returns `JSX.Element`:

```ts
export function McpSection(props: { controller: McpController; locale: SettingsLocale; state: SettingsSectionState }): JSX.Element;
export function McpServerList(props: { controller: McpController; locale: SettingsLocale; snapshot: McpSnapshot }): JSX.Element;
export function McpServerDetail(props: { controller: McpController; locale: SettingsLocale; snapshot: McpSnapshot }): JSX.Element;
export function McpServerEditor(props: { controller: McpController; locale: SettingsLocale; draft: McpEditorDraft; secretStates: "available" | "unavailable" }): JSX.Element;
export function McpLogView(props: { locale: SettingsLocale; entries: McpLogEntryWire[] }): JSX.Element;
```

- [ ] **Step 1: Write failing component tests**

Each test file runs in both `"en"` and `"zh"` and asserts:

- `McpServerList`: one row per server with an accessible name, transport and enabled state, a status pill for each of the five `McpStatusWire` variants with attempt, tool count, connect time, next delay, and error text as applicable; named buttons (not icon-only) for connect/disconnect, enable/disable, edit, delete; `aria-current` on the selected row; row actions disabled while that server is pending and enabled for other servers; and an empty-catalog empty state with an Add server action instead of a bare table.
- `McpServerDetail`: tool checkboxes whose accessible name is the tool name, each with a busy state while its write is in flight; `aria-labelledby` linking the pane to the selected row; secret rows showing configured state, and the unknown-state note when `secretStates === "unavailable"`; the OAuth authorization note on an OAuth server, stating authorization happens in DSH Web and never that OAuth is unsupported; a Clear OAuth tokens button that opens the labelled confirmation.
- `McpServerEditor`: transport choice hiding the other transport's fields; header-name rows with `type="password"` value inputs that never repopulate; all five OAuth fields editable; `toolCallTimeoutMs` and the four reconnect fields present; an inline `role="alert"` for a record rejection carrying the plugin message as text; a secret-only Retry after a secret failure; the env plain-text storage note.
- `McpLogView`: `role="log"` with `aria-live="polite"`, one row per entry with level and message as text, and a bounded-height scroll region.
- `McpSection`: renders list plus detail, replaces the detail pane with the editor while open, and stacks under a narrow container width.
- Delete and Clear OAuth confirmations start focus on Cancel, dismiss on Escape, and return focus to the invoking control, reusing `settings/dialogFocus.ts`.
- `models.test.ts`: every new key exists in both dictionaries with identical key sets.

- [ ] **Step 2: Run the failing suites**

```bash
pnpm --filter dsh exec vitest run src/webview/media/settings/sections/mcp
```

Expected: module-not-found for the five new components.

- [ ] **Step 3: Implement the components and copy**

Build the five components with existing settings primitives and class-name conventions, render every plugin-sourced string as text, and add the full bilingual key set: nav label, transport names, auth kind names, every field label and hint, status names, log level names, empty states, both confirmations, the OAuth authorization note, the unknown-secret-state note, the env plain-text note, validation messages, and the generic secret failure sentence. Extend `style.css` with the list, detail, editor, and log-view rules, including the sub-560px stacking and the log view's bounded height.

- [ ] **Step 4: Run the gates**

```bash
pnpm --filter dsh run typecheck
pnpm --filter dsh exec vitest run src/webview/media/settings
```

- [ ] **Step 5: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(webview): add the MCP settings section UI`

---

### Task 10: Cross-section lifecycle, integration, and bounds

**Files:**
- Modify: `packages/extension/src/webview/media/App.tsx`
- Modify: `packages/extension/src/webview/media/App.test.tsx`
- Modify: `packages/extension/src/webview/media/settings/SettingsModal.tsx`
- Modify: `packages/extension/src/webview/media/settings/SettingsModal.test.tsx`
- Modify: `packages/extension/src/webview/media/settings/reducer.ts`
- Modify: `packages/extension/src/webview/media/settings/reducer.test.ts`
- Modify: `packages/bridge/test/settings-wire-bounds.test.ts`
- Modify: `packages/bridge/test/boot-probe.test.ts`
- Modify: `packages/bridge/test/boot.ts`

- [ ] **Step 1: Write failing integration and bounds tests**

`App.test.tsx` integration cases:

- With `settingsCapabilities { sections: ["mcp", "web-search"] }`, both nav rows render after Plugins and before Agent Presets; with `{ sections: [] }`, neither renders; a later `{ sections: ["mcp"] }` makes the MCP row appear without a reload.
- Activating MCP starts the 2,000 ms poll (advance fake timers and count posted `getSettingsSection { section: "mcp" }` messages), and switching to another section, closing the modal, and disconnecting each stop it. Assert Web Search never polls.
- A full MCP flow with a mocked relay: add, edit, enable, connect, toggle a tool, read logs incrementally, and delete a server.
- A Web Search save with keys and one without; a partial secret failure keeps the form dirty with the failed key retained and the catalog change visible in the refreshed view.
- Disconnect with a dirty MCP editor and a dirty Web Search form: both sections become unavailable, staged secrets clear, non-secret drafts and the MCP selection survive; reconnect posts `getSettingsCapabilities` and a General load, then refreshes the active section.
- Closing the modal with either form dirty raises the existing dirty-close confirmation, and confirming discards both.
- After every flow above, `JSON.stringify(vscodeApiMock.getState())` contains no secret literal.

`settings-wire-bounds.test.ts` cases:

- Cap consistency: `SETTINGS_WIRE_SCAN_NODE_LIMIT` exceeds `MAX_MCP_LIST_VIEW_NODES + MESSAGE_ENVELOPE_NODES`, `MAX_MCP_DETAIL_NODES + RESULT_ENVELOPE_NODES`, `MAX_MCP_LOGS_MESSAGE_NODES + RESULT_ENVELOPE_NODES`, and `MAX_WEB_SEARCH_VIEW_NODES + MESSAGE_ENVELOPE_NODES`, with `const RESULT_ENVELOPE_NODES = 5` documented as the message record, `kind`, `requestId`, `result` record, and `ok`.
- A maximal MCP list view: `MAX_MCP_SERVERS` servers, each with `MAX_MCP_ARGS` args, `MAX_MCP_ENV_ENTRIES` env pairs, `oauth` auth with `MAX_MCP_SCOPES` scopes, `MAX_MCP_DISABLED_TOOLS` disabled tools, and every string at its length cap, accepted by `isOutboundMessage` inside a `settingsSection` message.
- A maximal MCP detail: `headers` auth with `MAX_MCP_HEADER_NAMES` names, `MAX_MCP_TOOLS` tools, and a `known` secret state with one entry per header name, accepted inside an `mcpServer` message.
- A maximal logs message: `MAX_MCP_LOG_ENTRIES` entries with `message` and `detail` at their length caps, accepted inside an `mcpLogs` message.
- A maximal Web Search view accepted inside a `settingsSection` message.
- One over-cap payload per family rejected by `isOutboundMessage`.

`boot-probe.test.ts` cases: a structurally incomplete mounted `mcp` service is withheld from the capability list with exactly one warning per registration generation; providing and then disposing a fake service pushes a capability change through the watcher in both directions. Extend `boot.ts` with the fake-service helpers these cases need.

- [ ] **Step 2: Run the failing suites**

```bash
pnpm --filter @dsh-vscode/bridge exec vitest run test/settings-wire-bounds.test.ts test/boot-probe.test.ts
pnpm --filter dsh exec vitest run src/webview/media/App.test.tsx src/webview/media/settings/reducer.test.ts
```

Expected: missing bound constants, missing capability push behavior, and missing poll scheduling.

- [ ] **Step 3: Implement the lifecycle wiring**

In `App.tsx`, add the MCP controller with its re-render pair, route `mcpServer`, `mcpLogs`, and `mcpOperation` to it, schedule the 2,000 ms poll with `setInterval` in an effect gated on `open && activeSection === "mcp" && connected`, clear it on every gate change and on unmount, include both new controllers in the aggregate dirty check, the discard-all path, and the disconnect/reconnect paths, and request capabilities plus a General load on reconnect. In `SettingsModal.tsx`, render the two new sections and pass the capability list to `SettingsNav`. In `reducer.ts`, ensure invalidation with reason `"mcp"` or `"web-search"` marks only that section stale.

- [ ] **Step 4: Run the gates**

```bash
pnpm --filter @dsh-vscode/bridge run typecheck
pnpm --filter @dsh-vscode/bridge run test
pnpm --filter dsh run typecheck
pnpm --filter dsh run test
```

- [ ] **Step 5: Commit-ready checkpoint**

Suggested message if explicitly requested: `feat(webview): wire MCP and Web Search lifecycle`

---

### Task 11: Docs, packaging, and manual verification

**Files:**
- Modify: `packages/extension/README.md`
- Modify: `packages/extension/package.json` (only if a new configuration description is required by an implemented control)
- Verify: `docs/superpowers/specs/2026-08-23-dsh-vscode-plugin-settings-design.md`

- [ ] **Step 1: Document both sections**

In `packages/extension/README.md`, add an "Optional plugin settings" section stating: MCP and Web Search rows appear only while their plugin service is mounted in the launched profile; Web Search requires a `dsh-web-search` build that publishes `ctx.webSearchManager` together with the `@anht3889/dsh-web-search-service` package it depends on, and until that build is installed the core `web-search-deepseek` Plugins card remains; MCP works against the installed `@anht3889/dsh-mcp-mgmt-bundle` with no plugin change, degrading to unknown secret state without `describeSecrets` and to poll-only refresh without `onCatalogChanged`; OAuth authorization must be completed from DSH Web while configuration, client secret, and token clearing work here; keys cannot be unset from the editor; and a catalog edited in another already-running profile becomes visible only after restart because each profile caches its catalog in memory.

Verify the spec still states the resolved 40,960 MCP list-view ceiling and its 36,871-node maximal-view / 36,874-node maximal-message arithmetic after implementation; any changed wire structure must update both that arithmetic and the executable bounds test together.

- [ ] **Step 2: Run every repository gate**

```bash
cd /Users/anhtra/workspace/dsh-web-search
pnpm run typecheck && pnpm run test && pnpm run build && pnpm run verify:package

cd /Users/anhtra/workspace/dsh-vscode-extension
pnpm -r run typecheck
pnpm -r run test
pnpm -r run build
pnpm --filter dsh run typecheck:e2e
pnpm --filter dsh run test:e2e
```

- [ ] **Step 3: Package and scan the VSIX**

```bash
cd /Users/anhtra/workspace/dsh-vscode-extension
pnpm --filter dsh run package
```

Then list the archive contents and scan for secret-shaped strings, expecting no match:

```bash
cd packages/extension
vsix="$(ls -t ./*.vsix | head -n 1)"
unzip -l "$vsix"
unzip -p "$vsix" 'extension/dist/*' | grep -nEi 'tvly-|BSA[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{16,}|OAUTH_ACCESS=|api[_-]?key["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_-]{16,}' || echo "no secret-shaped string found"
```

The `grep` must print the fallback line. Delete any older `.vsix` in that directory before packaging so the scan cannot inspect a stale artifact.

- [ ] **Step 4: Manual smoke in VS Code and Cursor**

Launch the extension from the built output in both editors and confirm, recording the result of each line:

1. With neither plugin mounted: no MCP row, no Web Search row, no error, and the `web-search-deepseek` card present in Plugins.
2. With both mounted: both rows appear after Plugins; the `web-search-deepseek` card is gone.
3. Mount one plugin mid-session and see its row appear without reloading the window.
4. MCP: add a real `stdio` server and a real `streamable-http` server, connect both, toggle a tool, read logs, edit, disable, delete; confirm the status pill tracks the connection.
5. MCP OAuth: create an OAuth server, store `OAUTH_CLIENT_SECRET`, read the DSH Web authorization note, and clear tokens.
6. Web Search: select Tavily or SearXNG, save a key or URL, confirm the availability line, then run a search in the same session and confirm it uses the new configuration with no restart.
7. Both sections at narrow and wide sidebar widths, at 200% zoom, in English and Chinese, and in light and dark themes.
8. Confirm the Extension Host output channel and the retained webview state hold no secret value.

- [ ] **Step 5: Commit-ready checkpoint**

```bash
git status --short
git diff --check
```

Suggested message if explicitly requested: `docs(extension): document optional MCP and Web Search settings`

---

## Verification Against the Spec

| Spec section | Covered by |
|---|---|
| 1 Goal and non-goals | Global Constraints; Tasks 3, 9, 11 |
| 2 Architecture and service ownership | Tasks 1, 3 |
| 3 Optional service contracts | Task 1 (Web Search seam), Task 3 (both structural services) |
| 4 Protocol version 6 | Task 2; bounds re-verified in Task 10 |
| 5 MCP section | Tasks 6, 7, 8, 9 |
| 6 Web Search section | Tasks 1, 4, 5 |
| 7 UI, navigation, localization, accessibility, responsiveness | Tasks 3, 5, 9, 10 |
| 8 Lifecycle, concurrency, disconnect, reconnect, disposal | Tasks 3, 4, 6, 7, 10 |
| 9 Security and secret handling | Tasks 2, 4, 5, 7, 8, 10, 11 |
| 10 Error handling and partial failures | Tasks 4, 5, 6, 7, 8, 9 |
| 11 Testing matrix | Every task's RED and GREEN steps; Task 10 bounds; Task 11 gates and smoke |
| 12 File boundaries | File Structure; each task's Files list |
| 13 Migration and deployment | Task 1 Step 9; Task 11 Step 1 |
| 14 Rulings and known deferrals | Global Constraints; Rulings Made While Planning |
| Acceptance criteria 1–14 | 1 → T3, T10; 2 → T1; 3 → T3; 4 → T3, T11; 5 → T2; 6 → T6–T9; 7 → T9; 8 → T4, T5; 9 → T4; 10 → T2, T4, T5, T7, T8, T10, T11; 11 → T2, T10; 12 → T3, T4, T6, T7, T10; 13 → T5, T9; 14 → T11 |

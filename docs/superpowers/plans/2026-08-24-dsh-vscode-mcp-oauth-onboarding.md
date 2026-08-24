# VS Code MCP OAuth Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a VS Code user add an OAuth MCP HTTP server with only a name and URL, complete login in the system browser, and land on a connected server whose client id, endpoints, and any registration secret were produced inside the plugin.

**Architecture:** The vscode profile mounts a `127.0.0.1` `dsh-host-webserver` with an OS-assigned port so the existing MCP plugin can name a redirect URI and receive `/callback`. The bridge, still in the same `dsh` child, runs discover → upsert → in-process `setSecrets` → `startOAuth`, then returns only a non-secret `authorizeUrl`. The extension host opens that URL; the webview waits on the existing 2s poll.

**Tech Stack:** TypeScript, Cordis, `@deepseek-ai/dsh-host-webserver`, NDJSON settings protocol v6, VS Code `openExternal`, React webview, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-24-dsh-vscode-mcp-oauth-onboarding-design.md`

## Global Constraints

- Protocol version stays **6**. New members are additive closed records; unknown inbound kinds stay rejected.
- The bridge still imports nothing from `@anht3889/*`. `startOAuth`, `discoverOAuth`, and `oauthRedirectOrigin` are optional structural members.
- No `@deepseek-ai/dsh-web-app` in the vscode profile. Web server host is exactly `'127.0.0.1'`; port is `0`.
- Client secrets, access tokens, refresh tokens, and authorization codes never appear in NDJSON, reducer state, controller snapshots, logs, or test snapshots.
- `serveManagementHttpApi` defaults to `true` (DSH Web unchanged). vscode turns it off in the **profile** `cordis.patch.yml`, which the loader applies last — not in the bridge patch.
- `startOAuth` is not a required probe member. Authorization is available only when `oauthRedirectOrigin()` returns a string **and** `startOAuth` is a function.
- Provision refuses without upserting when discovery returns an empty `clientId`.
- Provision uses `redirectPath: "/callback"`, `toolCallTimeoutMs: 30_000`, and reconnect `{ enabled: true, initialDelayMs: 1000, maxDelayMs: 30000, maxAttempts: 5 }`.
- In-process secret writes after registration use plugin key `OAUTH_CLIENT_SECRET`. Failures of that `setSecrets` use the existing generic secret-failure copy, never plugin exception text.
- Do not push, publish, merge, or install globally. Do not create commits unless the user explicitly requests them; each task ends at a commit-ready checkpoint.

---

## Rulings Made While Planning

1. **Public origin probe is named `oauthRedirectOrigin(): string | undefined`.** The runtime’s private resolver field is renamed to `resolveRedirectOrigin` so the public method matches the spec.
2. **`McpOperationOutcome` gains optional `authorizeUrl`.** There is no extra outbound kind. `isMcpOperationSuccessResult` allows `ok`, optional `detail`, optional `authorizeUrl`.
3. **Coordinator latest-wins key for `provisionOAuthServer` is `mcp-op:new`**, same as create-upsert, so a provision and a create cannot interleave on the same draft.
4. **`startOAuth` is an MCP operation, not a new inbound kind.** `discoverMcpOAuth` stays for Advanced Discover.
5. **When `serveManagementHttpApi` is false, still register exact `/mcp-management/oauth/callback`** if a record uses that path, because the prefix that would have covered it is absent.
6. **Node-count comments** that still say 36,875 must add the `authorization` field (and `origin` on the loopback variant). Recompute in Task 2’s bounds test; do not invent a new `MAX_MCP_LIST_VIEW_NODES` unless the maximal view exceeds 40,960.

---

## File Structure

### `/Users/anhtra/workspace/dsh-mcp-management`

- Modify: `packages/bundle/src/manager/http-api.ts` — optional `{ serveManagementHttpApi?: boolean }`
- Modify: `packages/bundle/src/manager/index.ts` — Config field; pass flag into `registerHttpApi`
- Modify: `packages/bundle/src/manager/runtime.ts` — public `oauthRedirectOrigin()`; rename private resolver
- Modify: `packages/bundle/tests/manager/http-api.spec.ts`
- Modify: `packages/bundle/tests/manager/runtime.spec.ts`
- Modify: `packages/bundle/README.md` — `serveManagementHttpApi`

### `/Users/anhtra/workspace/dsh-vscode-extension`

- Modify: `packages/contract/src/settings.ts` + `settings.test.ts`
- Modify: `packages/bridge/src/settings/optional-services.ts`
- Modify: `packages/bridge/src/settings/mcp.ts` + `mcp.test.ts`
- Modify: `packages/bridge/src/settings/coordinator.ts` + `coordinator.test.ts`
- Modify: `packages/bridge/cordis.patch.yml` + `package.json`
- Modify: `packages/bridge/test/settings-wire-bounds.test.ts`
- Modify: `packages/extension/src/webview/panel.ts` + `panel.test.ts`
- Modify: `packages/extension/src/webview/media/settings/sections/mcp/McpController.ts` + tests
- Modify: `McpServerEditor.tsx` / `McpServerDetail.tsx` / `McpSection.tsx` + tests
- Modify: `localization/en.ts`, `localization/zh.ts`
- Modify: `packages/extension/README.md`
- Modify: `docs/superpowers/specs/2026-08-23-dsh-vscode-plugin-settings-design.md` — pointer to the new spec for OAuth
- Existing user profile (not in git): `~/.dsh/profiles/vscode/cordis.patch.yml` documented, not edited by CI

---

### Task 1: Callback-only HTTP API and origin probe

**Files:**
- Modify: `/Users/anhtra/workspace/dsh-mcp-management/packages/bundle/src/manager/http-api.ts`
- Modify: `/Users/anhtra/workspace/dsh-mcp-management/packages/bundle/src/manager/index.ts`
- Modify: `/Users/anhtra/workspace/dsh-mcp-management/packages/bundle/src/manager/runtime.ts`
- Test: `/Users/anhtra/workspace/dsh-mcp-management/packages/bundle/tests/manager/http-api.spec.ts`
- Test: `/Users/anhtra/workspace/dsh-mcp-management/packages/bundle/tests/manager/runtime.spec.ts`
- Modify: `/Users/anhtra/workspace/dsh-mcp-management/packages/bundle/README.md`

**Interfaces:**
- Consumes: existing `registerHttpApi(webServer, mcp)`, `McpManagerRuntime`, `oauthRedirectOrigin(publicOrigin, webServer)`
- Produces:
  - `registerHttpApi(webServer, mcp, options?: { serveManagementHttpApi?: boolean }): () => void` — default `serveManagementHttpApi: true`
  - `McpManagerRuntime.oauthRedirectOrigin(): string | undefined`
  - Config `serveManagementHttpApi?: boolean` default `true`

- [ ] **Step 1: Write the failing HTTP API tests**

In `http-api.spec.ts`, next to the existing `start` helper, add an options argument and two tests:

```ts
it('omits the management prefix when serveManagementHttpApi is false', async () => {
  const request = await start(fakeApi(), servers, { serveManagementHttpApi: false })
  const response = await request('/mcp-management/servers')
  expect(response.status).toBe(404)
})

it('still serves /callback for an OAuth record when the management prefix is off', async () => {
  const api = fakeApi()
  api.oauthCallbackPaths = () => ['/callback']
  const request = await start(api, servers, { serveManagementHttpApi: false })
  const response = await request('/callback?code=x&state=y', 'GET', undefined, 'text/html')
  expect(response.status).not.toBe(404)
  expect(api.handledCallbacks).toHaveLength(1)
})
```

If `fakeApi` has no `handledCallbacks`, record `handleOAuthCallback` calls on the fake (it already implements `handleOAuthCallback`). Extend `start` to pass the third argument through to `registerHttpApi`. Existing tests must keep calling `start(api, servers)` with no third argument and still list `/mcp-management/servers`.

Also add:

```ts
it('registers the prefixed callback path as exact when the prefix is off', async () => {
  const api = fakeApi()
  api.oauthCallbackPaths = () => ['/mcp-management/oauth/callback']
  const registered: string[] = []
  registerHttpApi({
    register: route => {
      registered.push(route.path)
      return () => {}
    },
  }, api, { serveManagementHttpApi: false })
  expect(registered).toContain('/mcp-management/oauth/callback')
  expect(registered).not.toContain('/mcp-management')
})
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `cd /Users/anhtra/workspace/dsh-mcp-management && npx vitest run packages/bundle/tests/manager/http-api.spec.ts`

Expected: FAIL — `registerHttpApi` still always registers the prefix; the new `start` third argument is unused.

- [ ] **Step 3: Implement callback-only registration**

Change the signature:

```ts
export function registerHttpApi(
  webServer: McpManagementWebServer,
  mcp: McpManagementApi,
  options: { serveManagementHttpApi?: boolean } = {},
): () => void {
  const serveManagement = options.serveManagementHttpApi !== false
  const disposePrefix = serveManagement
    ? webServer.register({ kind: 'prefix', path: '/mcp-management', handler: ...existing... })
    : () => {}
  // syncCallbackRoutes: when !serveManagement, do not filter paths that start with /mcp-management
  const wanted = new Set(
    mcp.oauthCallbackPaths().filter(path => serveManagement ? !path.startsWith('/mcp-management') : true),
  )
  // ... rest unchanged; dispose still calls disposePrefix()
}
```

Keep the existing prefix handler body byte-identical when `serveManagement` is true.

- [ ] **Step 4: Wire Config and origin probe**

In `index.ts` add to `Config` and schema:

```ts
serveManagementHttpApi?: boolean
// z.boolean().default(true)
```

Pass it:

```ts
() => registerHttpApi(httpCtx.get('webServer') as McpManagementWebServer, runtime, {
  serveManagementHttpApi: config.serveManagementHttpApi !== false,
})
```

In `runtime.ts`, rename the private field `oauthRedirectOrigin` to `resolveRedirectOrigin`. Add:

```ts
/**
 * @returns the callback origin without a trailing slash, or `undefined` when
 *   neither `publicOrigin` nor a listening web server can name one.
 */
oauthRedirectOrigin(): string | undefined {
  try {
    return this.resolveRedirectOrigin().replace(/\/$/, '')
  } catch {
    // The resolver's only failure is a missing origin; startOAuth still throws via resolveRedirectOrigin.
    return undefined
  }
}
```

Update `discoverOAuth` / `registrationRedirectUri` to call `this.oauthRedirectOrigin()` (the public method) instead of catching the resolver themselves, or keep `registrationRedirectUri` using the public method:

```ts
private registrationRedirectUri(): string | undefined {
  const origin = this.oauthRedirectOrigin()
  if (origin === undefined) return undefined
  return `${origin}${OAUTH_REDIRECT_PATH}`
}
```

Add a runtime test:

```ts
it('reports no callback origin when the resolver throws', async () => {
  const runtime = await McpManagerRuntime.create(ctx, {
    catalogPath, secretsPath,
    oauthRedirectOrigin: () => { throw new Error('mcp-manager: OAuth needs a callback origin') },
  })
  expect(runtime.oauthRedirectOrigin()).toBeUndefined()
})

it('strips a trailing slash from a resolvable origin', async () => {
  const runtime = await McpManagerRuntime.create(ctx, {
    catalogPath, secretsPath,
    oauthRedirectOrigin: () => 'http://127.0.0.1:3080/',
  })
  expect(runtime.oauthRedirectOrigin()).toBe('http://127.0.0.1:3080')
})
```

Document `serveManagementHttpApi` in `packages/bundle/README.md` (default true; set false when the host is not DSH Web).

- [ ] **Step 5: Re-run plugin tests**

Run: `cd /Users/anhtra/workspace/dsh-mcp-management && npx vitest run packages/bundle/tests/manager/http-api.spec.ts packages/bundle/tests/manager/runtime.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit-ready checkpoint** — plugin HTTP flag + origin probe. Do not commit unless asked.

---

### Task 2: Wire contract for loopback OAuth and provision operations

**Files:**
- Modify: `packages/contract/src/settings.ts`
- Test: `packages/contract/src/settings.test.ts`

**Interfaces:**
- Consumes: Task 1’s origin string; existing `McpOperationWire`, `McpOperationMessage`, `McpOAuthSupportWire`
- Produces: types below, used by Tasks 3–7

Replace `McpOAuthSupportWire` with:

```ts
export type McpOAuthSupportWire =
  | {
      kind: "manual";
      reason: "no-callback-origin";
      discovery: "available" | "unavailable";
      authorization: "unavailable";
    }
  | {
      kind: "loopback";
      origin: string;
      discovery: "available" | "unavailable";
      authorization: "available";
    };
```

Extend `McpOperationWire`:

```ts
  | {
      kind: "provisionOAuthServer";
      serverName: string;
      url: string;
      enabled: boolean;
    }
  | { kind: "startOAuth"; serverId: string };
```

Extend `McpOperationMessage` success:

```ts
result:
  | { ok: true; detail?: McpServerDetailWire; authorizeUrl?: string }
  | { ok: false; error: SettingsErrorWire };
```

- [ ] **Step 1: Write failing contract tests**

Add cases:

- inbound `provisionOAuthServer` with name, URL, enabled is accepted
- inbound `provisionOAuthServer` missing URL is rejected
- inbound `startOAuth` with `serverId` is accepted
- outbound success with `authorizeUrl: "https://idp.example/authorize"` is accepted
- outbound success with `authorizeUrl` over `MAX_WIRE_URL_LENGTH` is rejected
- outbound success that also carries `clientSecret` / `code` / `code_verifier` is rejected by the credential scan
- MCP view with `oauth: { kind: "loopback", origin: "http://127.0.0.1:9", discovery: "available", authorization: "available" }` is accepted
- MCP view still using `{ kind: "manual", reason: "no-callback-origin", discovery: "available" }` **without** `authorization` is rejected
- MCP view with `kind: "loopback"` and `authorization: "unavailable"` is rejected

Update every existing fixture that builds `McpOAuthSupportWire` in this file to include `authorization: "unavailable"`.

- [ ] **Step 2: Run contract tests; confirm red**

Run: `cd /Users/anhtra/workspace/dsh-vscode-extension && pnpm --filter @dsh-vscode/contract test`

Expected: FAIL on the new cases and on existing MCP view fixtures missing `authorization`.

- [ ] **Step 3: Implement validators**

`isMcpSettingsView` oauth branch: two closed records.

`isMcpOperationWire` add:

```ts
case "provisionOAuthServer":
  return isClosedRecord(value, ["kind", "serverName", "url", "enabled"], ["kind", "serverName", "url", "enabled"])
    && isBoundedNonEmptyString(value.serverName, MAX_WIRE_IDENTIFIER_LENGTH)
    && isBoundedNonEmptyString(value.url, MAX_WIRE_URL_LENGTH)
    && typeof value.enabled === "boolean";
case "startOAuth":
  return isClosedRecord(value, ["kind", "serverId"], ["kind", "serverId"])
    && isBoundedNonEmptyString(value.serverId, MAX_WIRE_IDENTIFIER_LENGTH);
```

`isMcpOperationSuccessResult`:

```ts
function isMcpOperationSuccessResult(value: unknown): boolean {
  return isClosedRecord(value, ["ok", "detail", "authorizeUrl"], ["ok"])
    && value.ok === true
    && (value.detail === undefined || isMcpServerDetailWire(value.detail))
    && (value.authorizeUrl === undefined
      || isBoundedNonEmptyString(value.authorizeUrl, MAX_WIRE_URL_LENGTH));
}
```

Update JSDoc on `McpOAuthSupportWire`: authorization is `available` only for `kind: "loopback"`.

- [ ] **Step 4: Re-run contract tests**

Run: `pnpm --filter @dsh-vscode/contract test && pnpm --filter @dsh-vscode/contract typecheck`

Expected: PASS. Then `pnpm --filter @dsh-vscode/contract build` so bridge/extension pick up types.

- [ ] **Step 5: Commit-ready checkpoint** — contract.

---

### Task 3: Bridge provision, startOAuth, and availability projection

**Files:**
- Modify: `packages/bridge/src/settings/optional-services.ts`
- Modify: `packages/bridge/src/settings/mcp.ts`
- Test: `packages/bridge/src/settings/mcp.test.ts`
- Modify: `packages/bridge/src/settings/coordinator.ts`
- Test: `packages/bridge/src/settings/coordinator.test.ts`

**Interfaces:**
- Consumes: Task 2 wire types; Task 1 `oauthRedirectOrigin()` / `startOAuth` / `discoverOAuth`
- Produces: `runMcpOperation` handles the two new kinds; `buildMcpView().oauth` is loopback or manual; `McpOperationOutcome.authorizeUrl?: string`

Add optional members (not required probe list):

```ts
startOAuth?(id: string): Promise<{ authorizeUrl: string }>;
oauthRedirectOrigin?(): string | undefined;
```

Keep `discoverOAuth?` as today. `McpOAuthDiscoveryLike` still may include `clientSecret` **in-process only**.

- [ ] **Step 1: Write failing bridge tests in `mcp.test.ts`**

```ts
it("projects loopback OAuth support when the plugin names an origin and can start OAuth", async () => {
  const view = await buildMcpView(contextWith(fakeService({
    discoverOAuth: async () => ({ clientId: "c", authorizeUrl: "https://a", tokenUrl: "https://t", scopes: [], registered: true }),
    startOAuth: async () => ({ authorizeUrl: "https://a/auth" }),
    oauthRedirectOrigin: () => "http://127.0.0.1:54321",
  })));
  expect(view.oauth).toEqual({
    kind: "loopback",
    origin: "http://127.0.0.1:54321",
    discovery: "available",
    authorization: "available",
  });
});

it("keeps authorization unavailable without an origin even if startOAuth exists", async () => {
  const view = await buildMcpView(contextWith(fakeService({
    startOAuth: async () => ({ authorizeUrl: "https://a/auth" }),
    oauthRedirectOrigin: () => undefined,
  })));
  expect(view.oauth).toMatchObject({ kind: "manual", authorization: "unavailable" });
});
```

Provision:

```ts
it("provisions from URL, stores a registration secret in-process, and returns authorizeUrl without the secret", async () => {
  const setSecrets = vi.fn(async () => {});
  const startOAuth = vi.fn(async () => ({ authorizeUrl: "https://idp.example/authorize?client_id=issued" }));
  const upsert = vi.fn(async (record) => record);
  const outcome = await runMcpOperation(contextWith(fakeService({
    setSecrets,
    startOAuth,
    upsert,
    oauthRedirectOrigin: () => "http://127.0.0.1:9",
    discoverOAuth: async () => ({
      clientId: "issued",
      authorizeUrl: "https://idp.example/authorize",
      tokenUrl: "https://idp.example/token",
      scopes: ["mcp"],
      registered: true,
      clientSecret: "dyn-secret",
    }),
  })), {
    kind: "provisionOAuthServer",
    serverName: "glean",
    url: "https://mcp.example/mcp",
    enabled: true,
  }, { newId: () => "new-id", now: () => "ts" });
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
    id: "new-id",
    auth: expect.objectContaining({
      kind: "oauth",
      clientId: "issued",
      redirectPath: "/callback",
    }),
  }));
  expect(setSecrets).toHaveBeenCalledWith("new-id", { OAUTH_CLIENT_SECRET: "dyn-secret" });
  expect(JSON.stringify(outcome)).not.toContain("dyn-secret");
  expect(outcome.authorizeUrl).toBe("https://idp.example/authorize?client_id=issued");
});

it("does not upsert when discovery returns no client id", async () => {
  const upsert = vi.fn();
  await expect(runMcpOperation(contextWith(fakeService({
    upsert,
    startOAuth: async () => ({ authorizeUrl: "https://a" }),
    oauthRedirectOrigin: () => "http://127.0.0.1:9",
    discoverOAuth: async () => ({
      clientId: "",
      authorizeUrl: "https://idp.example/authorize",
      tokenUrl: "https://idp.example/token",
      scopes: [],
      registered: false,
    }),
  })), {
    kind: "provisionOAuthServer",
    serverName: "glean",
    url: "https://mcp.example/mcp",
    enabled: true,
  })).rejects.toThrow(/Advanced|client id/i);
  expect(upsert).not.toHaveBeenCalled();
});
```

`startOAuth` operation:

```ts
it("returns the plugin authorize URL for startOAuth", async () => {
  const outcome = await runMcpOperation(contextWith(fakeService({
    startOAuth: async () => ({ authorizeUrl: "https://idp.example/authorize" }),
    oauthRedirectOrigin: () => "http://127.0.0.1:9",
  })), { kind: "startOAuth", serverId: "server-1" });
  expect(outcome.authorizeUrl).toBe("https://idp.example/authorize");
});
```

Update existing `buildMcpView` assertions to include `authorization: "unavailable"`. Rename the test that forbids calling `startOAuth` from a **record** operation so it still asserts upsert/connect never call it, but provision/startOAuth do.

Coordinator tests: provision success message includes `authorizeUrl`; latest-wins on `mcp-op:new`; startOAuth without origin maps to `mcp-rejected`.

- [ ] **Step 2: Run bridge tests; confirm red**

Run: `cd /Users/anhtra/workspace/dsh-vscode-extension && pnpm --filter @dsh-vscode/bridge exec vitest run src/settings/mcp.test.ts src/settings/coordinator.test.ts`

Expected: FAIL — types and switch exhaustiveness.

- [ ] **Step 3: Implement**

`buildMcpView` oauth:

```ts
const origin = service.oauthRedirectOrigin?.();
const canAuthorize = typeof service.startOAuth === "function"
  && typeof origin === "string"
  && origin.length > 0;
const discovery = service.discoverOAuth === undefined ? "unavailable" : "available";
oauth: canAuthorize
  ? { kind: "loopback", origin, discovery, authorization: "available" }
  : { kind: "manual", reason: "no-callback-origin", discovery, authorization: "unavailable" }
```

`runMcpOperation` cases (before `default: assertNever`):

```ts
case "provisionOAuthServer": {
  const origin = service.oauthRedirectOrigin?.();
  if (origin === undefined || origin === "" || service.discoverOAuth === undefined || service.startOAuth === undefined) {
    throw new Error("The mounted MCP plugin cannot authorize OAuth servers in this profile");
  }
  const discovered = await runPluginOperation(
    () => service.discoverOAuth!(operation.url),
    `OAuth discovery for ${operation.url} failed`,
  );
  if (discovered.clientId === "") {
    throw new Error(
      "OAuth discovery filled endpoints but registered no client ID. Enter a client ID under Advanced.",
    );
  }
  const record = composeRecord(service, {
    serverName: operation.serverName,
    enabled: operation.enabled,
    transport: "streamable-http",
    url: operation.url,
    auth: {
      kind: "oauth",
      clientId: discovered.clientId,
      authorizeUrl: discovered.authorizeUrl,
      tokenUrl: discovered.tokenUrl,
      scopes: [...discovered.scopes],
      redirectPath: "/callback",
    },
    toolCallTimeoutMs: 30_000,
    reconnect: {
      enabled: true,
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      maxAttempts: 5,
    },
  }, ids);
  await runPluginOperation(() => service.upsert(record), `MCP server "${record.id}" was rejected`);
  if (typeof discovered.clientSecret === "string" && discovered.clientSecret.length > 0) {
    await runPluginOperation(
      () => service.setSecrets(record.id, { OAUTH_CLIENT_SECRET: discovered.clientSecret! }),
      `MCP server "${record.id}" could not store secrets`,
    );
    // Use the existing secret-failure helper if setSecrets is supposed to use generic copy —
    // match setServerSecrets in this file, not runPluginOperation with plugin text.
  }
  const { authorizeUrl } = await runPluginOperation(
    () => service.startOAuth!(record.id),
    `OAuth authorization for MCP server "${record.id}" could not start`,
  );
  assertString(authorizeUrl, MAX_WIRE_URL_LENGTH, "OAuth authorize URL");
  return { detail: await buildMcpDetail(ctx, record.id), authorizeUrl };
}
case "startOAuth": {
  requireRecord(service, operation.serverId);
  if (service.startOAuth === undefined) {
    throw new Error("The mounted MCP plugin cannot authorize OAuth servers in this profile");
  }
  const { authorizeUrl } = await runPluginOperation(
    () => service.startOAuth!(operation.serverId),
    `OAuth authorization for MCP server "${operation.serverId}" could not start`,
  );
  assertString(authorizeUrl, MAX_WIRE_URL_LENGTH, "OAuth authorize URL");
  return { detail: await buildMcpDetail(ctx, operation.serverId), authorizeUrl };
}
```

For the registration `setSecrets` call, copy the **generic** secret error path already used by `setServerSecrets` in the same file (do not forward plugin text).

Coordinator `runMcpOperation` target:

```ts
const target = message.operation.kind === "upsertServer"
  ? message.operation.server.serverId ?? "new"
  : message.operation.kind === "provisionOAuthServer"
    ? "new"
    : message.operation.serverId;
```

- [ ] **Step 4: Re-run bridge MCP tests and typecheck**

Run: `pnpm --filter @dsh-vscode/bridge exec vitest run src/settings/mcp.test.ts src/settings/coordinator.test.ts && pnpm --filter @dsh-vscode/bridge typecheck`

Expected: PASS.

- [ ] **Step 5: Commit-ready checkpoint** — bridge operations.

---

### Task 4: vscode profile loopback server

**Files:**
- Modify: `packages/bridge/cordis.patch.yml`
- Modify: `packages/bridge/package.json`
- Modify: `packages/extension/README.md`

**Interfaces:**
- Consumes: `@deepseek-ai/dsh-host-webserver` Config `{ host, port }`
- Produces: vscode profile tree includes a loopback listener; README documents the MCP overlay

- [ ] **Step 1: Add the dependency and patch insert**

Add `"@deepseek-ai/dsh-host-webserver"` at the same version family as the other `@deepseek-ai/dsh-*` bridge deps (currently `0.1.0-rc.8` in `packages/bridge/package.json`). Run `pnpm install` from the extension repo root.

In `cordis.patch.yml`, add under the existing `insert` list **before** `vscode-runner`:

```yaml
    - id: host-webserver
      name: '@deepseek-ai/dsh-host-webserver'
      config:
        host: '127.0.0.1'
        port: 0
```

Do **not** put `serveManagementHttpApi` here.

- [ ] **Step 2: Document the profile overlay**

In `packages/extension/README.md`, replace the paragraph that says authorization must be completed from DSH Web with:

- The vscode profile’s `dsh` child listens on `127.0.0.1` with an OS-assigned port for OAuth callbacks only.
- Operators must add to **that profile’s** `cordis.patch.yml` (loader applies this last):

```yaml
- id: mcp-mgmt-manager
  config:
    serveManagementHttpApi: false
```

- If that row is omitted, callbacks still work and `/mcp-management` is reachable on loopback, matching DSH Web’s local API.
- **Add & Authorize** needs a plugin build that implements `discoverOAuth`, `startOAuth`, and `oauthRedirectOrigin` (this workspace’s MCP manager after Task 1).
- Advanced remains for providers that do not dynamically register a client.
- A client registered only for DSH Web’s port cannot be reused against vscode’s ephemeral port without re-registration.

- [ ] **Step 3: Point the 2026-08-23 plugin-settings spec OAuth sections at the new spec**

At the top of `docs/superpowers/specs/2026-08-23-dsh-vscode-plugin-settings-design.md` OAuth deferrals (section 14 items 1–2 and the non-goal bullets forbidding a vscode web server / authorize button), add one sentence: superseded by `2026-08-24-dsh-vscode-mcp-oauth-onboarding-design.md`. Do not rewrite that whole document.

- [ ] **Step 4: Install the overlay on the developer profile used for smoke**

Edit `~/.dsh/profiles/vscode/cordis.patch.yml` to include the `serveManagementHttpApi: false` row (and keep any existing `trustSystemCertificates` rows). Re-run `pnpm install` in that profile if `package.json` still needs the new bridge dependency via the workspace link.

This step is local-machine only; do not commit home-directory files.

- [ ] **Step 5: Commit-ready checkpoint** — profile wiring + README.

---

### Task 5: Extension host opens the authorize URL

**Files:**
- Modify: `packages/extension/src/webview/panel.ts`
- Test: `packages/extension/src/webview/panel.test.ts`

**Interfaces:**
- Consumes: outbound `mcpOperation` with `result.ok === true` and `authorizeUrl`
- Produces: `vscode.env.openExternal` called before the webview sees the message

- [ ] **Step 1: Extend the vscode mock and write the failing test**

In `panel.test.ts` hoisted mock, add:

```ts
const openExternal = vi.fn(async () => true);
// inside vi.mock("vscode"):
env: { openExternal },
Uri: {
  parse: (value: string) => ({ toString: () => value }),
  file: ...,
  joinPath: ...,
},
```

Add a test next to “MCP settings command relay”:

```ts
it("opens a successful MCP authorize URL in the system browser before forwarding", async () => {
  // Drive handleOutbound the same way other panel tests inject client.onMessage.
  // Send:
  {
    kind: "mcpOperation",
    requestId: "auth-1",
    result: {
      ok: true,
      authorizeUrl: "https://idp.example/authorize?client_id=issued",
    },
  }
  expect(openExternal).toHaveBeenCalledWith(
    expect.objectContaining({ toString: expect.any(Function) }),
  );
  expect(openExternal.mock.calls[0][0].toString()).toBe(
    "https://idp.example/authorize?client_id=issued",
  );
  // And the webview still received the same message.
});

it("does not open the browser for an ordinary MCP upsert", async () => {
  // mcpOperation ok:true with detail and no authorizeUrl
  expect(openExternal).not.toHaveBeenCalled();
});
```

Follow the existing panel test’s way of constructing `DshChatProvider` and faking `client.onMessage`. If `Uri.parse` is required, implement it in the mock as shown.

- [ ] **Step 2: Run panel tests; confirm red**

Run: `pnpm --filter dsh exec vitest run src/webview/panel.test.ts`

Expected: FAIL — `openExternal` never called.

- [ ] **Step 3: Implement `handleOutbound`**

```ts
if (
  m.kind === "mcpOperation"
  && m.result.ok
  && m.result.authorizeUrl !== undefined
) {
  void vscode.env.openExternal(vscode.Uri.parse(m.result.authorizeUrl));
}
this.updateStatus(m);
this.view?.webview.postMessage(m);
```

Do not fetch the URL. Do not block posting the message on `openExternal` settling.

- [ ] **Step 4: Re-run panel tests**

Run: `pnpm --filter dsh exec vitest run src/webview/panel.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit-ready checkpoint** — host openExternal.

---

### Task 6: Webview Add & Authorize and detail Authorize

**Files:**
- Modify: `packages/extension/src/webview/media/settings/sections/mcp/McpController.ts`
- Test: `McpController.test.ts`
- Modify: `McpServerEditor.tsx` + `McpServerEditor.test.tsx`
- Modify: `McpServerDetail.tsx` + `McpServerDetail.test.tsx`
- Modify: `McpSection.tsx`
- Modify: `localization/en.ts`, `localization/zh.ts`
- Modify: remaining fixtures that still omit `authorization` (`App.test.tsx`, `reducer.test.ts`, `McpSection.test.tsx`, `McpServerList.test.tsx`, `panel.test.ts` view fixture)

**Interfaces:**
- Consumes: `oauth.authorization`, `oauth.discovery`; operations `provisionOAuthServer` and `startOAuth`
- Produces: controller methods `provisionOAuth()` and `startOAuth(serverId)`; snapshot `authorizing: boolean`

Copy keys (identical in `en.ts` / `zh.ts`):

| key | en | zh |
|---|---|---|
| `mcpAddAndAuthorize` | Add & Authorize | 添加并授权 |
| `mcpAuthorize` | Authorize | 授权 |
| `mcpAuthorizing` | Opening the identity provider… | 正在打开身份提供方… |
| `mcpWaitingAuthorization` | Waiting for authorization in the browser… | 正在浏览器中等待授权… |
| `mcpOAuthLoopbackHint` | Callback origin (register this URI plus Redirect path if the provider has no dynamic registration): | 回调源（若提供方不支持动态注册，请将此地址与重定向路径一并登记）： |
| `mcpOAuthNote` | *(keep DSH Web note; only shown when `authorization === "unavailable"`)* | existing zh |

- [ ] **Step 1: Write failing controller tests**

```ts
it("sends provisionOAuthServer from name and URL without OAuth field completeness", () => {
  const { controller, sent } = bench();
  controller.openCreate();
  controller.setEditorField("transport", "streamable-http");
  controller.setEditorField("serverName", "glean");
  controller.setEditorField("url", "https://mcp.example/mcp");
  controller.setEditorField("auth", {
    kind: "oauth", clientId: "", authorizeUrl: "", tokenUrl: "", scopes: [], redirectPath: "/callback",
  });
  expect(controller.provisionOAuth()).toBe(true);
  expect(sent).toEqual([{
    kind: "runMcpOperation",
    requestId: "mcp-1",
    operation: {
      kind: "provisionOAuthServer",
      serverName: "glean",
      url: "https://mcp.example/mcp",
      enabled: true,
    },
  }]);
});

it("refuses provision when authorization or discovery is unavailable", () => {
  // updateView with authorization: "unavailable" or discovery: "unavailable"
  expect(controller.provisionOAuth()).toBe(false);
  expect(sent).toEqual([]);
});

it("sends startOAuth for an existing server", () => {
  controller.select("server-1");
  expect(controller.startOAuth()).toBe(true);
  expect(sent[0]).toMatchObject({
    operation: { kind: "startOAuth", serverId: "server-1" },
  });
});
```

On success `receiveOperation` with `authorizeUrl`, snapshot `authorizing` stays true until the next list/detail shows connected **or** the operator closes the editor. Simplest rule that matches the spec: set `authorizing` true when sending, clear it on operation **failure**, keep it true on success (waiting for poll). Clear it in `closeEditor`, `unavailable`, `disconnect`.

- [ ] **Step 2: Run controller tests; confirm red**

Run: `pnpm --filter dsh exec vitest run src/webview/media/settings/sections/mcp/McpController.test.ts`

Expected: FAIL — methods missing.

- [ ] **Step 3: Implement controller + UI**

`McpSnapshot` already has `oauthDiscovery`. Add:

```ts
oauthAuthorization: "available" | "unavailable";
oauthOrigin?: string;
authorizing: boolean;
```

Derive `oauthAuthorization` / `oauthOrigin` from `view.oauth`.

`provisionOAuth()`:
- editor open, connected, transport `streamable-http`, auth `oauth`
- `view.oauth.authorization === "available"` and `discovery === "available"`
- `serverName.trim()` and `url.trim()` non-empty
- not `ownerBusy`
- send `provisionOAuthServer` with `enabled: editor.enabled`
- do **not** require `editorValid()` / clientId

`startOAuth()`:
- selected server, `authorization === "available"`, auth kind oauth on the list item or detail
- send `{ kind: "startOAuth", serverId }`

Editor: show **Add & Authorize** when `oauthAuthorization === "available"` && `oauthDiscovery === "available"` && transport HTTP && auth oauth. Enabled when name and URL non-empty and not busy/authorizing. Label switches to `mcpAuthorizing` / `mcpWaitingAuthorization` from snapshot.

Detail: **Authorize** button when `oauthAuthorization === "available"` && server.auth.kind === `"oauth"`. Show `mcpOAuthNote` only when `oauthAuthorization === "unavailable"`. When loopback, show `mcpOAuthLoopbackHint` plus `<code>{origin}{redirectPath}</code>` under Advanced in the editor (origin from snapshot).

Pass `oauthAuthorization` and `oauthOrigin` into the editor from `McpSection` like `oauthDiscovery`.

Fix **every** `McpSettingsView` fixture in the extension package: add `authorization: "unavailable"` to manual oauth objects. Typecheck will list them.

Editor tests:
- Add & Authorize visible/enabled for name+URL when flags available
- hidden when `authorization: "unavailable"`
- click sends `provisionOAuthServer` only
- Redirect path still defaults to `/callback`

Detail tests:
- Authorize present for loopback view
- OAuth note absent then
- Authorize absent for manual view; note present

- [ ] **Step 4: Typecheck and extension tests**

Run: `cd /Users/anhtra/workspace/dsh-vscode-extension && pnpm -r typecheck && pnpm -r test`

Expected: all packages PASS. If wire-bounds node counts shifted, fix them in this task’s leftover (or Task 7 if you split). Prefer fixing bounds here if typecheck/tests fail on 36875-style comments.

- [ ] **Step 5: Commit-ready checkpoint** — webview.

---

### Task 7: Wire-bounds arithmetic and smoke

**Files:**
- Modify: `packages/bridge/test/settings-wire-bounds.test.ts`
- Modify: comments on `MAX_MCP_LIST_VIEW_NODES` in `mcp.ts` and the 2026-08-23 spec node footnote if they still cite 36,875

- [ ] **Step 1: Run the bounds test**

Run: `pnpm --filter @dsh-vscode/bridge exec vitest run test/settings-wire-bounds.test.ts`

Expected: either PASS or a precise off-by-N from the extra `authorization` / `origin` nodes. Update the expected counts and comments to the measured values. Do not raise `MAX_MCP_LIST_VIEW_NODES` unless the maximal view exceeds 40,960.

Confirm `SETTINGS_WIRE_SCAN_NODE_LIMIT` still exceeds maximal MCP list message.

- [ ] **Step 2: Rebuild**

Run: `cd /Users/anhtra/workspace/dsh-vscode-extension && pnpm -r build`

Expected: PASS.

- [ ] **Step 3: Manual smoke (operator machine)**

1. Reload the VS Code window so it spawns a new `dsh --profile vscode`.
2. Confirm the profile `cordis.patch.yml` has `serveManagementHttpApi: false`.
3. Add MCP server: streamable HTTP, OAuth, name + URL of a registering server (e.g. `https://maas.prd.astra.nvidia.com/maas/glean/mcp`).
4. Click **Add & Authorize**. Browser opens; after login the callback page says success; the editor list shows the new server connecting/connected.
5. Confirm Advanced still works for a pre-registered client id.
6. Confirm `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/mcp-management/servers` is `404` when the overlay is present. Find `<port>` from the settings view’s loopback origin.

- [ ] **Step 4: Commit-ready checkpoint** — bounds + smoke notes.

---

## Spec coverage

| Spec section | Task |
|---|---|
| Loopback vscode webserver, no web-app | 4 |
| `serveManagementHttpApi` false, callbacks only | 1, 4 |
| `oauthRedirectOrigin()` probe | 1, 3 |
| Wire `McpOAuthSupportWire` + operations + `authorizeUrl` | 2 |
| provision order discover → upsert → setSecrets → startOAuth; no upsert on empty client id | 3 |
| Secret never on NDJSON | 3 |
| Host `openExternal` | 5 |
| Add & Authorize / Authorize UI, Advanced remains, DSH Web note only if unavailable | 6 |
| Failure table | 3 (rejects), 6 (disabled buttons) |
| README / 2026-08-23 supersession | 4 |
| Bounds | 7 |
| Deferrals (stable port, push on callback, Codespaces) | none — deferred |

## Placeholder scan

No TBD/TODO in tasks. Secret-error path for provision `setSecrets` is “copy the existing `setServerSecrets` generic helper in `mcp.ts`”, not a vague “handle errors”.

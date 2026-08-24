# DSH VS Code MCP OAuth Onboarding Design

## Status

Approved in chat on 2026-08-24. This document supersedes the OAuth deferrals in [2026-08-23-dsh-vscode-plugin-settings-design.md](2026-08-23-dsh-vscode-plugin-settings-design.md) sections 1 (non-goals that forbid a vscode-profile web server and authorization launch), 3 (`startOAuth` absent from the bridge), 5 (“OAuth in this phase”), 14 items 1–2, and acceptance criterion 7. The rest of that design remains authoritative.

This is a cross-repository design. It changes `/Users/anhtra/workspace/dsh-mcp-management` and `/Users/anhtra/workspace/dsh-vscode-extension`. It does not change DSH Web’s existing authorize-and-callback path.

## 1. Goal and non-goals

### Goal

A VS Code user adding an MCP HTTP server that publishes OAuth discovery (RFC 9728 / RFC 8414) and Dynamic Client Registration (RFC 7591) enters a server name and URL, clicks one control, signs in in the system browser, and returns to a connected server. Client ID, authorize URL, token URL, scopes, redirect path, and any registration-issued client secret are produced and stored by the plugin. They never appear as required inputs on the default path.

### Non-goals

- Do not mount `@deepseek-ai/dsh-web-app`, a browser client runtime, or a public origin. The vscode profile still has no product UI on HTTP.
- Do not implement the authorization-code exchange in the extension host or webview. Token exchange, PKCE, and secret storage stay in `dsh-mcp-management`.
- Do not send a client secret, access token, refresh token, or authorization code over the NDJSON settings protocol.
- Do not require DSH Web for the default path.
- Do not replace Advanced OAuth fields. Providers without discovery or registration still need them.
- Do not persist a callback port across `dsh` restarts in this phase. Dynamic Client Registration binds the current loopback origin.

### Success criteria

1. For a server that advertises protected-resource metadata, authorization-server metadata, and a registration endpoint, the operator supplies only name and URL in VS Code and completes login in the system browser.
2. After a successful callback, the catalog record is OAuth-configured, tokens are stored in the plugin secret store, and an enabled server is connecting or connected in the editor’s `dsh` child.
3. A registration-issued client secret is written with `setSecrets` inside the child process and never appears in an outbound settings message, reducer state, controller snapshot, log, or test snapshot.
4. A vscode-profile loopback listener exists only on `127.0.0.1` and does not serve the `/mcp-management` catalog and secret API that DSH Web uses.
5. When discovery, registration, or a callback origin is unavailable, the editor says so and leaves Advanced fields editable; it never claims OAuth is unsupported.

## 2. Why a loopback server belongs in the vscode profile

Authorization-code OAuth needs a redirect URI the identity provider can call. The plugin already names that URI as `http://127.0.0.1:<webServer.port>` plus the record’s `redirectPath` (default `/callback`), and already registers callback routes when `ctx.webServer` exists. DSH Web works because `@deepseek-ai/dsh-web-app` mounts `dsh-host-webserver`. The vscode profile omitted that plugin, so `discoverOAuth` skipped registration and `startOAuth` threw.

VS Code URI handlers (`vscode://…`) are not an HTTP redirect URI. Many identity providers, including the Azure-fronted MaaS gateway used in this workspace, advertise `registration_endpoint` and `token_endpoint_auth_methods_supported: ["client_secret_post"]` and expect an `http` loopback redirect. An extension-owned HTTP server would duplicate the plugin’s callback parser, PKCE pending map, and completion page.

Therefore the vscode profile mounts `@deepseek-ai/dsh-host-webserver` on `127.0.0.1` with `port: 0` (OS-assigned). The MCP plugin keeps owning callbacks. The extension never listens.

## 3. Process layout

```
webview                  extension host                 dsh --profile vscode
  Add & Authorize   →    opaque relay              →    vscode-runner
  Waiting…          ←    openExternal(authorizeUrl) ←    mcp.discoverOAuth
                                                        mcp.upsert
                                                        mcp.setSecrets (client secret, in-process)
                                                        mcp.startOAuth
system browser  ──────────────────────────────────────►  webServer 127.0.0.1:<ephemeral>
                                                          GET /callback → mcp.handleOAuthCallback
                                                          completion HTML
```

The webview never fetches the loopback origin. The extension host opens the authorization URL with `vscode.env.openExternal` when it sees a validated outbound authorization message, then forwards that message to the webview so the editor can show progress.

## 4. Plugin changes (`dsh-mcp-management`)

### Loopback origin

Keep `oauthRedirectOrigin(publicOrigin, webServer)`. After the vscode profile mounts a web server, `ctx.get('webServer').port` names an origin and `discoverOAuth` / `startOAuth` stop throwing. The existing “skip registration when no origin” behavior remains for profiles that still have neither.

### Management HTTP API vs callbacks

`registerHttpApi` currently registers prefix `/mcp-management` (list, upsert, secrets, discover, start) and exact callback paths from `oauthCallbackPaths()`. Serving the prefix on the vscode profile would let any local process mutate the catalog and write secrets without the NDJSON bounds the extension uses.

Add manager config `serveManagementHttpApi`, default `true` so DSH Web is unchanged. When `false`, register only callback routes (exact `/callback` and every other catalog `redirectPath` not already under `/mcp-management`, plus exact `/mcp-management/oauth/callback` so a record that still uses the prefixed path keeps working). Do not register the `/mcp-management` prefix.

The vscode profile patch sets `serveManagementHttpApi: false` on `mcp-mgmt-manager`.

### Optional origin probe

Add `oauthRedirectOrigin(): string | undefined` on the runtime (not a throw). The bridge reports authorization as available only when this returns a string and `startOAuth` is a function. Absence is not an error.

### Dynamic Client Registration secret

`discoverOAuth` may still return `clientSecret` to in-process callers. The vscode easy path must persist that value before `startOAuth`, because token-endpoint auth method `client_secret_post` requires it. Persistence is `setSecrets(id, { OAUTH_CLIENT_SECRET: secret })` after `upsert`, still inside the child. The webview protocol continues to omit the secret and uses `clientSecretIssued` only when a human must type it on the Advanced path.

## 5. vscode profile composition

Insert the loopback server from the bridge patch, which every vscode profile already applies:

```yaml
- insert:
    - id: host-webserver
      name: '@deepseek-ai/dsh-host-webserver'
      config:
        host: '127.0.0.1'
        port: 0
```

`@dsh-vscode/bridge` depends on `@deepseek-ai/dsh-host-webserver` so the loader resolves the insert from the profile’s `node_modules`. Existing profiles that already list the bridge pick the listener up on the next install of that dependency. Do not add `@deepseek-ai/dsh-web-app`.

`host: '127.0.0.1'` is required. `0.0.0.0` would publish the callback listener on every interface.

`serveManagementHttpApi: false` cannot live in the bridge patch: that file is applied before the MCP bundle inserts `mcp-mgmt-manager`, and the overlay would miss. It belongs in the profile’s own `cordis.patch.yml`, which the loader applies last:

```yaml
- id: mcp-mgmt-manager
  config:
    serveManagementHttpApi: false
```

The extension README documents that row. If it is omitted, callbacks still work and the catalog HTTP API is reachable on loopback exactly as DSH Web already allows; that is a documented misconfiguration, not a silent fallback.

## 6. Wire protocol

Protocol version stays 6. Add closed members; bump only if a shipped v6 client is already in the wild that would mis-parse them. New kinds are additive, so keep 6 and reject unknown inbound kinds as today.

### Availability

`McpOAuthSupportWire` becomes:

```ts
type McpOAuthSupportWire =
  | {
      kind: "manual";
      reason: "no-callback-origin";
      discovery: "available" | "unavailable";
      authorization: "unavailable";
    }
  | {
      kind: "loopback";
      origin: string; // e.g. http://127.0.0.1:54321
      discovery: "available" | "unavailable";
      authorization: "available";
    };
```

`origin` is the callback origin without a path. The editor may show it under Advanced so an operator registering a client by hand copies a real URI (`origin + redirectPath`).

### Operations

Extend `McpOperationKind` (or the existing `runMcpOperation` operation union) with:

```ts
| {
    kind: "provisionOAuthServer";
    serverName: string;
    url: string;
    enabled: boolean;
  }
| { kind: "startOAuth"; serverId: string };
```

`provisionOAuthServer` is the easy path. The coordinator, in the child, in this order:

1. Refuse unless `oauthRedirectOrigin()` is a string and `discoverOAuth` exists.
2. `discoverOAuth(url)`.
3. Refuse unless `clientId` is non-empty (registration succeeded or the AS returned a client id). If discovery filled endpoints but no client id, return `mcp-rejected` with a message that Advanced is required, and do not upsert.
4. `upsert` an OAuth `streamable-http` record with discovered `clientId`, `authorizeUrl`, `tokenUrl`, `scopes`, `redirectPath: "/callback"`, and the requested name, URL, and enabled flag. Generate the id in the plugin as today.
5. If `clientSecret` is a non-empty string, `setSecrets(id, { OAUTH_CLIENT_SECRET })`.
6. `startOAuth(id)` and return `{ authorizeUrl, serverId }` on the operation result.

`startOAuth` re-authorizes an existing OAuth record (detail **Authorize**). It does not rediscover.

Do not put `authorizeUrl` on a separate outbound family if the existing `mcpOperation` success payload can carry optional `authorizeUrl` and `serverId` without leaking secrets. If the current success payload is only `{ ok, detail? }`, extend it with optional `authorizeUrl` (bounded URL string) used only for these two operations. The extension host opens any `mcpOperation` success that includes `authorizeUrl`.

### Bounds and redaction

- `authorizeUrl` max length is `MAX_WIRE_URL_LENGTH`.
- Outbound scan continues to forbid keys matching secret/token/code patterns. Add `code_verifier`, `client_secret`, and `refresh_token` if not already listed.
- Node-limit fixtures update if the OAuth support object gains `origin` / `authorization`.

## 7. Extension host

The host remains an opaque relay except: on an inbound-validated outbound `mcpOperation` with `result.ok === true` and a present `authorizeUrl`, call `vscode.env.openExternal` with that URL, then post the message to the webview. Failure to open the browser is reported to the webview as a host-side error string on the same request if the panel can correlate it; otherwise the webview already shows “Waiting for authorization” from the success payload, and the operator pastes the URL from a copy control.

Do not fetch the authorize or callback URLs in the host.

## 8. Webview

### Default create path

For `streamable-http` + `oauth`, the editor’s primary actions are **Save** (record only) and **Add & Authorize** (provision). **Add & Authorize** is enabled when name and URL are non-empty, the view reports `authorization: "available"` and `discovery: "available"`, and no operation is in flight. It sends `provisionOAuthServer` and does not require client ID, endpoints, or scopes.

OAuth fields, Discover, client secret, redirect path, headers, env, timeout, and reconnect stay behind **Advanced**. Advanced Save remains the current `upsertServer` path. Redirect path still defaults to `/callback`.

### Progress

While provision or start is in flight, the editor shows “Opening the identity provider…” then “Waiting for authorization in the browser…”. The plugin’s callback HTML is the browser-facing completion (“You can close this window”). The webview learns success from the next list/detail poll: status leaves `disconnected` and secret state for access/refresh becomes configured. Polling already runs at 2_000 ms; no new push family is required for this phase.

If the operator dismisses the editor, provision that already upserted remains in the catalog (possibly unauthorized). Closing the dialog does not roll back the record.

### Detail

When `authorization: "available"` and the server’s auth kind is `oauth`, show **Authorize** next to Connect. It sends `startOAuth`. Remove the “authorize from DSH Web” note in that case. When `authorization: "unavailable"`, keep the DSH Web note and hide **Authorize**.

Clear OAuth tokens stays as it is.

### Copy

English and Chinese keys for Add & Authorize, Authorize, waiting, provision failure, “discovery filled endpoints but registered no client — use Advanced”, and the loopback origin hint. Plugin error text stays verbatim.

## 9. Failure modes

| Condition | Result |
|---|---|
| No web server / no origin | `authorization: "unavailable"`; Add & Authorize hidden; Discover may still fill endpoints |
| Discovery finds no authorize/token endpoints | `mcp-rejected` with the plugin message; no upsert |
| Discovery finds endpoints, no client id | `mcp-rejected` telling the operator to paste a client ID in Advanced; no upsert |
| Registration issues a secret and `setSecrets` fails | Record exists; operation fails; Advanced client-secret retry remains |
| Operator closes the browser | Editor waits until they click Cancel or try Authorize again; pending PKCE state expires in the plugin as today |
| Callback on a stale port after `dsh` restart | New `startOAuth` uses the new origin; a client registered to the old port must be re-registered via provision or Advanced |
| Pre-registered client bound to another origin (DSH Web’s port) | Easy path cannot reuse that client id against a new loopback port; operator uses Advanced with that id only if the provider allows any loopback port, otherwise authorizes once in DSH Web and uses stored refresh tokens in VS Code |

## 10. Security

- Bind `127.0.0.1` only.
- Do not serve `/mcp-management` in the vscode profile.
- Callback handlers remain the plugin’s existing `state` + PKCE verifier check.
- `openExternal` receives only URLs that passed the wire URL validator.
- Secrets never cross NDJSON.

## 11. Testing

Plugin: `serveManagementHttpApi: false` registers `/callback` and does not register `/mcp-management` prefix; `true` keeps today’s API. Origin probe returns a string when a fake webServer has a port.

Bridge: provision happy path (discover → upsert → setSecrets → startOAuth) with a secret that never appears in the outbound message; provision refuses without origin; provision refuses empty client id without upsert; `startOAuth` on an existing id; availability projection.

Extension host: `openExternal` called once per success `authorizeUrl`; not called on ordinary upsert.

Webview: Add & Authorize enabled only with name+URL and both flags available; Advanced still required when authorization is unavailable; Authorize on detail; waiting copy; bilingual.

Wire bounds: updated node counts; secret-key scan on provision replies.

## 12. Implementation order

1. Plugin: `serveManagementHttpApi`, origin probe, tests.
2. vscode profile / bridge patch: mount webserver, set the flag, add the dependency.
3. Contract: OAuth support wire, operation kinds, `authorizeUrl` on success.
4. Bridge coordinator + host `openExternal`.
5. Webview primary action and detail Authorize.
6. README: vscode profile now listens on loopback for OAuth callbacks only.

## 13. Deferrals

- Stable callback port / `publicOrigin` in vscode so a pre-registered client survives `dsh` restart without DCR.
- Push notification when `handleOAuthCallback` completes (today the webview polls).
- PKCE pending-map TTL changes.
- Authorizing from a remote VS Code / Codespaces where loopback is not the operator’s browser. That environment needs a documented `publicOrigin` or remains on DSH Web.

# Final fix report — VS Code MCP OAuth onboarding

Date: 2026-08-24

## Landed fixes

- Included the Discover command/reply relay, nested settings dialog, MCP switch, list export, styles, focus support, implementation plan, design spec, and supersession updates required for a self-contained merge unit.
- Restricted host browser launches to parsed `http:` and `https:` authorize URLs while still forwarding rejected schemes to the webview.
- Retargeted a successfully provisioned create draft to the returned server id in edit mode so the same draft cannot provision a duplicate record.
- Auto-expanded Advanced when a manual OAuth-over-HTTP draft is invalid on fields hidden there, exposing field validation and the authorization-unavailable explanation.
- Replaced the README's plan-task reference with the `discoverOAuth`, `startOAuth`, and `oauthRedirectOrigin` capability names.

## Regression evidence

The I3, I4, and I5 tests failed for the reviewed behavior before the production fixes, then passed after the fixes.

## Verification

- `pnpm --filter dsh typecheck` — passed.
- `pnpm --filter @dsh-vscode/bridge typecheck` — passed.
- `pnpm --filter dsh exec vitest run src/webview/panel.test.ts src/webview/media/settings/sections/mcp/ src/webview/media/App.test.tsx` — 8 files, 203 tests passed.
- `pnpm --filter @dsh-vscode/bridge exec vitest run src/settings/mcp.test.ts test/commands.test.ts` — 2 files, 94 tests passed.
- `pnpm -r typecheck` — all contract, bridge, and extension typechecks passed.
- `git diff --check` — passed.

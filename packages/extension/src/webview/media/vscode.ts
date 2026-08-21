import type { InboundMessage, OutboundMessage } from "@dsh-vscode/contract";

/**
 * The extension↔webview message envelope. Webview→extension commands ride
 * `{ type: "dsh/ui", cmd }`; extension→webview posts raw `OutboundMessage`s.
 */
export interface UiCommand {
  type: "dsh/ui";
  cmd: InboundMessage;
}

export function isUiCommand(m: unknown): m is UiCommand {
  return (
    typeof m === "object" &&
    m !== null &&
    (m as { type?: unknown }).type === "dsh/ui" &&
    "cmd" in m
  );
}

/** Minimal shape of the ambient `acquireVsCodeApi()` provided in the webview. */
export interface Vscode {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  function acquireVsCodeApi(): Vscode;
}

/** Typed accessor for the VS Code webview host API (ambient in the bundled webview). */
export function acquireVsCodeApi(): Vscode {
  return globalThis.acquireVsCodeApi();
}

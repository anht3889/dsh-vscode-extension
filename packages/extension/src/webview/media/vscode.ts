import type {
  EncodedImageAttachment,
  InboundMessage,
  OutboundMessage,
} from "@dsh-vscode/contract";

/**
 * The payload of one webview→extension command. Either an
 * {@link InboundMessage}, which the panel forwards to the bridge unchanged, or
 * a host-only instruction the panel handles itself and never forwards — editor
 * edits (`apply`), modal confirmations, lifecycle (`webviewReady`), and the
 * native image dialog (`attachImage`).
 */
export type UiCommandCmd =
  | InboundMessage
  | { kind: "apply" }
  | { kind: "attachImage" }
  | { kind: "confirmNewChat" }
  | { kind: "confirmFullAccess" }
  | { kind: "webviewReady" };

/** Images selected and encoded by the extension host. */
export interface ImagesPickedMessage {
  kind: "imagesPicked";
  images: EncodedImageAttachment[];
}

/**
 * The extension↔webview message envelope. Webview→extension commands ride
 * `{ type: "dsh/ui", cmd }`; extension→webview posts raw `OutboundMessage`s.
 */
export interface UiCommand {
  type: "dsh/ui";
  cmd: UiCommandCmd;
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

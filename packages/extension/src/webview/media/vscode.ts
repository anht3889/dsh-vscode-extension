import type {
  EncodedImageAttachment,
  InboundMessage,
  OutboundMessage,
} from "@dsh-vscode/contract";

/**
 * A host-local command that never reaches the bridge. `cmd` carries either an
 * {@link InboundMessage} (forwarded to the bridge) or a host-only instruction
 * such as `{ kind: "apply" }` (apply accumulated diffs in the editor).
 */
export type UiCommandCmd =
  | InboundMessage
  | { kind: "apply" }
  | { kind: "browseFolder" }
  | { kind: "attachImage" }
  | { kind: "confirmNewChat" }
  | { kind: "confirmFullAccess" }
  | { kind: "webviewReady" };

/** A folder selected by the extension host, relative to the session workspace. */
export interface FolderPickedMessage {
  kind: "folderPicked";
  path: string;
}

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

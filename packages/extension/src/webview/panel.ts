import * as vscode from "vscode";
import type { ChildProcess } from "node:child_process";
import type { HelloMessage, InboundMessage, OutboundMessage, ToolDiff } from "@dsh-vscode/contract";
import { isInboundMessage, PROTOCOL_VERSION } from "@dsh-vscode/contract";
import { ProcessManager } from "../processManager.js";
import type { ProtocolClient } from "../protocolClient.js";
import { applyDiffs, diffsFromEvent } from "../applyEdits.js";
import { DecorationManager } from "../decorations.js";
import { nextStatus, type DshState } from "../statusBar.js";
import { encodeImageSelection, pickRelativeFolder } from "./attachments.js";
import type {
  FolderPickedMessage,
  ImagesPickedMessage,
} from "./media/vscode.js";

interface Running {
  client: ProtocolClient;
  child: ChildProcess;
  stop(): void;
}

export class DshChatProvider implements vscode.WebviewViewProvider {
  private readonly extensionUri: vscode.Uri;
  private readonly pm: ProcessManager;
  private readonly decorations: DecorationManager;
  private view: vscode.WebviewView | undefined;
  private running: Running | undefined;
  private startingChild = false;
  private startGeneration = 0;
  private status: DshState = "idle";
  private hello: HelloMessage | undefined;
  private readyCwd: string | undefined;
  private pending: ToolDiff[] = [];
  private currentSessionId: string | undefined;
  private fullAccessConfirmedFor: string | undefined;

  constructor(extensionUri: vscode.Uri, pm: ProcessManager) {
    this.extensionUri = extensionUri;
    this.pm = pm;
    this.decorations = new DecorationManager();
  }

  dispose(): void {
    this.decorations.dispose();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const nonce = this.newNonce();
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    view.webview.html = this.renderHtml(view.webview, nonce);
    view.webview.onDidReceiveMessage((msg: unknown) => this.onUiCommand(msg));
  }

  onUiCommand(msg: unknown): void {
    // Webview -> extension: bridge commands plus host-owned UI actions.
    if (typeof msg !== "object" || msg === null || !("type" in msg)) return;
    const type = (msg as { type?: unknown }).type;
    if (type !== "dsh/ui") return;
    const cmd = (msg as { cmd?: unknown }).cmd;
    const kind =
      typeof cmd === "object" && cmd !== null
        ? (cmd as { kind?: unknown }).kind
        : undefined;

    // Host-local "apply": the extension owns the editor, so apply accumulated
    // diffs here and never forward to the bridge.
    if (kind === "apply") {
      void this.applyPending();
      return;
    }

    if (kind === "confirmFullAccess") {
      void this.confirmFullAccess();
      return;
    }

    if (kind === "webviewReady") {
      if (this.running && this.currentSessionId !== undefined) {
        this.running.client.send({
          kind: "resume",
          sessionId: this.currentSessionId,
        });
      } else if (!this.running) {
        void this.startActiveFolder();
      }
      return;
    }

    if (kind === "confirmNewChat") {
      void this.confirmNewChat();
      return;
    }

    if (kind === "browseFolder") {
      void this.browseFolder();
      return;
    }

    if (kind === "attachImage") {
      void this.attachImages();
      return;
    }

    if (!isInboundMessage(cmd)) return;
    if (!this.running) return;
    this.running.client.send(cmd);
  }

  private async applyPending(): Promise<void> {
    const ok = await applyDiffs(this.pending);
    if (ok) {
      this.decorations.markTouched(this.pending.map((d) => d.path));
      this.pending = [];
    }
  }

  private async browseFolder(): Promise<void> {
    const result = await pickRelativeFolder(
      async () => {
        const selected = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
        });
        return selected?.[0]?.fsPath;
      },
      () => this.readyCwd ?? this.hello?.cwd,
    );
    if (result.kind === "cancelled" || result.kind === "unavailable") return;
    if (result.kind === "outside") {
      this.view?.webview.postMessage({
        kind: "status",
        state: "error",
        detail: "Folder is outside the session workspace",
      });
      return;
    }
    const message: FolderPickedMessage = {
      kind: "folderPicked",
      path: result.path,
    };
    this.view?.webview.postMessage(message);
  }

  private async attachImages(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      filters: { Images: ["png", "jpg", "jpeg", "webp", "gif"] },
    });
    const { images, failed } = await encodeImageSelection(
      selected,
      async (uri) => vscode.workspace.fs.readFile(uri),
    );
    for (const name of failed) {
      this.view?.webview.postMessage({
        kind: "status",
        state: "error",
        detail: `Failed to attach ${name}`,
      });
    }
    if (images.length === 0) return;
    const message: ImagesPickedMessage = { kind: "imagesPicked", images };
    this.view?.webview.postMessage(message);
  }

  private async confirmNewChat(): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      "Cancel the current turn and start a new chat?",
      { modal: true },
      "Start new chat",
    );
    if (choice !== "Start new chat" || !this.running) return;
    this.running.client.send({ kind: "cancel", cause: "user" });
    this.running.client.send({ kind: "newSession" });
  }

  private async confirmFullAccess(): Promise<void> {
    if (!this.running || this.currentSessionId === undefined) return;
    const sessionId = this.currentSessionId;
    if (this.fullAccessConfirmedFor !== sessionId) {
      const choice = await vscode.window.showWarningMessage(
        "Full Access disables sandbox confinement and approval prompts for this chat.",
        { modal: true },
        "Enable Full Access",
      );
      if (
        choice !== "Enable Full Access" ||
        !this.running ||
        this.currentSessionId !== sessionId
      ) {
        return;
      }
      this.fullAccessConfirmedFor = sessionId;
    }
    this.running.client.send({
      kind: "selectPermission",
      preset: "danger-full-access",
    });
  }

  async startActiveFolder(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) {
      // No workspace folder open — surface this as a visible error instead of
      // silently returning, which left the user wondering why chat did nothing.
      this.view?.webview.postMessage({
        kind: "status",
        state: "error",
        detail: "No workspace folder open. Open a folder first, then run DSH: Start.",
      });
      return;
    }
    if (this.running || this.startingChild) return;

    const generation = ++this.startGeneration;
    this.startingChild = true;
    this.view?.webview.postMessage({
      kind: "status",
      state: "thinking",
      detail: "Starting…",
    });
    try {
      const running = await this.pm.start(folder);
      if (generation !== this.startGeneration) {
        running.stop();
        return;
      }
      this.running = running;
      running.client.onMessage((m: OutboundMessage) => this.handleOutbound(m));

      // Post-boot crashes (the handshake already arrived, but dsh exits later) are
      // surfaced here. Spawn errors and handshake timeouts already rejected `start()`
      // and are handled by the `catch` below.
      running.child.on("exit", (code, signal) => {
        const wasCurrent = this.running?.child === running.child;
        if (wasCurrent) {
          this.running = undefined;
        }
        if (!wasCurrent && code === 0 && !signal) return;
        const detail =
          code !== null
            ? `dsh process exited with code ${code}`
            : `dsh process terminated by ${signal ?? "signal"}`;
        this.view?.webview.postMessage({
          kind: "hostDisconnected",
          detail,
        });
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.view?.webview.postMessage({ kind: "status", state: "error", detail });
      return;
    } finally {
      this.startingChild = false;
    }
  }

  async stop(): Promise<void> {
    this.startGeneration += 1;
    const running = this.running;
    this.running = undefined;
    this.currentSessionId = undefined;
    this.fullAccessConfirmedFor = undefined;
    this.readyCwd = undefined;
    if (running) await running.stop();
  }

  private handleOutbound(m: OutboundMessage): void {
    // Version handshake is host-only: record it, do not forward to the webview.
    if (m.kind === "hello") {
      this.hello = m;
      if (m.version !== PROTOCOL_VERSION) {
        console.warn(
          `[dsh] protocol version mismatch: bridge=${m.version} extension=${PROTOCOL_VERSION}`,
        );
      }
      this.updateStatus(m);
      return;
    }

    // Accumulate diffs from tool/result events (cleared on the next turn/start).
    if (
      m.kind === "event" &&
      (this.currentSessionId === undefined ||
        m.sessionId === this.currentSessionId)
    ) {
      if (m.event.type === "turn/start") this.pending = [];
      if (m.event.type === "tool/result") {
        this.pending.push(...diffsFromEvent(m.event));
      }
    }
    if (m.kind === "session" || m.kind === "ready") {
      if (this.currentSessionId !== m.sessionId) {
        this.fullAccessConfirmedFor = undefined;
      }
      this.currentSessionId = m.sessionId;
    }
    if (m.kind === "ready") {
      this.readyCwd = m.cwd;
    }

    this.updateStatus(m);
    this.view?.webview.postMessage(m);
  }

  private updateStatus(m: OutboundMessage): void {
    if (m.kind === "status") {
      this.status = m.state;
    } else {
      this.status = nextStatus(this.status, m).state;
    }
  }

  private renderHtml(webview: vscode.Webview, nonce: string): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "style.css"),
    );
    // CSP: the bundled script is an *external* resource, so `script-src` must
    // allow the webview resource origin in addition to the nonce ('nonce' alone
    // only authorises inline scripts). Allow images/fonts/connections to the same
    // origin (plus data: images). default-src 'none' keeps everything else locked.
    //
    // `#root` ships with static placeholder text that React replaces on mount, and
    // the inline listener reports load and evaluation failures into the same node.
    // A host that cannot run or fetch the bundle therefore shows a reason rather
    // than an empty panel, which is indistinguishable from a hung agent.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; connect-src ${webview.cspSource} https:;"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="root"><p class="dsh-boot">Loading DSH\u2026</p></div>
  <script nonce="${nonce}">
    // Capture phase: resource load failures fire on the element and do not bubble.
    window.addEventListener("error", function (event) {
      var root = document.getElementById("root");
      if (root === null) return;
      var target = event.target;
      var detail =
        target && target.tagName === "SCRIPT"
          ? "could not load " + (target.src || "the webview bundle")
          : event.message || String(event.error || "unknown error");
      root.textContent = "DSH webview failed to start: " + detail;
    }, true);
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private newNonce(): string {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}

import * as vscode from "vscode";
import type { InboundMessage, OutboundMessage } from "@dsh-vscode/contract";
import { isInboundMessage } from "@dsh-vscode/contract";
import { ProcessManager } from "../processManager.js";
import type { ProtocolClient } from "../protocolClient.js";
import { nextStatus, type DshState } from "../statusBar.js";

interface Running {
  client: ProtocolClient;
  stop(): Promise<void>;
}

export class DshChatProvider implements vscode.WebviewViewProvider {
  private readonly extensionUri: vscode.Uri;
  private readonly pm: ProcessManager;
  private view: vscode.WebviewView | undefined;
  private running: Running | undefined;
  private status: DshState = "idle";

  constructor(extensionUri: vscode.Uri, pm: ProcessManager) {
    this.extensionUri = extensionUri;
    this.pm = pm;
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
    // Webview -> extension: { type: "dsh/ui", cmd: InboundMessage }
    if (typeof msg !== "object" || msg === null || !("type" in msg)) return;
    const type = (msg as { type?: unknown }).type;
    if (type !== "dsh/ui") return;
    const cmd = (msg as { cmd?: unknown }).cmd;
    if (!isInboundMessage(cmd)) return;
    if (!this.running) return;
    this.running.client.send(cmd);
  }

  async startActiveFolder(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) return;
    if (this.running) return;
    const running = await this.pm.start(folder);
    this.running = running;
    running.client.onMessage((m: OutboundMessage) => this.handleOutbound(m));
    if (this.view) {
      this.view.webview.postMessage({ kind: "status", state: "idle", detail: "dsh started" });
    }
  }

  async stop(): Promise<void> {
    const running = this.running;
    this.running = undefined;
    if (running) await running.stop();
  }

  private handleOutbound(m: OutboundMessage): void {
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
    // CSP: allow only the bundled script (nonce-bearer) and the webview resource
    // origin; no inline scripts; styles/self limited to the webview host.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="root"></div>
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

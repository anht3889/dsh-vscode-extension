import * as vscode from "vscode";
import type { InboundMessage, OutboundMessage } from "@dsh-vscode/contract";
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
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = this.renderHtml();
    view.webview.onDidReceiveMessage((msg: InboundMessage) => this.onUiCommand(msg));
  }

  onUiCommand(msg: InboundMessage): void {
    if (!this.running) return;
    this.running.client.send(msg);
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

  private renderHtml(): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>DSH repl placeholder</body></html>`;
  }
}

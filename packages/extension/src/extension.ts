import * as vscode from "vscode";
import { ProcessManager } from "./processManager.js";
import { DshChatProvider } from "./webview/panel.js";

export function activate(context: vscode.ExtensionContext): void {
  const pm = new ProcessManager({
    resolveBinary: () => vscode.workspace.getConfiguration("dsh").get<string>("binaryPath") || "dsh",
    argsFor: () => ["--profile", "vscode"],
    onStderr: (t) => console.error("[dsh]", t.trimEnd()),
  });
  const provider = new DshChatProvider(context.extensionUri, pm);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("dsh.chat", provider),
    vscode.commands.registerCommand("dsh.start", () => { void provider.startActiveFolder(); }),
    vscode.commands.registerCommand("dsh.stop", () => { void provider.stop(); }),
    new vscode.Disposable(() => provider.dispose()),
  );
}

export function deactivate(): void {}

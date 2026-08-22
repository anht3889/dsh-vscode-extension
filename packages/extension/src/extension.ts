import * as vscode from "vscode";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProcessManager } from "./processManager.js";
import { DshChatProvider } from "./webview/panel.js";

/** Resolve `dsh` to an absolute path when the setting is empty, probing the same
 *  locations a shell-launched VS Code would find. The extension host inherits the
 *  GUI-launched VS Code's PATH, which typically lacks nvm/brew-managed binaries. */
function resolveDsh(): string {
  const configured = vscode.workspace.getConfiguration("dsh").get<string>("binaryPath");
  if (configured) return configured;

  // Probe the same locations `which dsh` finds from a shell — absolute paths so
  // `spawn()` does not rely on the extension-host PATH.
  const home = homedir();
  const candidates = [
    // nvm (node version manager) — the most common dsh install location
    join(home, ".nvm/versions/node/v24.15.0/bin/dsh"),
    join(home, ".nvm/versions/node/v22.19.0/bin/dsh"),
    join(home, ".nvm/versions/node/v20.19.0/bin/dsh"),
    // brew (macOS)
    "/opt/homebrew/bin/dsh",
    "/usr/local/bin/dsh",
    // system / usr-local
    "/usr/local/bin/dsh",
    // fallback: bare name (relies on extension-host PATH, may fail silently)
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Last resort: bare "dsh" — if the extension host lacks it on PATH the spawn
  // will emit ENOENT, which `ProcessManager.start()` converts to a visible error.
  return "dsh";
}

export function activate(context: vscode.ExtensionContext): void {
  const pm = new ProcessManager({
    resolveBinary: resolveDsh,
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

  // Auto-start DSH when a workspace folder is open, so the user doesn't have to
  // run the command manually every session. Fire-and-forget: activate() is sync,
  // and startActiveFolder() handles its own errors (posts them to the webview).
  if (vscode.workspace.workspaceFolders?.[0]) {
    void provider.startActiveFolder();
  }
}

export function deactivate(): void {}

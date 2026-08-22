import * as vscode from "vscode";
import { existsSync, readdirSync } from "node:fs";
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
  const nvmRoot = join(home, ".nvm/versions/node");
  let nvmCandidates: string[] = [];
  try {
    nvmCandidates = readdirSync(nvmRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(nvmRoot, entry.name, "bin/dsh"));
  } catch {
    // A missing or unreadable nvm directory simply removes that lookup source.
  }
  const candidates = [
    ...nvmCandidates,
    // brew (macOS)
    "/opt/homebrew/bin/dsh",
    "/usr/local/bin/dsh",
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
    vscode.window.registerWebviewViewProvider("dsh.chat", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
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

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

/** The activation's process manager, kept for `deactivate()` to shut its
 *  children down. Undefined outside an activated extension host. */
let managed: ProcessManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const pm = new ProcessManager({
    resolveBinary: resolveDsh,
    argsFor: () => ["--profile", "vscode"],
    resolveHandshakeTimeoutMs: () =>
      vscode.workspace
        .getConfiguration("dsh")
        .get<number>("handshakeTimeoutMs", 30_000),
    onStderr: (t) => console.error("[dsh]", t.trimEnd()),
  });
  managed = pm;
  const provider = new DshChatProvider(context.extensionUri, pm);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("dsh.chat", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("dsh.start", () => { void provider.startActiveFolder(); }),
    vscode.commands.registerCommand("dsh.stop", () => { void provider.stop(); }),
    new vscode.Disposable(() => provider.dispose()),
  );

  // DSH starts when the chat view is first shown (the webview announces itself
  // and the provider starts the child), not here. Starting at activation spawned
  // a full runtime in every window whose sidebar restored this view — they then
  // contended for the same machine — and any startup error was posted before a
  // webview existed to display it.
}

/** Terminate every `dsh` child before the extension host goes away. VS Code
 *  awaits the returned promise, so this is the last chance to avoid leaving a
 *  full DSH runtime running with no editor attached. */
export async function deactivate(): Promise<void> {
  const pm = managed;
  managed = undefined;
  await pm?.stopAll();
}

import path from "node:path";
import * as vscode from "vscode";

export interface ExtensionSettingsView {
  binaryPath: string;
  handshakeTimeoutMs: number;
}

export interface SettingsHost {
  read(): ExtensionSettingsView;
  write(view: ExtensionSettingsView): Promise<void>;
  openExtensionSettings(): Promise<void>;
  openTrustedPath(path: string, mode: "open" | "reveal"): Promise<void>;
}

interface ConfigurationSource {
  target: vscode.ConfigurationTarget;
  value: unknown;
}

function sourceFor(
  inspected: ReturnType<vscode.WorkspaceConfiguration["inspect"]>,
): ConfigurationSource {
  if (inspected?.workspaceFolderValue !== undefined) {
    return {
      target: vscode.ConfigurationTarget.WorkspaceFolder,
      value: inspected.workspaceFolderValue,
    };
  }
  if (inspected?.workspaceValue !== undefined) {
    return {
      target: vscode.ConfigurationTarget.Workspace,
      value: inspected.workspaceValue,
    };
  }
  if (inspected?.globalValue !== undefined) {
    return {
      target: vscode.ConfigurationTarget.Global,
      value: inspected.globalValue,
    };
  }
  return {
    target: vscode.ConfigurationTarget.Global,
    value: undefined,
  };
}

function validate(view: ExtensionSettingsView): void {
  if (typeof view.binaryPath !== "string") {
    throw new TypeError("DSH binary path must be a string");
  }
  if (
    !Number.isInteger(view.handshakeTimeoutMs) ||
    view.handshakeTimeoutMs < 1_000 ||
    view.handshakeTimeoutMs > 300_000
  ) {
    throw new RangeError(
      "DSH handshake timeout must be a whole number from 1000 to 300000",
    );
  }
}

export class PartialExtensionSettingsWriteError extends Error {
  constructor(
    message: string,
    readonly actual: ExtensionSettingsView,
  ) {
    super(message);
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class VsCodeSettingsHost implements SettingsHost {
  read(): ExtensionSettingsView {
    const config = vscode.workspace.getConfiguration("dsh");
    const view = {
      binaryPath: config.get<unknown>("binaryPath", ""),
      handshakeTimeoutMs: config.get<unknown>("handshakeTimeoutMs", 30_000),
    };
    validate(view as ExtensionSettingsView);
    return view as ExtensionSettingsView;
  }

  async write(view: ExtensionSettingsView): Promise<void> {
    validate(view);
    const config = vscode.workspace.getConfiguration("dsh");
    const current = this.read();
    const changes = [
      {
        key: "binaryPath",
        next: view.binaryPath,
        current: current.binaryPath,
        source: sourceFor(config.inspect("binaryPath")),
      },
      {
        key: "handshakeTimeoutMs",
        next: view.handshakeTimeoutMs,
        current: current.handshakeTimeoutMs,
        source: sourceFor(config.inspect("handshakeTimeoutMs")),
      },
    ].filter((change) => change.next !== change.current);
    const succeeded: typeof changes = [];
    for (const change of changes) {
      try {
        await config.update(change.key, change.next, change.source.target);
        succeeded.push(change);
      } catch (writeError) {
        let rollback:
          | { key: string; error: unknown }
          | undefined;
        for (const applied of [...succeeded].reverse()) {
          try {
            await config.update(
              applied.key,
              applied.source.value,
              applied.source.target,
            );
          } catch (rollbackError) {
            rollback ??= { key: applied.key, error: rollbackError };
          }
        }
        if (rollback === undefined) throw writeError;
        const actual = this.read();
        throw new PartialExtensionSettingsWriteError(
          `Failed to update ${change.key}: ${errorDetail(writeError)}; ` +
            `rollback of ${rollback.key} failed: ${errorDetail(rollback.error)}. ` +
            "Extension settings are partially written.",
          actual,
        );
      }
    }
  }

  async openExtensionSettings(): Promise<void> {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "@ext:dsh.dsh",
    );
  }

  async openTrustedPath(
    trustedPath: string,
    mode: "open" | "reveal",
  ): Promise<void> {
    if (!path.isAbsolute(trustedPath)) {
      throw new Error("Expected an absolute local path");
    }
    const uri = vscode.Uri.file(trustedPath);
    if (uri.scheme !== "file") {
      throw new Error("Expected an absolute local path");
    }
    if (mode === "reveal") {
      await vscode.commands.executeCommand("revealFileInOS", uri);
      return;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
  }
}

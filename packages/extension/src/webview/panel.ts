import * as vscode from "vscode";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import type {
  InboundMessage,
  OutboundMessage,
  ResolveSettingsPathTargetWire,
  SettingsPathMessage,
  ToolDiff,
} from "@dsh-vscode/contract";
import { isInboundMessage, PROTOCOL_VERSION } from "@dsh-vscode/contract";
import { ProcessManager } from "../processManager.js";
import type { ProtocolClient } from "../protocolClient.js";
import {
  PartialExtensionSettingsWriteError,
  VsCodeSettingsHost,
  type ExtensionSettingsView,
  type SettingsHost,
} from "../settingsHost.js";
import { applyDiffs, diffsFromEvent } from "../applyEdits.js";
import { DecorationManager } from "../decorations.js";
import { nextStatus, protocolMismatchStatus, type DshState } from "../statusBar.js";
import { encodeImageSelection } from "./attachments.js";
import type {
  ImagesPickedMessage,
  SettingsHostAction,
  SettingsHostResultMessage,
} from "./media/vscode.js";

interface Running {
  client: ProtocolClient;
  child: ChildProcess;
  stop(): Promise<void>;
}

interface PendingTrustedPath {
  action: Extract<
    SettingsHostAction,
    "openSettingsDocument" | "revealDshHome" | "openAgentPreset"
  >;
  uiRequestId: string;
  target: ResolveSettingsPathTargetWire;
  mode: "open" | "reveal";
  generation: number;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingRestart {
  requestId: string;
  generation: number;
  hostGeneration: number;
  folder: string;
}

const MAX_PENDING_TRUSTED_PATHS = 16;

export class DshChatProvider implements vscode.WebviewViewProvider {
  private readonly extensionUri: vscode.Uri;
  private readonly pm: ProcessManager;
  private readonly settingsHost: SettingsHost;
  private readonly decorations: DecorationManager;
  private view: vscode.WebviewView | undefined;
  private running: Running | undefined;
  private startingChild = false;
  private startGeneration = 0;
  private status: DshState = "idle";
  private pending: ToolDiff[] = [];
  private currentSessionId: string | undefined;
  private fullAccessConfirmedFor: string | undefined;
  private activeFolder: string | undefined;
  private hostGeneration = 0;
  private confirmationGeneration = 0;
  private readonly pendingConfirmationIds = new Set<string>();
  private readonly pendingTrustedPaths = new Map<string, PendingTrustedPath>();
  private pendingRestart: PendingRestart | undefined;

  constructor(
    extensionUri: vscode.Uri,
    pm: ProcessManager,
    settingsHost: SettingsHost = new VsCodeSettingsHost(),
  ) {
    this.extensionUri = extensionUri;
    this.pm = pm;
    this.settingsHost = settingsHost;
    this.decorations = new DecorationManager();
  }

  dispose(): void {
    this.cancelPendingRestart("DSH restart cancelled: provider disposed");
    this.startGeneration += 1;
    this.startingChild = false;
    this.invalidateHostWork("Extension host disposed");
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

    if (kind === "confirmSettingsFullAccess") {
      const requestId = (cmd as { requestId?: unknown }).requestId;
      if (typeof requestId === "string" && requestId.length > 0) {
        void this.confirmSettingsFullAccess(requestId);
      }
      return;
    }

    const requestId = (cmd as { requestId?: unknown }).requestId;
    if (
      kind === "getExtensionSettings" &&
      typeof requestId === "string" &&
      requestId.length > 0
    ) {
      void this.readExtensionSettings(requestId);
      return;
    }
    if (
      kind === "updateExtensionSettings" &&
      typeof requestId === "string" &&
      requestId.length > 0
    ) {
      const binaryPath = (cmd as { binaryPath?: unknown }).binaryPath;
      const handshakeTimeoutMs =
        (cmd as { handshakeTimeoutMs?: unknown }).handshakeTimeoutMs;
      if (
        typeof binaryPath !== "string" ||
        typeof handshakeTimeoutMs !== "number" ||
        !Number.isInteger(handshakeTimeoutMs)
      ) {
        this.postHostFailure(
          requestId,
          "write",
          new Error(
            "Extension settings require a string binary path and integer timeout",
          ),
        );
        return;
      }
      void this.writeExtensionSettings(requestId, {
        binaryPath,
        handshakeTimeoutMs,
      });
      return;
    }
    if (
      kind === "openExtensionSettings" &&
      typeof requestId === "string" &&
      requestId.length > 0
    ) {
      void this.runHostAction(
        requestId,
        "openExtensionSettings",
        () => this.settingsHost.openExtensionSettings(),
      );
      return;
    }
    if (
      kind === "openSettingsDocument" &&
      typeof requestId === "string" &&
      requestId.length > 0
    ) {
      this.resolveTrustedPath(
        requestId,
        "openSettingsDocument",
        { kind: "settings-document", prepare: true },
        "open",
      );
      return;
    }
    if (
      kind === "revealDshHome" &&
      typeof requestId === "string" &&
      requestId.length > 0
    ) {
      this.resolveTrustedPath(
        requestId,
        "revealDshHome",
        { kind: "dsh-home" },
        "reveal",
      );
      return;
    }
    if (
      kind === "openAgentPreset" &&
      typeof requestId === "string" &&
      requestId.length > 0
    ) {
      const presetId = (cmd as { presetId?: unknown }).presetId;
      if (typeof presetId === "string" && presetId.length > 0) {
        this.resolveTrustedPath(
          requestId,
          "openAgentPreset",
          { kind: "agent-preset", presetId },
          "open",
        );
      } else {
        this.postHostFailure(
          requestId,
          "openAgentPreset",
          new Error("Invalid settings path target"),
        );
      }
      return;
    }
    if (
      kind === "restartDsh" &&
      typeof requestId === "string" &&
      requestId.length > 0
    ) {
      void this.restart(requestId);
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

  private async confirmSettingsFullAccess(requestId: string): Promise<void> {
    const generation = this.confirmationGeneration;
    this.pendingConfirmationIds.add(requestId);
    const choice = await vscode.window.showWarningMessage(
      "Full Access lets new sessions reduce confirmation steps and perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust subsequent tasks.",
      { modal: true },
      "Enable Full Access",
    );
    this.pendingConfirmationIds.delete(requestId);
    if (generation !== this.confirmationGeneration) return;
    this.view?.webview.postMessage({
      kind: "settingsFullAccessConfirmation",
      requestId,
      confirmed: choice === "Enable Full Access",
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
    if (
      this.pendingRestart !== undefined &&
      this.pendingRestart.folder !== folder
    ) {
      this.cancelPendingRestart(
        "DSH restart cancelled: workspace folder changed",
      );
      this.startGeneration += 1;
      this.startingChild = false;
      this.invalidateHostWork("Workspace folder changed");
    }
    this.activeFolder = folder;
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
        await running.stop();
        return;
      }
      this.running = running;
      running.client.onMessage((m: OutboundMessage) =>
        this.handleOutbound(m, generation));

      // Post-boot crashes (the handshake already arrived, but dsh exits later) are
      // surfaced here. Spawn errors and handshake timeouts already rejected `start()`
      // and are handled by the `catch` below.
      running.child.on("exit", (code, signal) => {
        const wasCurrent =
          generation === this.startGeneration &&
          this.running?.child === running.child;
        if (wasCurrent) {
          this.running = undefined;
        }
        if (!wasCurrent) return;
        this.status = "error";
        this.invalidateHostWork("DSH disconnected");
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
      if (generation === this.startGeneration) {
        this.startingChild = false;
      }
    }
  }

  async stop(): Promise<void> {
    this.cancelPendingRestart("DSH restart cancelled: stop requested");
    this.startGeneration += 1;
    this.startingChild = false;
    const running = this.running;
    this.running = undefined;
    this.currentSessionId = undefined;
    this.fullAccessConfirmedFor = undefined;
    this.invalidateHostWork("DSH stopped");
    if (running) await running.stop();
  }

  private postHostResult(message: SettingsHostResultMessage): void {
    this.view?.webview.postMessage(message);
  }

  private async readExtensionSettings(requestId: string): Promise<void> {
    const generation = this.hostGeneration;
    try {
      const settings = this.settingsHost.read();
      if (generation !== this.hostGeneration) return;
      this.postHostResult({
        kind: "settingsHostResult",
        requestId,
        action: "read",
        result: { ok: true, settings },
      });
    } catch (error) {
      if (generation !== this.hostGeneration) return;
      this.postHostFailure(requestId, "read", error);
    }
  }

  private async writeExtensionSettings(
    requestId: string,
    settings: ExtensionSettingsView,
  ): Promise<void> {
    const generation = this.hostGeneration;
    try {
      const previous = this.settingsHost.read();
      await this.settingsHost.write(settings);
      if (generation !== this.hostGeneration) return;
      const changed = previous.binaryPath !== settings.binaryPath;
      this.postHostResult({
        kind: "settingsHostResult",
        requestId,
        action: "write",
        result: {
          ok: true,
          settings,
          ...(changed ? { restartRequired: true } : {}),
        },
      });
    } catch (error) {
      if (generation !== this.hostGeneration) return;
      this.postHostFailure(requestId, "write", error);
    }
  }

  private async runHostAction(
    requestId: string,
    action: SettingsHostAction,
    run: () => Promise<void>,
  ): Promise<void> {
    const generation = this.hostGeneration;
    try {
      await run();
      if (generation !== this.hostGeneration) return;
      this.postHostResult({
        kind: "settingsHostResult",
        requestId,
        action,
        result: { ok: true },
      });
    } catch (error) {
      if (generation !== this.hostGeneration) return;
      this.postHostFailure(requestId, action, error);
    }
  }

  private postHostFailure(
    requestId: string,
    action: SettingsHostAction,
    error: unknown,
  ): void {
    const settings =
      error instanceof PartialExtensionSettingsWriteError
        ? error.actual
        : undefined;
    this.postHostResult({
      kind: "settingsHostResult",
      requestId,
      action,
      result: {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        ...(settings === undefined ? {} : { settings }),
      },
    });
  }

  private resolveTrustedPath(
    uiRequestId: string,
    action: PendingTrustedPath["action"],
    target: ResolveSettingsPathTargetWire,
    mode: PendingTrustedPath["mode"],
  ): void {
    if (!this.running) {
      this.postHostFailure(uiRequestId, action, new Error("DSH is disconnected"));
      return;
    }
    const requestId = crypto.randomUUID();
    const command = { kind: "resolveSettingsPath" as const, requestId, target };
    if (!isInboundMessage(command)) {
      this.postHostFailure(
        uiRequestId,
        action,
        new Error("Invalid settings path target"),
      );
      return;
    }
    if (this.pendingTrustedPaths.size >= MAX_PENDING_TRUSTED_PATHS) {
      this.postHostFailure(
        uiRequestId,
        action,
        new Error("Too many settings path requests are pending"),
      );
      return;
    }
    const generation = this.hostGeneration;
    const timer = setTimeout(() => {
      const pending = this.pendingTrustedPaths.get(requestId);
      if (pending === undefined || pending.generation !== generation) return;
      this.pendingTrustedPaths.delete(requestId);
      this.postHostFailure(
        pending.uiRequestId,
        pending.action,
        new Error("Timed out resolving settings path"),
      );
    }, 10_000);
    this.pendingTrustedPaths.set(requestId, {
      action,
      uiRequestId,
      target,
      mode,
      generation,
      timer,
    });
    this.running.client.send(command);
  }

  private async handleSettingsPath(message: SettingsPathMessage): Promise<void> {
    const pending = this.pendingTrustedPaths.get(message.requestId);
    if (
      pending === undefined ||
      pending.generation !== this.hostGeneration
    ) {
      return;
    }
    this.pendingTrustedPaths.delete(message.requestId);
    clearTimeout(pending.timer);
    if (!message.result.ok) {
      this.postHostFailure(
        pending.uiRequestId,
        pending.action,
        new Error(message.result.error.message),
      );
      return;
    }
    if (message.result.target !== pending.target.kind) {
      this.postHostFailure(
        pending.uiRequestId,
        pending.action,
        new Error("Resolved settings target did not match"),
      );
      return;
    }
    if (!path.isAbsolute(message.result.path)) {
      this.postHostFailure(
        pending.uiRequestId,
        pending.action,
        new Error("Resolved settings path was not absolute and local"),
      );
      return;
    }
    try {
      await this.settingsHost.openTrustedPath(message.result.path, pending.mode);
      if (pending.generation !== this.hostGeneration) return;
      this.postHostResult({
        kind: "settingsHostResult",
        requestId: pending.uiRequestId,
        action: pending.action,
        result: { ok: true },
      });
    } catch (error) {
      if (pending.generation !== this.hostGeneration) return;
      this.postHostFailure(pending.uiRequestId, pending.action, error);
    }
  }

  private invalidateHostWork(detail: string): void {
    this.hostGeneration += 1;
    this.confirmationGeneration += 1;
    for (const requestId of this.pendingConfirmationIds) {
      this.view?.webview.postMessage({
        kind: "settingsFullAccessConfirmation",
        requestId,
        confirmed: false,
      });
    }
    this.pendingConfirmationIds.clear();
    for (const pending of this.pendingTrustedPaths.values()) {
      clearTimeout(pending.timer);
      this.postHostFailure(
        pending.uiRequestId,
        pending.action,
        new Error(detail),
      );
    }
    this.pendingTrustedPaths.clear();
  }

  private async restart(requestId: string): Promise<void> {
    if (this.pendingRestart !== undefined) {
      this.cancelPendingRestart(
        "DSH restart cancelled: superseded by another restart",
      );
      this.startingChild = false;
    }
    if (
      this.startingChild ||
      this.status === "thinking" ||
      this.status === "awaiting-approval"
    ) {
      this.postHostFailure(requestId, "restart", new Error("DSH is busy"));
      return;
    }
    const folder =
      this.activeFolder ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (folder === undefined) {
      this.postHostFailure(
        requestId,
        "restart",
        new Error("No workspace folder open"),
      );
      return;
    }

    const sessionId = this.currentSessionId;
    const generation = ++this.startGeneration;
    this.startingChild = true;
    const old = this.running;
    this.running = undefined;
    this.invalidateHostWork("DSH restarted");
    const hostGeneration = this.hostGeneration;
    const pending: PendingRestart = {
      requestId,
      generation,
      hostGeneration,
      folder,
    };
    this.pendingRestart = pending;
    try {
      if (old !== undefined) await old.stop();
      const running = await this.pm.start(folder);
      if (
        generation !== this.startGeneration ||
        hostGeneration !== this.hostGeneration
      ) {
        await running.stop();
        return;
      }
      this.running = running;
      this.activeFolder = folder;
      running.client.onMessage((message: OutboundMessage) =>
        this.handleOutbound(message, generation));
      running.child.on("exit", (code, signal) => {
        if (
          generation !== this.startGeneration ||
          this.running?.child !== running.child
        ) {
          return;
        }
        this.running = undefined;
        this.status = "error";
        this.invalidateHostWork("DSH disconnected");
        const detail =
          code !== null
            ? `dsh process exited with code ${code}`
            : `dsh process terminated by ${signal ?? "signal"}`;
        this.view?.webview.postMessage({ kind: "hostDisconnected", detail });
      });
      if (sessionId !== undefined) {
        running.client.send({ kind: "resume", sessionId });
      }
      this.settleRestart(pending, { ok: true });
    } catch (error) {
      if (
        generation === this.startGeneration &&
        hostGeneration === this.hostGeneration
      ) {
        this.status = "error";
        this.settleRestart(pending, {
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (generation === this.startGeneration) {
        this.startingChild = false;
      }
    }
  }

  private cancelPendingRestart(detail: string): void {
    const pending = this.pendingRestart;
    if (pending === undefined) return;
    this.settleRestart(pending, { ok: false, detail });
  }

  private settleRestart(
    pending: PendingRestart,
    result: { ok: true } | { ok: false; detail: string },
  ): void {
    if (this.pendingRestart !== pending) return;
    if (result.ok) {
      this.postHostResult({
        kind: "settingsHostResult",
        requestId: pending.requestId,
        action: "restart",
        result,
      });
    } else {
      this.postHostResult({
        kind: "settingsHostResult",
        requestId: pending.requestId,
        action: "restart",
        result,
      });
    }
    this.pendingRestart = undefined;
  }

  private handleOutbound(
    m: OutboundMessage,
    generation = this.startGeneration,
  ): void {
    if (generation !== this.startGeneration) return;
    if (m.kind === "settingsPath") {
      void this.handleSettingsPath(m);
      return;
    }
    // Version handshake is host-only: check it, do not forward to the webview.
    if (m.kind === "hello") {
      if (m.version !== PROTOCOL_VERSION) {
        const mismatch = protocolMismatchStatus(m.version, PROTOCOL_VERSION);
        console.warn(`[dsh] ${mismatch.detail}`);
        this.updateStatus(mismatch);
        this.view?.webview.postMessage(mismatch);
        return;
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

    if (
      m.kind === "mcpOperation"
      && m.result.ok
      && m.result.authorizeUrl !== undefined
    ) {
      void vscode.env.openExternal(vscode.Uri.parse(m.result.authorizeUrl));
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

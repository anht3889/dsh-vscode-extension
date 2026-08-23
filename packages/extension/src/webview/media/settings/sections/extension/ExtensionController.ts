import type {
  SettingsHostAction,
  SettingsHostResultMessage,
  UiCommandCmd,
} from "../../../vscode.js";

export interface ExtensionSnapshot {
  binaryPath: string;
  handshakeTimeoutInput: string;
  dirty: boolean;
  loaded: boolean;
  status: "idle" | "loading" | "saving" | "acting";
  restartPending: boolean;
  nativeActionPending: boolean;
  readError: boolean;
  validation?: "integer" | "range";
  error?: string;
}

export class ExtensionController {
  private binaryPath = "";
  private handshakeTimeoutInput = "30000";
  private savedBinaryPath = "";
  private savedHandshakeTimeoutMs = 30_000;
  private loaded = false;
  private status: ExtensionSnapshot["status"] = "idle";
  private validation: ExtensionSnapshot["validation"];
  private error: string | undefined;
  private errorAction: SettingsHostAction | undefined;
  private readonly pending = new Map<string, SettingsHostAction>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly send: (command: UiCommandCmd) => void,
    private readonly setRestartRequired: (required: boolean) => void,
    private readonly requestId: () => string = () => crypto.randomUUID(),
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): ExtensionSnapshot => ({
    binaryPath: this.binaryPath,
    handshakeTimeoutInput: this.handshakeTimeoutInput,
    dirty:
      this.binaryPath !== this.savedBinaryPath ||
      this.handshakeTimeoutInput !== String(this.savedHandshakeTimeoutMs),
    loaded: this.loaded,
    status: this.status,
    restartPending: [...this.pending.values()].includes("restart"),
    nativeActionPending: this.hasNativeActionPending(),
    readError: this.errorAction === "read",
    ...(this.validation === undefined
      ? {}
      : { validation: this.validation }),
    ...(this.error === undefined ? {} : { error: this.error }),
  });

  load(): void {
    if ([...this.pending.values()].includes("read")) return;
    const requestId = this.begin("read", "loading");
    this.send({ kind: "getExtensionSettings", requestId });
  }

  setBinaryPath(value: string): void {
    this.binaryPath = value;
    this.error = undefined;
    this.notify();
  }

  setHandshakeTimeout(value: string): void {
    this.handshakeTimeoutInput = value;
    this.validation = undefined;
    this.error = undefined;
    this.notify();
  }

  save(): void {
    if ([...this.pending.values()].includes("write")) return;
    const timeout = Number(this.handshakeTimeoutInput);
    if (
      this.handshakeTimeoutInput.trim() === "" ||
      !Number.isInteger(timeout)
    ) {
      this.validation = "integer";
      this.notify();
      return;
    }
    if (timeout < 1_000 || timeout > 300_000) {
      this.validation = "range";
      this.notify();
      return;
    }
    this.validation = undefined;
    const requestId = this.begin("write", "saving");
    this.send({
      kind: "updateExtensionSettings",
      requestId,
      binaryPath: this.binaryPath,
      handshakeTimeoutMs: timeout,
    });
  }

  openExtensionSettings(): void {
    this.nativeAction(
      "openExtensionSettings",
      { kind: "openExtensionSettings" },
    );
  }

  openSettingsDocument(): void {
    this.nativeAction("openSettingsDocument", { kind: "openSettingsDocument" });
  }

  revealDshHome(): void {
    this.nativeAction("revealDshHome", { kind: "revealDshHome" });
  }

  openAgentPreset(presetId: string): void {
    if (this.hasNativeActionPending()) return;
    const requestId = this.begin("openAgentPreset", "acting");
    this.send({ kind: "openAgentPreset", requestId, presetId });
  }

  restart(): void {
    this.nativeAction("restart", { kind: "restartDsh" });
  }

  receive(message: SettingsHostResultMessage): void {
    if (this.pending.get(message.requestId) !== message.action) return;
    this.pending.delete(message.requestId);
    this.status = this.pendingStatus();
    if (!message.result.ok) {
      if (message.result.settings !== undefined) {
        this.acceptSettings(message.result.settings);
      }
      this.error = message.result.detail;
      this.errorAction = message.action;
      this.notify();
      return;
    }
    if (message.result.settings !== undefined) {
      this.acceptSettings(message.result.settings);
    }
    if (message.result.restartRequired) {
      this.setRestartRequired(true);
    }
    if (message.action === "restart") {
      this.setRestartRequired(false);
      this.load();
    }
    this.error = undefined;
    this.errorAction = undefined;
    this.notify();
  }

  invalidate(): void {
    this.pending.clear();
    this.status = "idle";
    this.notify();
  }

  discard(): void {
    this.pending.clear();
    this.binaryPath = this.savedBinaryPath;
    this.handshakeTimeoutInput = String(this.savedHandshakeTimeoutMs);
    this.status = "idle";
    this.validation = undefined;
    this.error = undefined;
    this.errorAction = undefined;
    this.notify();
  }

  private nativeAction(
    action: SettingsHostAction,
    command: { kind: "openExtensionSettings" | "openSettingsDocument" |
      "revealDshHome" | "restartDsh" },
  ): void {
    if (this.hasNativeActionPending()) return;
    const requestId = this.begin(action, "acting");
    this.send({ ...command, requestId });
  }

  private begin(
    action: SettingsHostAction,
    status: ExtensionSnapshot["status"],
  ): string {
    const requestId = this.requestId();
    this.pending.set(requestId, action);
    this.status = status;
    this.error = undefined;
    this.errorAction = undefined;
    this.notify();
    return requestId;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private hasNativeActionPending(): boolean {
    return [...this.pending.values()].some(
      (action) => action !== "read" && action !== "write",
    );
  }

  private pendingStatus(): ExtensionSnapshot["status"] {
    const actions = [...this.pending.values()];
    if (actions.includes("write")) return "saving";
    if (actions.includes("read")) return "loading";
    if (this.hasNativeActionPending()) return "acting";
    return "idle";
  }

  private acceptSettings(
    settings: { binaryPath: string; handshakeTimeoutMs: number },
  ): void {
    this.savedBinaryPath = settings.binaryPath;
    this.savedHandshakeTimeoutMs = settings.handshakeTimeoutMs;
    this.binaryPath = settings.binaryPath;
    this.handshakeTimeoutInput = String(settings.handshakeTimeoutMs);
    this.loaded = true;
  }
}

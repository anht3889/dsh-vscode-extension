import type {
  SettingsInboundCommand,
  WebSearchEngineWire,
  WebSearchMutationMessage,
  WebSearchSecretRefWire,
  WebSearchSettingsView,
} from "@dsh-vscode/contract";
import type { SettingsCopyKey } from "../../localization/index.js";

export interface WebSearchEngineDraft {
  engine: WebSearchEngineWire;
  baseURL: string;
  baseURLError?: SettingsCopyKey;
}

export interface WebSearchSnapshot {
  status: "idle" | "saving";
  dirty: boolean;
  engine: WebSearchEngineWire | null;
  engines: WebSearchEngineDraft[];
  secrets: {
    ref: WebSearchSecretRefWire;
    configured: boolean;
    staged: boolean;
  }[];
  available: boolean;
  canSave: boolean;
  errorKey?: SettingsCopyKey;
  errorDetail?: string;
  secretFailures: WebSearchSecretRefWire[];
  connected: boolean;
  secretEpoch: number;
}

type SecretValues = Partial<Record<WebSearchSecretRefWire, string>>;

interface PendingSave {
  requestId: string;
  refs: WebSearchSecretRefWire[];
}

function absoluteHttpURL(text: string): boolean {
  try {
    const url = new URL(text);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

function validateDraft(
  engine: WebSearchEngineWire | null,
  draft: WebSearchEngineDraft,
): SettingsCopyKey | undefined {
  const value = draft.baseURL.trim();
  if (engine === draft.engine && draft.engine === "searxng" && value === "") {
    return "webSearchBaseUrlRequired";
  }
  return value !== "" && !absoluteHttpURL(value)
    ? "webSearchBaseUrlInvalid"
    : undefined;
}

/**
 * Owns Web Search catalog drafts and value-free secret staging metadata.
 * Secret literals are accepted only as save-call arguments and are never retained.
 */
export class WebSearchController {
  private view?: WebSearchSettingsView;
  private connected = true;
  private secretEpoch = 0;
  private engine: WebSearchEngineWire | null = null;
  private readonly baseURLs = new Map<WebSearchEngineWire, string>();
  private readonly stagedRefs = new Set<WebSearchSecretRefWire>();
  private readonly listeners = new Set<() => void>();
  private pending?: PendingSave;
  private errorKey?: SettingsCopyKey;
  private errorDetail?: string;
  private secretFailures: WebSearchSecretRefWire[] = [];

  constructor(
    private readonly send: (command: SettingsInboundCommand) => void,
    private readonly refresh: () => void,
    private readonly requestId: () => string = () => crypto.randomUUID(),
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  updateView(view: WebSearchSettingsView): void {
    const adopt = this.view === undefined || !this.catalogDirty();
    this.view = view;
    this.connected = true;
    if (adopt) this.rebaseCatalog(view);
    this.notify();
  }

  disconnect(): void {
    const interrupted = this.pending !== undefined;
    this.pending = undefined;
    this.connected = false;
    this.clearAllSecrets();
    this.secretFailures = [];
    if (interrupted) {
      this.errorKey = "webSearchDisconnectedSave";
      this.errorDetail = undefined;
    }
    this.notify();
  }

  snapshot = (): WebSearchSnapshot => {
    const engines = (this.view?.engines ?? []).map((info) => {
      const draft: WebSearchEngineDraft = {
        engine: info.engine,
        baseURL: this.baseURLs.get(info.engine) ?? "",
      };
      const baseURLError = validateDraft(this.engine, draft);
      return {
        ...draft,
        ...(baseURLError === undefined ? {} : { baseURLError }),
      };
    });
    const invalid = engines.some((draft) => draft.baseURLError !== undefined);
    const dirty = this.catalogDirty() ||
      this.stagedRefs.size > 0 ||
      this.secretFailures.length > 0;
    const hasStagedSecret = this.stagedRefs.size > 0;
    return {
      status: this.pending === undefined ? "idle" : "saving",
      dirty,
      engine: this.engine,
      engines,
      secrets: (this.view?.secrets ?? []).map((secret) => ({
        ref: secret.ref,
        configured: secret.configured,
        staged: this.stagedRefs.has(secret.ref),
      })),
      available: this.view?.available ?? false,
      canSave:
        this.view !== undefined &&
        this.connected &&
        this.pending === undefined &&
        (dirty || hasStagedSecret) &&
        !invalid,
      ...(this.errorKey === undefined ? {} : { errorKey: this.errorKey }),
      ...(this.errorDetail === undefined ? {} : { errorDetail: this.errorDetail }),
      secretFailures: [...this.secretFailures],
      connected: this.connected,
      secretEpoch: this.secretEpoch,
    };
  };

  selectEngine(engine: WebSearchEngineWire): void {
    if (this.pending !== undefined || !this.hasEngine(engine)) return;
    this.engine = engine;
    this.clearError();
    this.notify();
  }

  setBaseURL(engine: WebSearchEngineWire, text: string): void {
    if (this.pending !== undefined || !this.hasEngine(engine)) return;
    this.baseURLs.set(engine, text);
    this.clearError();
    this.notify();
  }

  stageSecret(ref: WebSearchSecretRefWire, value: string): void {
    if (!this.hasSecret(ref) || this.pending !== undefined) return;
    if (value.trim() === "") this.stagedRefs.delete(ref);
    else this.stagedRefs.add(ref);
    this.secretFailures = this.secretFailures.filter((failed) => failed !== ref);
    this.clearError();
    this.notify();
  }

  clearStagedSecret(ref: WebSearchSecretRefWire): void {
    this.stagedRefs.delete(ref);
    this.secretFailures = this.secretFailures.filter((failed) => failed !== ref);
    if (this.pending !== undefined) {
      this.pending.refs = this.pending.refs.filter((pendingRef) => pendingRef !== ref);
    }
    this.notify();
  }

  save(values: SecretValues = {}): boolean {
    return this.startSave(values, [...this.stagedRefs]);
  }

  retrySecrets(values: SecretValues = {}): boolean {
    if (this.secretFailures.length === 0) return false;
    return this.startSave(values, [
      ...new Set([...this.secretFailures, ...this.stagedRefs]),
    ]);
  }

  discardAll(): void {
    this.pending = undefined;
    if (this.view !== undefined) this.rebaseCatalog(this.view);
    this.clearAllSecrets();
    this.secretFailures = [];
    this.clearError();
    this.notify();
  }

  receive(message: WebSearchMutationMessage): boolean {
    const pending = this.pending;
    if (pending === undefined || pending.requestId !== message.requestId) {
      return false;
    }
    this.pending = undefined;
    if (!message.result.ok) {
      this.errorKey = "webSearchSaveFailed";
      this.errorDetail = message.result.error.message;
      this.notify();
      return true;
    }

    this.view = message.result.view;
    this.connected = true;
    this.rebaseCatalog(message.result.view);
    const returnedFailures = new Set(
      message.result.secretFailures.map((failure) => failure.ref),
    );
    for (const ref of pending.refs) {
      this.stagedRefs.delete(ref);
      if (returnedFailures.has(ref)) this.stagedRefs.add(ref);
    }
    const failures = pending.refs.filter((ref) => returnedFailures.has(ref));
    this.secretFailures = [...failures];
    this.errorKey = failures.length === 0
      ? undefined
      : "webSearchSecretPartialFailure";
    this.errorDetail = undefined;
    if (failures.length === 0) this.secretEpoch += 1;
    this.notify();
    return true;
  }

  private startSave(
    values: SecretValues,
    refs: readonly WebSearchSecretRefWire[],
  ): boolean {
    const snapshot = this.snapshot();
    if (!snapshot.canSave) return false;
    const requested = new Set(refs);
    const secrets = (this.view?.secrets ?? []).flatMap((secret) => {
      if (!requested.has(secret.ref)) return [];
      const value = values[secret.ref]?.trim() ?? "";
      if (value === "") {
        this.stagedRefs.delete(secret.ref);
        return [];
      }
      return [{ ref: secret.ref, value }];
    });
    const requestId = this.requestId();
    this.pending = { requestId, refs: secrets.map((secret) => secret.ref) };
    this.clearError();
    this.secretFailures = [];
    this.send({
      kind: "setWebSearchConfig",
      requestId,
      catalog: {
        engine: this.engine,
        engines: (this.view?.engines ?? []).map((info) => {
          const baseURL = this.baseURLs.get(info.engine)?.trim() ?? "";
          return baseURL === "" || baseURL === info.defaultBaseURL
            ? { engine: info.engine }
            : { engine: info.engine, baseURL };
        }),
      },
      secrets,
    });
    this.notify();
    return true;
  }

  private rebaseCatalog(view: WebSearchSettingsView): void {
    this.engine = view.engine;
    this.baseURLs.clear();
    for (const engine of view.engines) {
      this.baseURLs.set(engine.engine, engine.baseURL ?? "");
    }
  }

  private catalogDirty(): boolean {
    if (this.view === undefined) return false;
    if (this.engine !== this.view.engine) return true;
    return this.view.engines.some(
      (engine) =>
        (this.baseURLs.get(engine.engine) ?? "") !== (engine.baseURL ?? ""),
    );
  }

  private hasEngine(engine: WebSearchEngineWire): boolean {
    return this.view?.engines.some((candidate) => candidate.engine === engine) === true;
  }

  private hasSecret(ref: WebSearchSecretRefWire): boolean {
    return this.view?.secrets.some((secret) => secret.ref === ref) === true;
  }

  private clearAllSecrets(): void {
    if (this.stagedRefs.size > 0) this.secretEpoch += 1;
    this.stagedRefs.clear();
  }

  private clearError(): void {
    this.errorKey = undefined;
    this.errorDetail = undefined;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

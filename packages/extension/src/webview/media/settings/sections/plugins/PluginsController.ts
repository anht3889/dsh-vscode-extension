import type {
  ConfigurablePluginWire,
  PluginsSettingsView,
  SettingsFieldWire,
  SettingsInboundCommand,
  SettingsMutationMessage,
  SettingsNamespaceWire,
  SettingsPathOpWire,
} from "@dsh-vscode/contract";

const SUPPORTED_FIELDS = {
  shell: ["timeoutMs", "maxOutputBytes"],
  "agent-loop": ["maxParallelToolCalls"],
  "web-search-deepseek": ["baseURL", "maxUses"],
} as const;

type SupportedNamespace = keyof typeof SUPPORTED_FIELDS;

interface StagedField {
  text: string;
  reset: boolean;
}

type CredentialIntent =
  | { kind: "keep" }
  | { kind: "set"; ref: string }
  | { kind: "unset"; ref: string };

interface PluginForm {
  plugin: ConfigurablePluginWire;
  namespace?: SettingsNamespaceWire;
  staged: Map<string, StagedField>;
  status:
    | "idle"
    | "saving-settings"
    | "saving-credential"
    | "credential-failed"
    | "error"
    | "conflict";
  stale: boolean;
  conflictRevision?: number;
  error?: string;
  credentialIntent: CredentialIntent;
  retryingConflict: boolean;
}

interface PendingOperation {
  requestId: string;
  namespace: string;
  stage: "settings" | "credential";
}

export interface PluginFieldSnapshot {
  path: string[];
  label: string;
  kind: "string" | "number";
  text: string;
  overridden: boolean;
  invalid: boolean;
  min?: number;
  max?: number;
  step?: number;
}

export interface PluginCardSnapshot {
  namespace: string;
  label: string;
  available: boolean;
  writable: boolean;
  applies: "live" | "restart";
  expectedRevision?: number;
  fields: Record<string, PluginFieldSnapshot>;
  credential?: ConfigurablePluginWire["credential"];
  credentialStatus?: ConfigurablePluginWire["credentialStatus"];
  dirty: boolean;
  settingsDirty: boolean;
  credentialDirty: boolean;
  credentialIntent: CredentialIntent["kind"];
  invalid: boolean;
  stale: boolean;
  status: PluginForm["status"];
  retryable: boolean;
  canSave: boolean;
  error?: string;
}

export interface PendingPluginCredential {
  kind: "set" | "unset";
  requestId: string;
  namespace: string;
  ref: string;
}

export interface PluginsSnapshot {
  cards: PluginCardSnapshot[];
  inventory: PluginsSettingsView["inventory"];
  connected: boolean;
  secretEpoch: number;
  dirty: boolean;
  busy: boolean;
  restartRequired: boolean;
  pendingCredential?: PendingPluginCredential;
}

function isSupportedNamespace(value: string): value is SupportedNamespace {
  return Object.hasOwn(SUPPORTED_FIELDS, value);
}

function leaf(field: SettingsFieldWire): string {
  return field.path.at(-1) ?? "";
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function formatValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function absoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

function parseField(
  namespace: string,
  field: string,
  text: string,
): { valid: boolean; value?: unknown } {
  const trimmed = text.trim();
  if (trimmed === "") return { valid: true };
  if (namespace === "web-search-deepseek" && field === "baseURL") {
    return absoluteHttpUrl(trimmed)
      ? { valid: true, value: trimmed }
      : { valid: false };
  }
  const number = Number(trimmed);
  if (!Number.isFinite(number) || number <= 0) return { valid: false };
  if (
    (namespace === "agent-loop" && field === "maxParallelToolCalls") ||
    (namespace === "web-search-deepseek" && field === "maxUses")
  ) {
    return Number.isInteger(number)
      ? { valid: true, value: number }
      : { valid: false };
  }
  return { valid: true, value: number };
}

export class PluginsController {
  private view?: PluginsSettingsView;
  private connected = true;
  private secretEpoch = 0;
  private restartRequired = false;
  private readonly pendingByNamespace = new Map<string, PendingOperation>();
  private readonly pendingByRequest = new Map<string, PendingOperation>();
  private pendingCredential?: PendingPluginCredential;
  private readonly forms = new Map<string, PluginForm>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly send: (command: SettingsInboundCommand) => void,
    private readonly refresh: () => void,
    private readonly requestId: () => string = () => crypto.randomUUID(),
    private readonly markRestartRequired: () => void = () => {},
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  updateView(view: PluginsSettingsView): void {
    this.view = view;
    this.connected = true;
    const plugins = new Map(view.configurable.map((plugin) => [
      plugin.namespace,
      plugin,
    ]));
    const namespaces = new Map(view.namespaces.map((namespace) => [
      namespace.namespace,
      namespace,
    ]));
    for (const plugin of view.configurable) {
      if (!isSupportedNamespace(plugin.namespace)) continue;
      const namespace = namespaces.get(plugin.namespace);
      const existing = this.forms.get(plugin.namespace);
      if (existing === undefined) {
        this.forms.set(plugin.namespace, {
          plugin,
          namespace,
          staged: new Map(),
          status: "idle",
          stale: false,
          credentialIntent: { kind: "keep" },
          retryingConflict: false,
        });
        continue;
      }
      const revisionChanged =
        namespace?.revision !== existing.namespace?.revision ||
        !equal(namespace?.user, existing.namespace?.user) ||
        !equal(namespace?.value, existing.namespace?.value);
      existing.plugin = plugin;
      existing.namespace = namespace;
      if (this.formDirty(existing) && revisionChanged) existing.stale = true;
      if (!this.formDirty(existing) && existing.status !== "conflict") {
        existing.stale = false;
      }
    }
    for (const [namespace, form] of this.forms) {
      if (plugins.has(namespace)) continue;
      form.namespace = undefined;
    }
    this.notify();
  }

  disconnect(): void {
    this.connected = false;
    this.secretEpoch += 1;
    this.pendingCredential = undefined;
    for (const operation of this.pendingByNamespace.values()) {
      const form = this.forms.get(operation.namespace);
      if (form !== undefined) {
        form.error = undefined;
        form.status =
          operation.stage === "credential" &&
            form.credentialIntent.kind === "set"
          ? "credential-failed"
          : form.retryingConflict ? "conflict" : "idle";
        form.retryingConflict = false;
      }
    }
    this.pendingByNamespace.clear();
    this.pendingByRequest.clear();
    for (const form of this.forms.values()) {
      if (form.credentialIntent.kind === "set") {
        form.credentialIntent = { kind: "keep" };
      }
    }
    this.notify();
  }

  snapshot = (): PluginsSnapshot => {
    const cards = [...this.forms.values()].map((form) => this.project(form));
    return {
      cards,
      inventory: this.view?.inventory.map((item) => ({ ...item })) ?? [],
      connected: this.connected,
      secretEpoch: this.secretEpoch,
      dirty: cards.some((card) => card.dirty),
      busy: cards.some((card) => (
        card.status === "saving-settings" ||
        card.status === "saving-credential"
      )),
      restartRequired: this.restartRequired,
      ...(this.pendingCredential === undefined
        ? {}
        : { pendingCredential: { ...this.pendingCredential } }),
    };
  };

  card(namespace: string): PluginCardSnapshot | undefined {
    const form = this.forms.get(namespace);
    return form === undefined ? undefined : this.project(form);
  }

  edit(namespace: string, field: string, text: string): void {
    const form = this.forms.get(namespace);
    if (
      form === undefined ||
      this.pendingByNamespace.has(namespace) ||
      !this.field(form, field)
    ) return;
    const current = formatValue(record(form.namespace?.value)[field]);
    if (text === current) form.staged.delete(field);
    else form.staged.set(field, { text, reset: false });
    form.status = "idle";
    form.error = undefined;
    form.conflictRevision = undefined;
    this.notify();
  }

  resetField(namespace: string, field: string): void {
    const form = this.forms.get(namespace);
    if (
      form === undefined ||
      this.pendingByNamespace.has(namespace) ||
      !this.field(form, field)
    ) return;
    if (!Object.hasOwn(record(form.namespace?.user), field)) {
      form.staged.delete(field);
    } else {
      form.staged.set(field, {
        text: formatValue(record(form.namespace?.base)[field]),
        reset: true,
      });
    }
    form.status = "idle";
    form.error = undefined;
    form.conflictRevision = undefined;
    this.notify();
  }

  discard(namespace: string): void {
    const form = this.forms.get(namespace);
    if (form === undefined || this.pendingByNamespace.has(namespace)) return;
    form.staged.clear();
    form.status = "idle";
    form.stale = false;
    form.conflictRevision = undefined;
    form.error = undefined;
    form.credentialIntent = { kind: "keep" };
    form.retryingConflict = false;
    this.notify();
  }

  discardSettings(namespace: string): void {
    const form = this.forms.get(namespace);
    if (form === undefined || this.pendingByNamespace.has(namespace)) return;
    form.staged.clear();
    form.status = "idle";
    form.stale = false;
    form.conflictRevision = undefined;
    form.error = undefined;
    form.retryingConflict = false;
    this.notify();
  }

  discardAll(): void {
    this.pendingByNamespace.clear();
    this.pendingByRequest.clear();
    this.pendingCredential = undefined;
    this.secretEpoch += 1;
    for (const form of this.forms.values()) {
      form.staged.clear();
      form.status = "idle";
      form.stale = false;
      form.conflictRevision = undefined;
      form.error = undefined;
      form.credentialIntent = { kind: "keep" };
      form.retryingConflict = false;
    }
    this.notify();
  }

  armCredential(namespace: string, ref: string): void {
    this.stageCredential(namespace, ref, "set");
  }

  stageCredential(
    namespace: string,
    ref: string,
    intent: "set" | "unset" | "keep",
  ): void {
    const form = this.forms.get(namespace);
    if (
      form === undefined ||
      namespace !== "web-search-deepseek" ||
      this.pendingByNamespace.has(namespace)
    ) return;
    form.credentialIntent = intent === "keep"
      ? { kind: "keep" }
      : { kind: intent, ref };
    if (form.plugin.credential?.ref !== ref) form.error = undefined;
    this.notify();
  }

  clearCredentialSecret(namespace: string): void {
    const form = this.forms.get(namespace);
    if (form?.credentialIntent.kind !== "set") return;
    form.credentialIntent = { kind: "keep" };
    this.notify();
  }

  save(namespace: string): boolean {
    const form = this.forms.get(namespace);
    const snapshot = form === undefined ? undefined : this.project(form);
    if (
      form === undefined ||
      snapshot === undefined ||
      !snapshot.available ||
      snapshot.invalid ||
      !snapshot.dirty ||
      !this.connected ||
      this.pendingByNamespace.has(namespace) ||
      !snapshot.canSave
    ) return false;
    const ops = this.operations(form);
    form.error = undefined;
    if (ops.length === 0) {
      this.startCredential(form);
      return true;
    }
    const requestId = this.requestId();
    const operation: PendingOperation = {
      requestId,
      namespace: form.plugin.namespace,
      stage: "settings",
    };
    this.own(operation);
    form.status = "saving-settings";
    this.send({
      kind: "mutateSettings",
      requestId,
      namespace: form.plugin.namespace,
      expectedRevision: form.namespace!.revision,
      ops,
    });
    this.notify();
    return true;
  }

  retry(namespace: string): void {
    const form = this.forms.get(namespace);
    if (form === undefined || !this.project(form).retryable) return;
    form.retryingConflict = true;
    form.error = undefined;
    this.save(namespace);
  }

  credentialPosted(requestId: string): void {
    if (this.pendingCredential?.requestId !== requestId) return;
    const operation = this.pendingByNamespace.get(
      this.pendingCredential.namespace,
    );
    if (operation?.requestId !== requestId) return;
    this.pendingCredential = undefined;
    const form = this.forms.get(operation.namespace);
    if (form !== undefined) form.status = "saving-credential";
    this.notify();
  }

  credentialUnavailable(requestId: string): void {
    if (this.pendingCredential?.requestId !== requestId) return;
    const operation = this.pendingByNamespace.get(
      this.pendingCredential.namespace,
    );
    if (operation?.requestId !== requestId) return;
    const form = this.forms.get(operation.namespace);
    this.release(operation);
    this.pendingCredential = undefined;
    if (form !== undefined) {
      form.credentialIntent = { kind: "keep" };
      form.status = "credential-failed";
    }
    this.refresh();
    this.notify();
  }

  receive(message: SettingsMutationMessage): boolean {
    const operation = this.pendingByRequest.get(message.requestId);
    if (
      operation === undefined ||
      this.pendingByNamespace.get(operation.namespace)?.requestId !==
        message.requestId
    ) return false;
    if (
      message.result.ok &&
      message.result.namespace !== undefined &&
      message.result.namespace.namespace !== operation.namespace
    ) return false;
    if (
      !message.result.ok &&
      message.result.error.namespace !== undefined &&
      message.result.error.namespace !== operation.namespace
    ) return false;
    const form = this.forms.get(operation.namespace);
    this.release(operation);
    if (this.pendingCredential?.requestId === message.requestId) {
      this.pendingCredential = undefined;
    }
    if (form === undefined) return false;
    if (!message.result.ok) {
      if (
        operation.stage === "settings" &&
        form.credentialIntent.kind === "set"
      ) {
        form.credentialIntent = { kind: "keep" };
        this.secretEpoch += 1;
      }
      if (operation.stage === "settings") form.retryingConflict = false;
      if (
        operation.stage === "credential" &&
        form.credentialIntent.kind === "set"
      ) {
        form.credentialIntent = { kind: "keep" };
      }
      form.error = message.result.error.message;
      if (
        operation.stage === "settings" &&
        message.result.error.code === "settings-conflict"
      ) {
        form.status = "conflict";
        form.retryingConflict = false;
        form.conflictRevision = message.result.error.currentRevision;
        form.stale = true;
      } else {
        form.status = operation.stage === "credential"
          ? "credential-failed"
          : "error";
      }
      this.refresh();
      this.notify();
      return true;
    }
    if (message.result.namespace !== undefined) {
      form.namespace = message.result.namespace;
      if (this.view !== undefined) {
        const namespace = message.result.namespace;
        this.view = {
          ...this.view,
          namespaces: this.view.namespaces.map((candidate) =>
            candidate.namespace === namespace.namespace
              ? namespace
              : candidate),
        };
      }
    }
    if (
      message.result.restartRequired === true ||
      (operation.stage === "settings" && form.namespace?.applies === "restart")
    ) {
      this.restartRequired = true;
      this.markRestartRequired();
    }
    if (operation.stage === "settings") {
      form.staged.clear();
      form.stale = false;
      form.conflictRevision = undefined;
      form.retryingConflict = false;
      this.startCredential(form);
      this.refresh();
      return true;
    }
    form.credentialIntent = { kind: "keep" };
    form.status = "idle";
    form.error = undefined;
    this.refresh();
    this.notify();
    return true;
  }

  ownsNamespace(namespace: string): boolean {
    return this.forms.has(namespace);
  }

  private startCredential(form: PluginForm): void {
    const intent = form.credentialIntent;
    if (intent.kind === "keep") {
      form.status = "idle";
      form.error = undefined;
      this.refresh();
      this.notify();
      return;
    }
    if (!this.credentialWritable(form)) {
      form.credentialIntent = { kind: "keep" };
      form.status = "credential-failed";
      this.notify();
      return;
    }
    const requestId = this.requestId();
    const operation: PendingOperation = {
      requestId,
      namespace: form.plugin.namespace,
      stage: "credential",
    };
    this.own(operation);
    this.pendingCredential = {
      kind: intent.kind,
      requestId,
      namespace: form.plugin.namespace,
      ref: intent.ref,
    };
    form.status = "saving-credential";
    this.notify();
  }

  private project(form: PluginForm): PluginCardSnapshot {
    const fields: Record<string, PluginFieldSnapshot> = {};
    for (const field of form.plugin.fields) {
      const name = leaf(field);
      if (!this.field(form, name)) continue;
      const staged = form.staged.get(name);
      const text = staged?.text ??
        formatValue(record(form.namespace?.value)[name]);
      const parsed = parseField(form.plugin.namespace, name, text);
      fields[name] = {
        path: [...field.path],
        label: field.label,
        kind: field.kind === "number" ? "number" : "string",
        text,
        overridden: staged === undefined
          ? Object.hasOwn(record(form.namespace?.user), name)
          : !staged.reset && parsed.value !== undefined,
        invalid: !parsed.valid,
        ...(field.min === undefined ? {} : { min: field.min }),
        ...(field.max === undefined ? {} : { max: field.max }),
        ...(field.step === undefined ? {} : { step: field.step }),
      };
    }
    const settingsDirty = form.staged.size > 0;
    const credentialDirty = form.credentialIntent.kind !== "keep";
    const dirty = settingsDirty || credentialDirty;
    const invalid = Object.values(fields).some((field) => field.invalid);
    const available = form.namespace !== undefined;
    const writable = this.connected && form.namespace?.writable === true;
    const owned = this.pendingByNamespace.has(form.plugin.namespace);
    const canSave =
      available &&
      this.connected &&
      !owned &&
      dirty &&
      !invalid &&
      (!settingsDirty || writable) &&
      (!credentialDirty || this.credentialWritable(form));
    return {
      namespace: form.plugin.namespace,
      label: form.plugin.label,
      available,
      writable,
      applies: form.namespace?.applies ?? "live",
      ...(form.namespace === undefined
        ? {}
        : { expectedRevision: form.namespace.revision }),
      fields,
      ...(form.plugin.credential === undefined
        ? {}
        : { credential: { ...form.plugin.credential } }),
      ...(form.plugin.credentialStatus === undefined
        ? {}
        : { credentialStatus: { ...form.plugin.credentialStatus } }),
      dirty,
      settingsDirty,
      credentialDirty,
      credentialIntent: form.credentialIntent.kind,
      invalid,
      stale: form.stale,
      status: form.status,
      retryable:
        form.status === "conflict" &&
        (form.conflictRevision === undefined ||
          (form.namespace?.revision ?? -1) >= form.conflictRevision),
      canSave,
      ...(form.error === undefined ? {} : { error: form.error }),
    };
  }

  private operations(form: PluginForm): SettingsPathOpWire[] {
    const operations: SettingsPathOpWire[] = [];
    for (const [field, staged] of form.staged) {
      if (staged.reset || staged.text.trim() === "") {
        operations.push({ op: "unset", path: [field] });
        continue;
      }
      const parsed = parseField(form.plugin.namespace, field, staged.text);
      if (parsed.valid && parsed.value !== undefined) {
        operations.push({ op: "set", path: [field], value: parsed.value });
      }
    }
    return operations;
  }

  private field(form: PluginForm, name: string): SettingsFieldWire | undefined {
    if (!isSupportedNamespace(form.plugin.namespace)) return undefined;
    if (!(SUPPORTED_FIELDS[form.plugin.namespace] as readonly string[]).includes(name)) {
      return undefined;
    }
    return form.plugin.fields.find((field) => leaf(field) === name);
  }

  private credentialWritable(form: PluginForm): boolean {
    return (
      form.plugin.credentialStatus?.kind === "ready" &&
      form.plugin.credential?.writable === true
    );
  }

  private formDirty(form: PluginForm): boolean {
    return form.staged.size > 0 || form.credentialIntent.kind !== "keep";
  }

  private own(operation: PendingOperation): void {
    this.pendingByNamespace.set(operation.namespace, operation);
    this.pendingByRequest.set(operation.requestId, operation);
  }

  private release(operation: PendingOperation): void {
    this.pendingByNamespace.delete(operation.namespace);
    this.pendingByRequest.delete(operation.requestId);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

import type {
  ModelProviderSettingsWire,
  ModelsSettingsView,
  SettingsFieldWire,
  SettingsInboundCommand,
  SettingsMutationMessage,
  SettingsNamespaceWire,
  SettingsPathOpWire,
} from "@dsh-vscode/contract";
import type { SettingsCopyKey } from "../../localization/index.js";

export interface ModelsMessage {
  key: SettingsCopyKey;
  values?: Record<string, string | number>;
}

type CredentialIntent =
  | { kind: "keep" }
  | { kind: "set"; ref: string }
  | { kind: "unset"; ref: string };

export interface PendingCredential {
  kind: "set" | "unset";
  requestId: string;
  ref: string;
}

interface Draft {
  providerId: string;
  values: Record<string, unknown>;
  original: Record<string, unknown>;
  resets: Set<string>;
  errors: Record<string, ModelsMessage>;
  status:
    | "idle"
    | "saving-settings"
    | "saving-credential"
    | "credential-failed"
    | "error"
    | "conflict"
    | "deleting";
  error?: string;
  errorKey?: SettingsCopyKey;
  conflictRevision?: number;
  deleteCredentialRemoved?: boolean;
  credentialIntent: CredentialIntent;
}

export interface CustomProviderDraft {
  route: string;
  displayName: string;
  baseURL: string;
  protocol: string;
  models: Record<string, unknown>[];
  openedAt: number;
  committed: boolean;
  storesKey: boolean;
  credentialArmed: boolean;
  status:
    | "idle"
    | "saving-settings"
    | "saving-credential"
    | "credential-failed"
    | "error"
    | "conflict";
  error?: string;
  errorKey?: SettingsCopyKey;
  conflictRevision?: number;
}

export interface CustomProviderSnapshot extends CustomProviderDraft {
  routeInvalid: boolean;
  routeTaken: boolean;
  baseURLInvalid: boolean;
  modelError?: ModelsMessage;
  ready: boolean;
  retryable: boolean;
  readOnly: boolean;
}

export interface ModelsEditorSnapshot {
  provider: ModelProviderSettingsWire;
  namespace?: SettingsNamespaceWire;
  values: Record<string, unknown>;
  fields: SettingsFieldWire[];
  errors: Record<string, ModelsMessage>;
  status: Draft["status"];
  dirty: boolean;
  retryable: boolean;
  error?: string;
  errorKey?: SettingsCopyKey;
}

export interface ModelsSnapshot {
  providers: ModelProviderSettingsWire[];
  addable: ModelProviderSettingsWire[];
  protocols: string[];
  writable: boolean;
  customAvailable: boolean;
  connected: boolean;
  secretEpoch: number;
  activeCard?: "edit" | "directory" | "custom";
  activeProviderId?: string;
  editor?: ModelsEditorSnapshot;
  custom?: CustomProviderSnapshot;
  dirty: boolean;
  pendingCredential?: PendingCredential;
}

interface PendingOperation {
  requestId: string;
  providerId: string;
  stage:
    | "settings"
    | "credential"
    | "delete-credential"
    | "delete-settings"
    | "custom-settings"
    | "custom-credential";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function at(root: unknown, path: readonly string[]): unknown {
  let current = root;
  for (const segment of path) current = record(current)?.[segment];
  return current;
}

function has(root: unknown, path: readonly string[]): boolean {
  let current = root;
  for (const segment of path) {
    const parent = record(current);
    if (parent === undefined || !Object.hasOwn(parent, segment)) return false;
    current = parent[segment];
  }
  return true;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function key(path: readonly string[]): string {
  return path.join(".");
}

function leaf(path: readonly string[]): string {
  return path.at(-1) ?? "";
}

function prefixOf(provider: ModelProviderSettingsWire): string[] {
  const field = provider.fields[0];
  if (field !== undefined) return field.path.slice(0, -1);
  return provider.namespace === "llm-pi-ai" ? ["providers", provider.id] : [];
}

export function deriveCredentialRef(providerId: string): string {
  return `${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

export function configured(
  provider: ModelProviderSettingsWire,
  namespace: SettingsNamespaceWire | undefined,
): boolean {
  if (namespace === undefined) return false;
  const prefix = prefixOf(provider);
  return prefix.length === 0 || has(namespace.value, prefix);
}

export function protocolChoicesFromView(view: ModelsSettingsView): string[] {
  const field = view.providers
    .find((provider) => provider.namespace === "llm-pi-ai")
    ?.fields.find((candidate) =>
      candidate.kind === "union" && leaf(candidate.path) === "api");
  return field?.options?.map((option) => option.value) ?? [];
}

const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname.length > 0
    );
  } catch {
    return false;
  }
}

function initialValues(
  provider: ModelProviderSettingsWire,
  namespace: SettingsNamespaceWire | undefined,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of provider.fields) {
    if (field.kind === "credential-ref") continue;
    const value = at(namespace?.user, field.path);
    if (value !== undefined) values[leaf(field.path)] = structuredClone(value);
  }
  const modelsPath = [...prefixOf(provider), "models"];
  const models = at(namespace?.user, modelsPath) ?? at(namespace?.value, modelsPath);
  if (Array.isArray(models)) values.models = structuredClone(models);
  return values;
}

function modelError(value: unknown): ModelsMessage | undefined {
  if (!Array.isArray(value)) return { key: "modelsValidationList" };
  const seen = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const model = record(candidate);
    const id = model?.id;
    if (model === undefined || typeof id !== "string" || id.trim() === "") {
      return {
        key: "modelsValidationId",
        values: { index: index + 1 },
      };
    }
    const trimmedId = id.trim();
    if (seen.has(trimmedId)) {
      return {
        key: "modelsValidationDuplicate",
        values: { index: index + 1, id: trimmedId },
      };
    }
    seen.add(trimmedId);
    const name = model.name;
    if (name !== undefined && (typeof name !== "string" || name.length === 0)) {
      return {
        key: "modelsValidationName",
        values: { index: index + 1 },
      };
    }
    for (const capacity of ["contextWindow", "maxTokens"]) {
      const amount = model[capacity];
      if (
        amount !== undefined &&
        (!Number.isInteger(amount) || (amount as number) <= 0)
      ) {
        return {
          key: capacity === "contextWindow"
            ? "modelsValidationContext"
            : "modelsValidationMaxTokens",
          values: { index: index + 1 },
        };
      }
    }
  }
  return undefined;
}

function validateField(
  field: SettingsFieldWire,
  value: unknown,
): ModelsMessage | undefined {
  if (value === undefined || value === "") return undefined;
  if (field.kind === "string" && typeof value !== "string") {
    return { key: "modelsValidationText", values: { field: field.label } };
  }
  if (field.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { key: "modelsValidationNumber", values: { field: field.label } };
    }
    if (field.min !== undefined && value < field.min) {
      return {
        key: "modelsValidationMin",
        values: { field: field.label, min: field.min },
      };
    }
    if (field.max !== undefined && value > field.max) {
      return {
        key: "modelsValidationMax",
        values: { field: field.label, max: field.max },
      };
    }
    if (field.step === 1 && !Number.isInteger(value)) {
      return { key: "modelsValidationWhole", values: { field: field.label } };
    }
  }
  if (
    field.kind === "union" &&
    !field.options?.some((option) => option.value === value)
  ) {
    return {
      key: "modelsValidationUnsupported",
      values: { field: field.label },
    };
  }
  return undefined;
}

export class ModelsController {
  private view?: ModelsSettingsView;
  private activeProviderId?: string;
  private activeCard?: "edit" | "directory" | "custom";
  private customDraft?: CustomProviderDraft;
  private connected = true;
  private secretEpoch = 0;
  private readonly drafts = new Map<string, Draft>();
  private pending?: PendingOperation;
  private pendingCredential?: PendingCredential;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly send: (command: SettingsInboundCommand) => void,
    private readonly refresh: () => void,
    private readonly requestId: () => string = () => crypto.randomUUID(),
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  updateView(view: ModelsSettingsView): void {
    this.view = view;
    this.connected = true;
    const piAi = view.namespaces.find((namespace) =>
      namespace.namespace === "llm-pi-ai");
    if (
      this.customDraft !== undefined &&
      !this.customDraft.committed &&
      this.pending === undefined &&
      piAi !== undefined
    ) {
      this.customDraft.openedAt = piAi.revision;
    }
    if (
      this.activeProviderId !== undefined &&
      !view.providers.some((provider) => provider.id === this.activeProviderId)
    ) {
      this.activeProviderId = undefined;
      if (this.activeCard !== "custom") this.activeCard = undefined;
    }
    this.notify();
  }

  disconnect(): void {
    this.connected = false;
    this.secretEpoch += 1;
    const operation = this.pending;
    this.pending = undefined;
    this.pendingCredential = undefined;
    if (operation === undefined) {
      this.notify();
      return;
    }
    if (
      operation.stage === "custom-settings" ||
      operation.stage === "custom-credential"
    ) {
      const draft = this.customDraft;
      if (draft !== undefined) {
        draft.credentialArmed = false;
        draft.error = undefined;
        if (operation.stage === "custom-credential") {
          draft.status = "credential-failed";
          draft.errorKey = "modelsSecretReenterCreate";
        } else {
          draft.status = "idle";
          draft.errorKey = undefined;
        }
      }
      this.notify();
      return;
    }
    const draft = this.drafts.get(operation.providerId);
    if (draft !== undefined) {
      draft.error = undefined;
      draft.credentialIntent = { kind: "keep" };
      if (operation.stage === "credential") {
        draft.status = "credential-failed";
        draft.errorKey = "modelsSecretReenterApply";
      } else {
        draft.status = "idle";
        draft.errorKey = undefined;
      }
    }
    this.notify();
  }

  snapshot = (): ModelsSnapshot => {
    const directory = this.view?.providers ?? [];
    const providers = directory.filter((provider) =>
      configured(provider, this.namespace(provider.namespace)));
    const active = directory.find((provider) => provider.id === this.activeProviderId);
    const namespace = active === undefined
      ? undefined
      : this.namespace(active.namespace);
    const draft = active === undefined ? undefined : this.drafts.get(active.id);
    const editor = active === undefined || draft === undefined
      ? undefined
      : {
          provider: active,
          ...(namespace === undefined
            ? {}
            : {
                namespace: this.connected
                  ? namespace
                  : { ...namespace, writable: false },
              }),
          values: structuredClone(draft.values),
          fields: active.fields.filter((field) => (
            field.kind !== "credential-ref" &&
            (active.declared === true ||
              (leaf(field.path) !== "displayName" && leaf(field.path) !== "api"))
          )),
          errors: { ...draft.errors },
          status: draft.status,
          dirty: this.dirtyDraft(draft),
          retryable:
            draft.status === "conflict" &&
            (draft.conflictRevision === undefined ||
              (namespace?.revision ?? -1) >= draft.conflictRevision),
          ...(draft.error === undefined ? {} : { error: draft.error }),
          ...(draft.errorKey === undefined
            ? {}
            : { errorKey: draft.errorKey }),
        };
    const protocols = this.view === undefined
      ? []
      : protocolChoicesFromView(this.view);
    const piAi = this.namespace("llm-pi-ai");
    const custom = this.customDraft === undefined
      ? undefined
      : this.customSnapshot(this.customDraft, directory);
    return {
      providers,
      addable: directory.filter((provider) => (
        provider.namespace !== "" &&
        !configured(provider, this.namespace(provider.namespace))
      )),
      protocols,
      writable: this.connected && piAi?.writable === true,
      customAvailable:
        this.connected && protocols.length > 0 && piAi?.writable === true,
      connected: this.connected,
      secretEpoch: this.secretEpoch,
      ...(this.activeCard === undefined ? {} : { activeCard: this.activeCard }),
      ...(this.activeProviderId === undefined
        ? {}
        : { activeProviderId: this.activeProviderId }),
      ...(editor === undefined ? {} : { editor }),
      ...(custom === undefined ? {} : { custom }),
      dirty:
        [...this.drafts.values()].some((draft) => this.dirtyDraft(draft)) ||
        (this.customDraft !== undefined &&
          !this.customDraft.committed &&
          this.customDirty(this.customDraft)),
      ...(this.pendingCredential === undefined
        ? {}
        : { pendingCredential: { ...this.pendingCredential } }),
    };
  };

  select(providerId: string | undefined): void {
    if (this.pending !== undefined) return;
    if (providerId === undefined) {
      this.activeProviderId = undefined;
      this.activeCard = undefined;
      this.notify();
      return;
    }
    const provider = this.provider(providerId);
    if (provider === undefined) return;
    if (this.activeCard === "custom") this.customDraft = undefined;
    if (!this.drafts.has(providerId)) {
      const values = initialValues(provider, this.namespace(provider.namespace));
      this.drafts.set(providerId, {
        providerId,
        values,
        original: structuredClone(values),
        resets: new Set(),
        errors: {},
        status: "idle",
        credentialIntent: { kind: "keep" },
      });
    }
    this.activeProviderId = providerId;
    if (this.activeCard !== "directory") this.activeCard = "edit";
    this.notify();
  }

  openDirectory(): void {
    const first = this.snapshot().addable[0];
    if (first === undefined || this.pending !== undefined) return;
    if (this.activeCard === "custom") this.customDraft = undefined;
    this.activeCard = "directory";
    this.activeProviderId = first.id;
    this.select(first.id);
  }

  selectDirectory(providerId: string): void {
    if (!this.snapshot().addable.some((provider) => provider.id === providerId)) {
      return;
    }
    this.activeCard = "directory";
    this.select(providerId);
  }

  openCustom(): void {
    const namespace = this.namespace("llm-pi-ai");
    const protocols = this.view === undefined
      ? []
      : protocolChoicesFromView(this.view);
    if (
      namespace?.writable !== true ||
      protocols.length === 0 ||
      !this.connected ||
      this.pending !== undefined
    ) return;
    this.customDraft ??= {
      route: "",
      displayName: "",
      baseURL: "",
      protocol: protocols[0]!,
      models: [],
      openedAt: namespace.revision,
      committed: false,
      storesKey: false,
      credentialArmed: false,
      status: "idle",
    };
    this.activeProviderId = undefined;
    this.activeCard = "custom";
    this.notify();
  }

  setField(path: readonly string[], value: unknown): void {
    const draft = this.activeDraft();
    if (draft === undefined || this.pending !== undefined) return;
    const name = leaf(path);
    if (typeof value === "string" && value.trim() === "") {
      delete draft.values[name];
    } else {
      draft.values[name] = value;
    }
    draft.resets.delete(key(path));
    draft.errors = {};
    draft.error = undefined;
    draft.errorKey = undefined;
    this.notify();
  }

  setModels(models: Record<string, unknown>[]): void {
    const draft = this.activeDraft();
    if (draft === undefined || this.pending !== undefined) return;
    draft.values.models = structuredClone(models);
    draft.resets.delete(key([...prefixOf(this.provider(draft.providerId)!), "models"]));
    draft.errors = {};
    this.notify();
  }

  setCustomField(
    field: "route" | "displayName" | "baseURL" | "protocol",
    value: string,
  ): void {
    const draft = this.customDraft;
    if (
      draft === undefined ||
      this.pending !== undefined ||
      draft.committed
    ) return;
    draft[field] = value;
    draft.error = undefined;
    draft.errorKey = undefined;
    draft.status = "idle";
    this.notify();
  }

  setCustomModels(models: Record<string, unknown>[]): void {
    const draft = this.customDraft;
    if (
      draft === undefined ||
      draft.committed ||
      this.pending !== undefined
    ) return;
    draft.models = structuredClone(models);
    draft.error = undefined;
    draft.errorKey = undefined;
    draft.status = "idle";
    this.notify();
  }

  createCustom(storesKey: boolean): boolean {
    const draft = this.customDraft;
    const namespace = this.namespace("llm-pi-ai");
    const directory = this.view?.providers ?? [];
    if (
      draft === undefined ||
      namespace === undefined ||
      !namespace.writable ||
      !this.connected ||
      this.pending !== undefined
    ) return false;
    const snapshot = this.customSnapshot(draft, directory);
    if (
      (!draft.committed && !snapshot.ready) ||
      (draft.committed && !storesKey)
    ) return false;
    draft.storesKey = storesKey;
    draft.credentialArmed = storesKey;
    draft.error = undefined;
    draft.errorKey = undefined;
    if (draft.committed) {
      this.startCustomCredential(draft);
      return true;
    }
    this.startCustomSettings(draft);
    return true;
  }

  retryCustom(): void {
    const draft = this.customDraft;
    if (draft?.status !== "conflict" || !this.customSnapshot(
      draft,
      this.view?.providers ?? [],
    ).retryable || this.pending !== undefined) return;
    draft.error = undefined;
    draft.errorKey = undefined;
    draft.credentialArmed = false;
    this.startCustomSettings(draft);
  }

  discardCustom(): void {
    if (this.customDraft?.status !== "conflict" || this.pending !== undefined) {
      return;
    }
    this.customDraft = undefined;
    this.activeCard = undefined;
    this.refresh();
    this.notify();
  }

  private startCustomSettings(draft: CustomProviderDraft): void {
    const profile = {
      ...(draft.displayName.length === 0
        ? {}
        : { displayName: draft.displayName }),
      ...(draft.storesKey
        ? { apiKeyEnv: deriveCredentialRef(draft.route) }
        : {}),
      api: draft.protocol,
      baseURL: draft.baseURL,
      models: draft.models.map((model) => ({ ...model })),
    };
    const requestId = this.requestId();
    this.pending = {
      requestId,
      providerId: draft.route,
      stage: "custom-settings",
    };
    draft.status = "saving-settings";
    this.send({
      kind: "mutateSettings",
      requestId,
      namespace: "llm-pi-ai",
      expectedRevision: draft.openedAt,
      ops: [{
        op: "set",
        path: ["providers", draft.route],
        value: profile,
      }],
    });
    this.notify();
  }

  resetField(path: readonly string[]): void {
    const draft = this.activeDraft();
    const provider = this.activeProvider();
    const namespace = provider === undefined
      ? undefined
      : this.namespace(provider.namespace);
    if (
      draft === undefined ||
      namespace === undefined ||
      this.pending !== undefined ||
      !has(namespace.user, path)
    ) return;
    delete draft.values[leaf(path)];
    draft.resets.add(key(path));
    draft.errors = {};
    this.notify();
  }

  apply(intent: CredentialIntent): boolean {
    const provider = this.activeProvider();
    const draft = this.activeDraft();
    const namespace = provider === undefined
      ? undefined
      : this.namespace(provider.namespace);
    if (
      provider === undefined ||
      draft === undefined ||
      namespace === undefined ||
      !namespace.writable ||
      !this.connected ||
      this.pending !== undefined
    ) return false;
    draft.errors = this.validate(provider, draft);
    if (Object.keys(draft.errors).length > 0) {
      this.notify();
      return false;
    }
    draft.credentialIntent = intent;
    const ops = this.ops(provider, namespace, draft, intent);
    if (ops.length === 0) {
      this.startCredential(provider, draft);
      return true;
    }
    const requestId = this.requestId();
    this.pending = { requestId, providerId: provider.id, stage: "settings" };
    draft.status = "saving-settings";
    draft.error = undefined;
    this.send({
      kind: "mutateSettings",
      requestId,
      namespace: provider.namespace,
      expectedRevision: namespace.revision,
      ops,
    });
    this.notify();
    return true;
  }

  credentialPosted(requestId: string): void {
    if (this.pendingCredential?.requestId !== requestId) return;
    const pending = this.pending;
    if (pending === undefined) return;
    if (pending.stage === "custom-credential") {
      if (this.customDraft !== undefined) {
        this.customDraft.status = "saving-credential";
      }
    } else {
      const draft = this.drafts.get(pending.providerId);
      if (draft !== undefined) draft.status = "saving-credential";
    }
    this.pendingCredential = undefined;
    this.notify();
  }

  credentialUnavailable(requestId: string): void {
    if (this.pendingCredential?.requestId !== requestId) return;
    const pending = this.pending;
    if (pending === undefined) return;
    this.pending = undefined;
    this.pendingCredential = undefined;
    if (pending.stage === "custom-credential") {
      if (this.customDraft !== undefined) {
        this.customDraft.credentialArmed = false;
        this.customDraft.status = "credential-failed";
        this.customDraft.error = undefined;
        this.customDraft.errorKey = "modelsSecretReenterCreate";
      }
    } else {
      const draft = this.drafts.get(pending.providerId);
      if (draft !== undefined) {
        draft.credentialIntent = { kind: "keep" };
        draft.status = "credential-failed";
        draft.error = undefined;
        draft.errorKey = "modelsSecretReenterApply";
      }
    }
    this.refresh();
    this.notify();
  }

  receive(message: SettingsMutationMessage): boolean {
    if (this.pending?.requestId !== message.requestId) return false;
    const operation = this.pending;
    const provider = this.provider(operation.providerId);
    const expectedNamespace =
      operation.stage === "custom-settings" ||
        operation.stage === "custom-credential"
        ? "llm-pi-ai"
        : provider?.namespace;
    const settingsStage =
      operation.stage === "settings" ||
      operation.stage === "custom-settings" ||
      operation.stage === "delete-settings";
    if (
      (message.result.ok &&
        ((settingsStage &&
          message.result.namespace?.namespace !== expectedNamespace) ||
          (!settingsStage &&
            message.result.namespace !== undefined &&
            message.result.namespace.namespace !== expectedNamespace))) ||
      (!message.result.ok &&
        message.result.error.namespace !== undefined &&
        message.result.error.namespace !== expectedNamespace)
    ) {
      return false;
    }
    if (
      operation.stage === "custom-settings" ||
      operation.stage === "custom-credential"
    ) {
      this.receiveCustom(operation, message);
      return true;
    }
    const draft = this.drafts.get(operation.providerId);
    if (draft === undefined || provider === undefined) return false;
    this.pending = undefined;
    if (!message.result.ok) {
      if (
        operation.stage === "settings" &&
        draft.credentialIntent.kind === "set"
      ) {
        this.secretEpoch += 1;
        draft.credentialIntent = { kind: "keep" };
      }
      if (operation.stage === "credential") {
        draft.credentialIntent = { kind: "keep" };
        draft.error = message.result.error.message;
        draft.errorKey = "modelsCredentialStage";
        draft.status = "credential-failed";
      } else if (message.result.error.code === "settings-conflict") {
        draft.error = message.result.error.message;
        draft.errorKey = undefined;
        draft.status = "conflict";
        draft.conflictRevision = message.result.error.currentRevision;
      } else {
        draft.error = message.result.error.message;
        draft.errorKey = operation.stage === "delete-credential"
          ? "modelsCredentialRemovalStage"
          : operation.stage === "delete-settings"
            ? draft.deleteCredentialRemoved === true
              ? "modelsProviderRemovalCredentialGone"
              : "modelsProviderRemovalStage"
            : "modelsSettingsStage";
        draft.status = "error";
      }
      this.refresh();
      this.notify();
      return true;
    }
    const result = message.result;
    if (result.namespace !== undefined && this.view !== undefined) {
      const nextNamespace = result.namespace;
      this.view = {
        ...this.view,
        namespaces: this.view.namespaces.map((candidate) => (
          candidate.namespace === nextNamespace.namespace
            ? nextNamespace
            : candidate
        )),
      };
    }
    if (operation.stage === "settings") {
      draft.original = structuredClone(draft.values);
      draft.resets.clear();
      this.startCredential(provider, draft);
      this.refresh();
      return true;
    }
    if (operation.stage === "delete-credential") {
      draft.deleteCredentialRemoved = true;
      this.startDeleteSettings(provider, draft);
      return true;
    }
    if (operation.stage === "delete-settings") {
      this.drafts.delete(provider.id);
      this.activeProviderId = undefined;
      this.activeCard = undefined;
      this.refresh();
      this.notify();
      return true;
    }
    draft.status = "idle";
    draft.error = undefined;
    draft.errorKey = undefined;
    draft.credentialIntent = { kind: "keep" };
    this.refresh();
    this.notify();
    return true;
  }

  ownsNamespace(namespace: string): boolean {
    return this.view?.namespaces.some((item) =>
      item.namespace === namespace) === true;
  }

  retry(): void {
    const draft = this.activeDraft();
    if (draft?.status !== "conflict") return;
    const namespace = this.activeProvider() === undefined
      ? undefined
      : this.namespace(this.activeProvider()!.namespace);
    if (
      draft.conflictRevision !== undefined &&
      (namespace?.revision ?? -1) < draft.conflictRevision
    ) return;
    this.apply(draft.credentialIntent);
  }

  discard(): void {
    const provider = this.activeProvider();
    const draft = this.activeDraft();
    if (provider === undefined || draft === undefined || this.pending !== undefined) return;
    const values = initialValues(provider, this.namespace(provider.namespace));
    draft.values = values;
    draft.original = structuredClone(values);
    draft.resets.clear();
    draft.errors = {};
    draft.status = "idle";
    draft.error = undefined;
    draft.errorKey = undefined;
    draft.conflictRevision = undefined;
    draft.credentialIntent = { kind: "keep" };
    this.notify();
  }

  discardAll(): void {
    this.pending = undefined;
    this.pendingCredential = undefined;
    this.secretEpoch += 1;
    for (const [providerId, draft] of this.drafts) {
      const provider = this.provider(providerId);
      if (provider === undefined) {
        this.drafts.delete(providerId);
        continue;
      }
      const values = initialValues(provider, this.namespace(provider.namespace));
      draft.values = values;
      draft.original = structuredClone(values);
      draft.resets.clear();
      draft.errors = {};
      draft.status = "idle";
      draft.error = undefined;
      draft.errorKey = undefined;
      draft.conflictRevision = undefined;
      draft.credentialIntent = { kind: "keep" };
    }
    this.customDraft = undefined;
    if (this.activeCard === "custom") this.activeCard = undefined;
    this.notify();
  }

  deleteSelected(): boolean {
    const provider = this.activeProvider();
    const draft = this.activeDraft();
    const namespace = provider === undefined
      ? undefined
      : this.namespace(provider.namespace);
    if (
      provider === undefined ||
      draft === undefined ||
      namespace === undefined ||
      !namespace.writable ||
      !provider.removable ||
      !this.connected ||
      this.pending !== undefined
    ) return false;
    draft.status = "deleting";
    draft.deleteCredentialRemoved = false;
    const managedRef = deriveCredentialRef(provider.id);
    if (
      provider.credential?.ref === managedRef &&
      provider.credential.set &&
      provider.credential.writable
    ) {
      const requestId = this.requestId();
      this.pending = {
        requestId,
        providerId: provider.id,
        stage: "delete-credential",
      };
      this.send({
        kind: "unsetCredential",
        requestId,
        ref: managedRef,
      });
    } else {
      this.startDeleteSettings(provider, draft);
    }
    this.notify();
    return true;
  }

  cancelCustom(): void {
    if (this.pending !== undefined) return;
    const changed = this.customDraft?.committed === true;
    this.customDraft = undefined;
    this.activeCard = undefined;
    if (changed) this.refresh();
    this.notify();
  }

  private validate(
    provider: ModelProviderSettingsWire,
    draft: Draft,
  ): Record<string, ModelsMessage> {
    const errors: Record<string, ModelsMessage> = {};
    for (const field of provider.fields) {
      if (field.kind === "credential-ref") continue;
      const name = leaf(field.path);
      const failure = validateField(field, draft.values[name]);
      if (failure !== undefined) errors[name] = failure;
    }
    if (typeof draft.values.baseURL === "string") {
      if (!isAbsoluteHttpUrl(draft.values.baseURL)) {
        errors.baseURL = { key: "modelsValidationBaseUrl" };
      }
    }
    if (Object.hasOwn(draft.values, "models")) {
      const failure = modelError(draft.values.models);
      if (failure !== undefined) errors.models = failure;
    }
    return errors;
  }

  private ops(
    provider: ModelProviderSettingsWire,
    namespace: SettingsNamespaceWire,
    draft: Draft,
    intent: CredentialIntent,
  ): SettingsPathOpWire[] {
    const ops: SettingsPathOpWire[] = [];
    for (const field of provider.fields) {
      const pathKey = key(field.path);
      const name = leaf(field.path);
      if (field.kind === "credential-ref") continue;
      if (draft.resets.has(pathKey)) {
        if (has(namespace.user, field.path)) {
          ops.push({ op: "unset", path: [...field.path] });
        }
      } else if (!equal(draft.values[name], draft.original[name])) {
        const value = draft.values[name];
        ops.push(value === undefined
          ? { op: "unset", path: [...field.path] }
          : { op: "set", path: [...field.path], value });
      }
    }
    const modelsPath = [...prefixOf(provider), "models"];
    if (draft.resets.has(key(modelsPath))) {
      if (has(namespace.user, modelsPath)) {
        ops.push({ op: "unset", path: modelsPath });
      }
    } else if (!equal(draft.values.models, draft.original.models)) {
      ops.push(draft.values.models === undefined
        ? { op: "unset", path: modelsPath }
        : { op: "set", path: modelsPath, value: draft.values.models });
    }
    if (
      intent.kind === "set" &&
      provider.credentialStatus.kind === "none" &&
      provider.namespace === "llm-pi-ai"
    ) {
      ops.push({
        op: "set",
        path: [...prefixOf(provider), "apiKeyEnv"],
        value: intent.ref,
      });
    }
    if (
      ops.length === 0 &&
      !configured(provider, namespace) &&
      prefixOf(provider).length > 0
    ) {
      ops.push({ op: "set", path: prefixOf(provider), value: {} });
    }
    return ops;
  }

  private startCredential(provider: ModelProviderSettingsWire, draft: Draft): void {
    const intent = draft.credentialIntent;
    if (intent.kind === "keep") {
      draft.status = "idle";
      draft.error = undefined;
      draft.errorKey = undefined;
      this.refresh();
      this.notify();
      return;
    }
    const requestId = this.requestId();
    this.pending = {
      requestId,
      providerId: provider.id,
      stage: "credential",
    };
    this.pendingCredential = {
      kind: intent.kind,
      requestId,
      ref: intent.ref,
    };
    draft.status = "saving-credential";
    this.notify();
  }

  private startCustomCredential(draft: CustomProviderDraft): void {
    if (!draft.storesKey) {
      this.finishCustom();
      return;
    }
    if (!draft.credentialArmed) {
      draft.status = "credential-failed";
      draft.error = undefined;
      draft.errorKey = "modelsSecretReenterCreate";
      this.notify();
      return;
    }
    const requestId = this.requestId();
    this.pending = {
      requestId,
      providerId: draft.route,
      stage: "custom-credential",
    };
    this.pendingCredential = {
      kind: "set",
      requestId,
      ref: deriveCredentialRef(draft.route),
    };
    draft.status = "saving-credential";
    this.notify();
  }

  private receiveCustom(
    operation: PendingOperation,
    message: SettingsMutationMessage,
  ): void {
    const draft = this.customDraft;
    if (draft === undefined) return;
    this.pending = undefined;
    if (!message.result.ok) {
      if (draft.credentialArmed) this.secretEpoch += 1;
      draft.credentialArmed = false;
      if (
        operation.stage === "custom-settings" &&
        message.result.error.code === "settings-conflict"
      ) {
        draft.status = "conflict";
        draft.error = message.result.error.message;
        draft.errorKey = undefined;
        draft.conflictRevision = message.result.error.currentRevision;
        this.refresh();
        this.notify();
        return;
      }
      draft.status = operation.stage === "custom-credential"
        ? "credential-failed"
        : "error";
      draft.error = message.result.error.message;
      draft.errorKey = operation.stage === "custom-credential"
        ? "modelsCredentialStage"
        : "modelsSettingsStage";
      this.refresh();
      this.notify();
      return;
    }
    const result = message.result;
    if (result.namespace !== undefined && this.view !== undefined) {
      const nextNamespace = result.namespace;
      this.view = {
        ...this.view,
        namespaces: this.view.namespaces.map((candidate) =>
          candidate.namespace === nextNamespace.namespace
            ? nextNamespace
            : candidate),
      };
    }
    if (operation.stage === "custom-settings") {
      draft.committed = true;
      if (draft.storesKey) {
        this.startCustomCredential(draft);
        this.refresh();
      } else {
        this.finishCustom();
      }
      return;
    }
    this.finishCustom();
  }

  private finishCustom(): void {
    this.pendingCredential = undefined;
    this.customDraft = undefined;
    this.activeCard = undefined;
    this.refresh();
    this.notify();
  }

  private customSnapshot(
    draft: CustomProviderDraft,
    directory: readonly ModelProviderSettingsWire[],
  ): CustomProviderSnapshot {
    const routeInvalid =
      draft.route.length > 0 && !ROUTE_PATTERN.test(draft.route);
    const routeTaken =
      !draft.committed &&
      directory.some((provider) => provider.id === draft.route);
    const baseURLInvalid =
      draft.baseURL.length > 0 && !isAbsoluteHttpUrl(draft.baseURL);
    const failure = modelError(draft.models);
    const modelFailure = draft.models.length === 0 ? undefined : failure;
    return {
      ...structuredClone(draft),
      routeInvalid,
      routeTaken,
      baseURLInvalid,
      ...(modelFailure === undefined ? {} : { modelError: modelFailure }),
      ready:
        draft.route.length > 0 &&
        !routeInvalid &&
        !routeTaken &&
        draft.baseURL.length > 0 &&
        !baseURLInvalid &&
        draft.protocol.length > 0 &&
        draft.models.length > 0 &&
        failure === undefined,
      retryable:
        draft.status === "conflict" &&
        !routeTaken &&
        (draft.conflictRevision === undefined ||
          (this.namespace("llm-pi-ai")?.revision ?? -1) >=
            draft.conflictRevision),
      readOnly:
        !this.connected || this.namespace("llm-pi-ai")?.writable !== true,
    };
  }

  private customDirty(draft: CustomProviderDraft): boolean {
    return (
      draft.route.length > 0 ||
      draft.displayName.length > 0 ||
      draft.baseURL.length > 0 ||
      draft.models.length > 0
    );
  }

  private startDeleteSettings(
    provider: ModelProviderSettingsWire,
    draft: Draft,
  ): void {
    const namespace = this.namespace(provider.namespace);
    if (namespace === undefined) return;
    const requestId = this.requestId();
    this.pending = {
      requestId,
      providerId: provider.id,
      stage: "delete-settings",
    };
    draft.status = "deleting";
    this.send({
      kind: "mutateSettings",
      requestId,
      namespace: provider.namespace,
      expectedRevision: namespace.revision,
      ops: [{ op: "unset", path: prefixOf(provider) }],
    });
    this.notify();
  }

  private dirtyDraft(draft: Draft): boolean {
    return draft.resets.size > 0 || !equal(draft.values, draft.original);
  }

  private activeDraft(): Draft | undefined {
    return this.activeProviderId === undefined
      ? undefined
      : this.drafts.get(this.activeProviderId);
  }

  private activeProvider(): ModelProviderSettingsWire | undefined {
    return this.activeProviderId === undefined
      ? undefined
      : this.provider(this.activeProviderId);
  }

  private provider(id: string): ModelProviderSettingsWire | undefined {
    return this.view?.providers.find((provider) => provider.id === id);
  }

  private namespace(id: string): SettingsNamespaceWire | undefined {
    return this.view?.namespaces.find((namespace) => namespace.namespace === id);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

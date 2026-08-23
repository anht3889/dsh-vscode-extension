import type {
  AgentPresetContentMessage,
  AgentPresetSettingsItemWire,
  AgentPresetsSettingsView,
  SettingsInboundCommand,
  SettingsMutationMessage,
  SettingsNamespaceWire,
} from "@dsh-vscode/contract";
import type { SettingsHostResultMessage, UiCommandCmd } from "../../../vscode.js";
import type { SettingsCopyKey } from "../../localization/index.js";

const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;
const MAX_PRESET_ID_LENGTH = 64;

type Operation =
  | { kind: "default"; desired: string }
  | { kind: "copy" }
  | { kind: "delete-default" }
  | { kind: "delete" };

type DefaultStatus = "staged" | "saving" | "conflict" | "error";

interface DefaultChange {
  desired: string;
  status: DefaultStatus;
  conflictRevision?: number;
  error?: string;
}

interface CopyDraft {
  fromPresetId: string;
  id: string;
  name: string;
  status: "idle" | "saving" | "error";
  idError?: SettingsCopyKey;
  nameError?: SettingsCopyKey;
  error?: string;
}

interface DeletionDraft {
  presetId: string;
  fallbackId: string;
  status: "idle" | "saving-default" | "deleting" | "conflict" | "error";
  defaultChanged: boolean;
  conflictRevision?: number;
  error?: string;
}

interface ViewerState {
  presetId: string;
  status: "loading" | "ready" | "error";
  content?: string;
  error?: string;
}

export interface AgentPresetRowSnapshot extends AgentPresetSettingsItemWire {
  isDefault: boolean;
}

export interface AgentPresetsSnapshot {
  rows: AgentPresetRowSnapshot[];
  connected: boolean;
  writable: boolean;
  currentDefault?: string;
  defaultChange?: DefaultChange & { retryable: boolean };
  copy?: CopyDraft;
  deletion?: DeletionDraft & {
    fallbackRequired: boolean;
    fallbackOptions: AgentPresetRowSnapshot[];
    retryable: boolean;
  };
  viewer?: ViewerState;
  opening: boolean;
  error?: string;
  dirty: boolean;
}

type HostCommand = Extract<UiCommandCmd, { kind: "openAgentPreset" }>;

export class AgentPresetsController {
  private sectionView?: AgentPresetsSettingsView;
  private connected = true;
  private defaultChange?: DefaultChange;
  private copyDraft?: CopyDraft;
  private deletionDraft?: DeletionDraft;
  private viewerState?: ViewerState;
  private viewerRequestId?: string;
  private openRequestId?: string;
  private error?: string;
  private readonly operations = new Map<string, Operation>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly send: (command: SettingsInboundCommand) => void,
    private readonly sendHost: (command: HostCommand) => void,
    private readonly refreshPresets: () => void,
    private readonly refreshGeneral: () => void,
    private readonly requestId: () => string = () => crypto.randomUUID(),
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): AgentPresetsSnapshot => {
    const rows = this.rows();
    const currentDefault = this.currentDefault();
    const fallbackOptions = this.deletionDraft === undefined
      ? []
      : rows.filter((row) => (
          row.id !== this.deletionDraft?.presetId && row.broken === undefined
        ));
    const fallbackRequired =
      this.deletionDraft !== undefined &&
      currentDefault === this.deletionDraft.presetId &&
      !this.deletionDraft.defaultChanged;
    return {
      rows,
      connected: this.connected,
      writable: this.connected && this.sectionView?.namespace?.writable === true,
      ...(currentDefault === undefined ? {} : { currentDefault }),
      ...(this.defaultChange === undefined
        ? {}
        : {
            defaultChange: {
              ...this.defaultChange,
              retryable: this.retryable(this.defaultChange.conflictRevision),
            },
          }),
      ...(this.copyDraft === undefined ? {} : { copy: { ...this.copyDraft } }),
      ...(this.deletionDraft === undefined
        ? {}
        : {
            deletion: {
              ...this.deletionDraft,
              fallbackRequired,
              fallbackOptions,
              retryable: this.retryable(this.deletionDraft.conflictRevision),
            },
          }),
      ...(this.viewerState === undefined
        ? {}
        : { viewer: { ...this.viewerState } }),
      opening: this.openRequestId !== undefined,
      ...(this.error === undefined ? {} : { error: this.error }),
      dirty:
        this.defaultChange !== undefined ||
        (this.copyDraft !== undefined &&
          (this.copyDraft.id.length > 0 || this.copyDraft.name.length > 0)) ||
        (this.deletionDraft?.fallbackId.length ?? 0) > 0,
    };
  };

  updateView(view: AgentPresetsSettingsView): void {
    this.sectionView = view;
    this.connected = true;
    this.notify();
  }

  disconnect(): void {
    this.connected = false;
    this.operations.clear();
    this.viewerRequestId = undefined;
    this.openRequestId = undefined;
    if (this.copyDraft?.status === "saving") this.copyDraft.status = "idle";
    if (this.defaultChange?.status === "saving") this.defaultChange.status = "staged";
    if (
      this.deletionDraft?.status === "saving-default" ||
      this.deletionDraft?.status === "deleting"
    ) {
      this.deletionDraft.status = "idle";
    }
    if (this.viewerState?.status === "loading") {
      this.viewerState = undefined;
    }
    this.notify();
  }

  discardAll(): void {
    this.operations.clear();
    this.defaultChange = undefined;
    this.copyDraft = undefined;
    this.deletionDraft = undefined;
    this.viewerRequestId = undefined;
    this.viewerState = undefined;
    this.openRequestId = undefined;
    this.error = undefined;
    this.notify();
  }

  makeDefault(id: string): boolean {
    const row = this.rows().find((candidate) => candidate.id === id);
    if (
      row === undefined ||
      row.broken !== undefined ||
      id === this.currentDefault() ||
      this.copyDraft !== undefined ||
      this.deletionDraft !== undefined ||
      !this.canWriteDefault()
    ) return false;
    this.defaultChange = { desired: id, status: "staged" };
    return this.startDefault();
  }

  retryDefault(): boolean {
    if (
      this.defaultChange?.status !== "conflict" ||
      !this.retryable(this.defaultChange.conflictRevision)
    ) return false;
    return this.startDefault();
  }

  discardDefault(): void {
    if (this.hasOperation("default")) return;
    this.defaultChange = undefined;
    this.notify();
  }

  beginCopy(fromPresetId: string): boolean {
    const source = this.rows().find((row) => row.id === fromPresetId);
    if (
      source === undefined ||
      source.broken !== undefined ||
      this.operations.size > 0 ||
      !this.dialogsReplaceable()
    ) return false;
    this.closeDialogs("copy");
    this.copyDraft = {
      fromPresetId,
      id: "",
      name: "",
      status: "idle",
    };
    this.notify();
    return true;
  }

  setCopyId(id: string): void {
    if (this.copyDraft === undefined || this.copyDraft.status === "saving") return;
    this.copyDraft.id = id;
    this.copyDraft.status = "idle";
    this.copyDraft.error = undefined;
    this.validateCopy();
    this.notify();
  }

  setCopyName(name: string): void {
    if (this.copyDraft === undefined || this.copyDraft.status === "saving") return;
    this.copyDraft.name = name;
    this.copyDraft.status = "idle";
    this.copyDraft.error = undefined;
    this.validateCopy();
    this.notify();
  }

  cancelCopy(): void {
    if (this.copyDraft?.status === "saving") return;
    this.copyDraft = undefined;
    this.notify();
  }

  copy(): boolean {
    if (
      !this.connected ||
      this.copyDraft === undefined ||
      this.copyDraft.status === "saving" ||
      this.operations.size > 0
    ) return false;
    this.validateCopy();
    if (
      this.copyDraft.idError !== undefined ||
      this.copyDraft.nameError !== undefined
    ) {
      this.notify();
      return false;
    }
    const requestId = this.requestId();
    this.operations.set(requestId, { kind: "copy" });
    this.copyDraft.status = "saving";
    this.copyDraft.error = undefined;
    this.send({
      kind: "copyAgentPreset",
      requestId,
      fromPresetId: this.copyDraft.fromPresetId,
      presetId: this.copyDraft.id,
      name: this.copyDraft.name.trim(),
    });
    this.notify();
    return true;
  }

  beginDelete(presetId: string): boolean {
    const row = this.rows().find((candidate) => candidate.id === presetId);
    if (
      row?.trust !== "user" ||
      !row.removable ||
      this.deletionDraft?.status === "deleting" ||
      this.operations.size > 0 ||
      !this.dialogsReplaceable()
    ) return false;
    this.closeDialogs("delete");
    this.deletionDraft = {
      presetId,
      fallbackId: "",
      status: "idle",
      defaultChanged: false,
    };
    this.notify();
    return true;
  }

  setDeleteFallback(id: string): void {
    if (
      this.deletionDraft === undefined ||
      this.deletionDraft.status === "saving-default" ||
      this.deletionDraft.status === "deleting"
    ) return;
    const valid = this.rows().some((row) => (
      row.id === id &&
      row.id !== this.deletionDraft?.presetId &&
      row.broken === undefined
    ));
    this.deletionDraft.fallbackId = valid ? id : "";
    this.deletionDraft.status = "idle";
    this.deletionDraft.error = undefined;
    this.deletionDraft.conflictRevision = undefined;
    this.notify();
  }

  cancelDelete(): void {
    if (
      this.deletionDraft?.status === "saving-default" ||
      this.deletionDraft?.status === "deleting"
    ) return;
    this.deletionDraft = undefined;
    this.notify();
  }

  deletePreset(): boolean {
    const draft = this.deletionDraft;
    if (draft === undefined || !this.connected) return false;
    if (draft.defaultChanged || this.currentDefault() !== draft.presetId) {
      return this.startDelete();
    }
    if (draft.fallbackId === "") return false;
    return this.startDeleteDefault();
  }

  retryDelete(): boolean {
    if (
      this.deletionDraft?.status !== "conflict" ||
      !this.retryable(this.deletionDraft.conflictRevision)
    ) return false;
    return this.startDeleteDefault();
  }

  view(presetId: string): boolean {
    const row = this.rows().find((candidate) => candidate.id === presetId);
    if (
      row === undefined ||
      row.broken !== undefined ||
      !this.connected ||
      !this.dialogsReplaceable() ||
      [...this.operations.values()].some((operation) => operation.kind !== "default")
    ) return false;
    this.closeDialogs("viewer");
    const requestId = this.requestId();
    this.viewerRequestId = requestId;
    this.viewerState = { presetId, status: "loading" };
    this.send({ kind: "readAgentPreset", requestId, presetId });
    this.notify();
    return true;
  }

  closeViewer(): void {
    this.viewerRequestId = undefined;
    this.viewerState = undefined;
    this.notify();
  }

  receiveContent(message: AgentPresetContentMessage): boolean {
    if (
      message.requestId !== this.viewerRequestId ||
      this.viewerState === undefined
    ) return false;
    if (
      message.result.ok &&
      message.result.presetId !== this.viewerState.presetId
    ) return false;
    this.viewerRequestId = undefined;
    if (!message.result.ok) {
      this.viewerState = {
        presetId: this.viewerState.presetId,
        status: "error",
        error: message.result.error.message,
      };
    } else {
      this.viewerState = {
        presetId: message.result.presetId,
        status: "ready",
        content: message.result.content,
      };
    }
    this.notify();
    return true;
  }

  open(presetId: string): boolean {
    const row = this.rows().find((candidate) => candidate.id === presetId);
    if (
      row?.trust !== "user" ||
      !row.openable ||
      !this.connected ||
      this.openRequestId !== undefined
    ) return false;
    const requestId = this.requestId();
    this.openRequestId = requestId;
    this.sendHost({ kind: "openAgentPreset", requestId, presetId });
    this.notify();
    return true;
  }

  receiveHost(message: SettingsHostResultMessage): boolean {
    if (
      message.action !== "openAgentPreset" ||
      message.requestId !== this.openRequestId
    ) return false;
    this.openRequestId = undefined;
    this.error = message.result.ok ? undefined : message.result.detail;
    this.notify();
    return true;
  }

  receiveMutation(message: SettingsMutationMessage): boolean {
    const operation = this.operations.get(message.requestId);
    if (operation === undefined) return false;
    const namespaceOperation =
      operation.kind === "default" || operation.kind === "delete-default";
    if (
      (message.result.ok &&
        (namespaceOperation
          ? message.result.namespace?.namespace !== "agent-presets"
          : message.result.namespace !== undefined &&
            message.result.namespace.namespace !== "agent-presets")) ||
      (!message.result.ok &&
        message.result.error.namespace !== undefined &&
        message.result.error.namespace !== "agent-presets")
    ) {
      return false;
    }
    this.operations.delete(message.requestId);
    if (!message.result.ok) {
      this.failOperation(operation, message);
      this.notify();
      return true;
    }
    if (message.result.namespace?.namespace === "agent-presets") {
      this.replaceNamespace(message.result.namespace);
    }
    switch (operation.kind) {
      case "default":
        this.defaultChange = undefined;
        this.refreshBoth();
        break;
      case "copy":
        this.copyDraft = undefined;
        this.refreshBoth();
        break;
      case "delete-default":
        if (this.deletionDraft !== undefined) {
          this.deletionDraft.defaultChanged = true;
          this.deletionDraft.status = "idle";
          this.startDelete();
        }
        this.refreshBoth();
        break;
      case "delete":
        this.deletionDraft = undefined;
        this.refreshBoth();
        break;
    }
    this.notify();
    return true;
  }

  private startDefault(): boolean {
    const change = this.defaultChange;
    if (change === undefined || !this.canWriteDefault()) return false;
    const requestId = this.requestId();
    this.operations.set(requestId, { kind: "default", desired: change.desired });
    change.status = "saving";
    change.error = undefined;
    this.sendDefault(requestId, change.desired);
    this.notify();
    return true;
  }

  private startDeleteDefault(): boolean {
    const draft = this.deletionDraft;
    if (
      draft === undefined ||
      draft.fallbackId === "" ||
      !this.canWriteDefault()
    ) return false;
    const requestId = this.requestId();
    this.operations.set(requestId, { kind: "delete-default" });
    draft.status = "saving-default";
    draft.error = undefined;
    this.sendDefault(requestId, draft.fallbackId);
    this.notify();
    return true;
  }

  private startDelete(): boolean {
    const draft = this.deletionDraft;
    if (draft === undefined || !this.connected || this.operations.size > 0) {
      return false;
    }
    const requestId = this.requestId();
    this.operations.set(requestId, { kind: "delete" });
    draft.status = "deleting";
    draft.error = undefined;
    this.send({ kind: "deleteAgentPreset", requestId, presetId: draft.presetId });
    this.notify();
    return true;
  }

  private sendDefault(requestId: string, desired: string): void {
    this.send({
      kind: "mutateSettings",
      requestId,
      namespace: "agent-presets",
      expectedRevision: this.sectionView!.namespace!.revision,
      ops: [{ op: "set", path: ["default"], value: desired }],
    });
  }

  private failOperation(
    operation: Operation,
    message: Extract<SettingsMutationMessage, { kind: "settingsMutation" }>,
  ): void {
    if (message.result.ok) return;
    const { error } = message.result;
    switch (operation.kind) {
      case "default":
        if (this.defaultChange !== undefined) {
          this.defaultChange.status =
            error.code === "settings-conflict" ? "conflict" : "error";
          this.defaultChange.error = error.message;
          this.defaultChange.conflictRevision = error.currentRevision;
        }
        break;
      case "copy":
        if (this.copyDraft !== undefined) {
          this.copyDraft.status = "error";
          this.copyDraft.error = error.message;
        }
        break;
      case "delete-default":
        if (this.deletionDraft !== undefined) {
          this.deletionDraft.status =
            error.code === "settings-conflict" ? "conflict" : "error";
          this.deletionDraft.error = error.message;
          this.deletionDraft.conflictRevision = error.currentRevision;
        }
        break;
      case "delete":
        if (this.deletionDraft !== undefined) {
          this.deletionDraft.status = "error";
          this.deletionDraft.error = error.message;
        }
        break;
    }
    if (error.code === "settings-conflict") this.refreshBoth();
    else if (operation.kind === "copy" || operation.kind === "delete") {
      this.refreshPresets();
    }
  }

  private validateCopy(): void {
    const draft = this.copyDraft;
    if (draft === undefined) return;
    draft.idError =
      draft.id === ""
        ? "validationRequired"
        : draft.id.length > MAX_PRESET_ID_LENGTH || !PRESET_ID.test(draft.id)
          ? "presetsIdInvalid"
          : this.rows().some((row) => row.id === draft.id)
            ? "presetsIdTaken"
            : undefined;
    draft.nameError =
      draft.name.trim() === "" ? "validationRequired" : undefined;
  }

  private rows(): AgentPresetRowSnapshot[] {
    const currentDefault = this.currentDefault();
    const rows = this.sectionView?.presets ?? [];
    return (["system", "user"] as const).flatMap((trust) =>
      rows
        .filter((row) => row.trust === trust)
        .map((row) => ({ ...row, isDefault: row.id === currentDefault })));
  }

  private currentDefault(): string | undefined {
    const value = this.sectionView?.namespace?.value.default;
    return typeof value === "string" ? value : undefined;
  }

  private canWriteDefault(): boolean {
    return (
      this.connected &&
      this.sectionView?.namespace?.writable === true &&
      this.operations.size === 0
    );
  }

  private closeDialogs(keep: "copy" | "delete" | "viewer"): void {
    if (keep !== "copy") this.copyDraft = undefined;
    if (keep !== "delete") this.deletionDraft = undefined;
    if (keep !== "viewer") {
      this.viewerRequestId = undefined;
      this.viewerState = undefined;
    }
  }

  private dialogsReplaceable(): boolean {
    const copyClean =
      this.copyDraft === undefined ||
      (
        this.copyDraft.status === "idle" &&
        this.copyDraft.id === "" &&
        this.copyDraft.name === ""
      );
    const deleteClean =
      this.deletionDraft === undefined ||
      (
        this.deletionDraft.status === "idle" &&
        this.deletionDraft.fallbackId === "" &&
        !this.deletionDraft.defaultChanged
      );
    return copyClean && deleteClean;
  }

  private retryable(conflictRevision: number | undefined): boolean {
    return (
      this.connected &&
      conflictRevision !== undefined &&
      (this.sectionView?.namespace?.revision ?? -1) >= conflictRevision
    );
  }

  private hasOperation(kind: Operation["kind"]): boolean {
    return [...this.operations.values()].some((operation) => operation.kind === kind);
  }

  private replaceNamespace(namespace: SettingsNamespaceWire): void {
    if (this.sectionView === undefined) return;
    this.sectionView = { ...this.sectionView, namespace };
  }

  private refreshBoth(): void {
    this.refreshPresets();
    this.refreshGeneral();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

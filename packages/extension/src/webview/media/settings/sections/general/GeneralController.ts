import type {
  GeneralSettingsView,
  MutateSettingsCommand,
  SettingsMutationMessage,
  SettingsNamespaceWire,
  SettingsPathOpWire,
} from "@dsh-vscode/contract";

export type GeneralFieldId =
  | "agent-preset"
  | "permission"
  | "locale"
  | "appearance"
  | "busy-enter";

interface GeneralField {
  namespace: string;
  path: string[];
}

const FIELDS: Record<GeneralFieldId, GeneralField> = {
  "agent-preset": { namespace: "agent-presets", path: ["default"] },
  permission: { namespace: "permission", path: ["defaultPreset"] },
  locale: { namespace: "locale", path: ["preference"] },
  appearance: { namespace: "ui-theme", path: ["preference"] },
  "busy-enter": { namespace: "ui-conversation", path: ["busyEnter"] },
};

const ORDER: readonly GeneralFieldId[] = [
  "agent-preset",
  "permission",
  "locale",
  "appearance",
  "busy-enter",
];

export interface GeneralRowSnapshot {
  id: GeneralFieldId;
  namespace: SettingsNamespaceWire;
  value: unknown;
  writable: boolean;
  overridden: boolean;
  status: "idle" | "saving" | "error" | "conflict";
  retryable: boolean;
  error?: string;
}

export interface GeneralSnapshot {
  rows: GeneralRowSnapshot[];
  agentPresets: GeneralSettingsView["agentPresets"];
  permissionPresets: GeneralSettingsView["permissionPresets"];
}

interface RowState {
  descriptor: SettingsNamespaceWire;
  desired?: unknown;
  status: GeneralRowSnapshot["status"];
  error?: string;
  inFlight?: string;
  queued: boolean;
  conflictRevision?: number;
}

type MutationWithoutRequest = Omit<MutateSettingsCommand, "requestId">;

export function mutationFor(
  id: GeneralFieldId,
  value: unknown,
  revision: number,
  unset = false,
): MutationWithoutRequest {
  const field = FIELDS[id];
  const op: SettingsPathOpWire = unset
    ? { op: "unset", path: field.path }
    : { op: "set", path: field.path, value };
  return {
    kind: "mutateSettings",
    namespace: field.namespace,
    expectedRevision: revision,
    ops: [op],
  };
}

function valueAt(
  descriptor: SettingsNamespaceWire,
  path: readonly string[],
): unknown {
  let value: unknown = descriptor.value;
  for (const segment of path) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function hasPath(
  value: Record<string, unknown>,
  path: readonly string[],
): boolean {
  let current: unknown = value;
  for (const segment of path) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !Object.hasOwn(current, segment)
    ) {
      return false;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
}

export class GeneralController {
  private rows = new Map<GeneralFieldId, RowState>();
  private agentPresets: GeneralSettingsView["agentPresets"] = [];
  private permissionPresets: GeneralSettingsView["permissionPresets"] = [];
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly send: (command: MutateSettingsCommand) => void,
    private readonly refresh: () => void,
    private readonly requestId: () => string = () => crypto.randomUUID(),
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): GeneralSnapshot => ({
    rows: ORDER.flatMap((id) => {
      const row = this.rows.get(id);
      if (row === undefined) return [];
      const field = FIELDS[id];
      return [{
        id,
        namespace: row.descriptor,
        value: row.desired ?? valueAt(row.descriptor, field.path),
        writable: row.descriptor.writable,
        overridden: hasPath(row.descriptor.user, field.path),
        status: row.status,
        retryable:
          row.status === "conflict" &&
          (row.conflictRevision === undefined ||
            row.descriptor.revision >= row.conflictRevision),
        ...(row.error === undefined ? {} : { error: row.error }),
      }];
    }),
    agentPresets: this.agentPresets,
    permissionPresets: this.permissionPresets,
  });

  updateView(view: GeneralSettingsView): void {
    this.agentPresets = view.agentPresets;
    this.permissionPresets = view.permissionPresets;
    const byNamespace = new Map(
      view.namespaces.map((descriptor) => [descriptor.namespace, descriptor]),
    );
    for (const id of ORDER) {
      const descriptor = byNamespace.get(FIELDS[id].namespace);
      const existing = this.rows.get(id);
      if (descriptor === undefined) {
        this.rows.delete(id);
      } else if (existing === undefined) {
        this.rows.set(id, {
          descriptor,
          status: "idle",
          queued: false,
        });
      } else {
        existing.descriptor = descriptor;
      }
    }
    this.notify();
  }

  select(id: GeneralFieldId, value: unknown): void {
    const row = this.rows.get(id);
    if (row === undefined || !row.descriptor.writable) return;
    row.desired = value;
    row.error = undefined;
    if (row.inFlight === undefined) {
      this.start(id, row);
    } else {
      row.queued = true;
      this.notify();
    }
  }

  reset(id: GeneralFieldId): void {
    const row = this.rows.get(id);
    if (
      row === undefined ||
      !row.descriptor.writable ||
      row.inFlight !== undefined
    ) {
      return;
    }
    const requestId = this.requestId();
    row.inFlight = requestId;
    row.desired = valueAt(
      { ...row.descriptor, value: row.descriptor.base },
      FIELDS[id].path,
    );
    row.status = "saving";
    row.error = undefined;
    this.send({
      requestId,
      ...mutationFor(id, undefined, row.descriptor.revision, true),
    });
    this.notify();
  }

  receive(message: SettingsMutationMessage): boolean {
    const match = [...this.rows.entries()].find(
      ([, row]) => row.inFlight === message.requestId,
    );
    if (match === undefined) return false;
    const [id, row] = match;
    const expectedNamespace = FIELDS[id].namespace;
    if (
      (message.result.ok &&
        message.result.namespace?.namespace !== expectedNamespace) ||
      (!message.result.ok &&
        message.result.error.namespace !== undefined &&
        message.result.error.namespace !== expectedNamespace)
    ) {
      return false;
    }
    row.inFlight = undefined;
    if (!message.result.ok) {
      row.error = message.result.error.message;
      if (message.result.error.code === "settings-conflict") {
        row.status = "conflict";
        row.conflictRevision = message.result.error.currentRevision;
        this.refresh();
      } else {
        row.desired = undefined;
        row.queued = false;
        row.status = "error";
      }
      this.notify();
      return true;
    }
    if (message.result.namespace !== undefined) {
      row.descriptor = message.result.namespace;
    }
    const accepted = valueAt(row.descriptor, FIELDS[id].path);
    if (row.queued && row.desired !== accepted) {
      row.queued = false;
      this.start(id, row);
      return true;
    }
    row.desired = undefined;
    row.queued = false;
    row.status = "idle";
    row.error = undefined;
    row.conflictRevision = undefined;
    this.notify();
    return true;
  }

  disconnect(): void {
    for (const row of this.rows.values()) {
      row.inFlight = undefined;
      row.queued = false;
      if (row.status === "saving") row.status = "idle";
    }
    this.notify();
  }

  retry(id: GeneralFieldId): void {
    const row = this.rows.get(id);
    if (
      row === undefined ||
      row.status !== "conflict" ||
      row.desired === undefined ||
      row.inFlight !== undefined ||
      (row.conflictRevision !== undefined &&
        row.descriptor.revision < row.conflictRevision)
    ) {
      return;
    }
    this.start(id, row);
  }

  discard(id: GeneralFieldId): void {
    const row = this.rows.get(id);
    if (row === undefined || row.inFlight !== undefined) return;
    row.desired = undefined;
    row.queued = false;
    row.status = "idle";
    row.error = undefined;
    row.conflictRevision = undefined;
    this.notify();
  }

  ownsNamespace(namespace: string): boolean {
    return [...this.rows.values()].some(
      (row) => row.descriptor.namespace === namespace,
    );
  }

  private start(id: GeneralFieldId, row: RowState): void {
    const requestId = this.requestId();
    row.inFlight = requestId;
    row.queued = false;
    row.status = "saving";
    this.send({
      requestId,
      ...mutationFor(
        id,
        row.desired,
        row.descriptor.revision,
        id === "locale" && row.desired === "",
      ),
    });
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

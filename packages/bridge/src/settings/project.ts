import {
  SettingsConflictError,
  type SettingsDescriptor,
} from "@deepseek-ai/dsh-settings";
import type {
  SettingsErrorWire,
  SettingsNamespaceWire,
} from "@dsh-vscode/contract";

const MAX_PROJECTED_NODES = 512;
const MAX_PROJECTED_DEPTH = 16;
const MAX_COLLECTION_ENTRIES = 64;

interface ProjectionState {
  nodes: number;
  seen: WeakSet<object>;
}

function cloneProjected(
  value: unknown,
  state: ProjectionState,
  depth = 0,
): unknown {
  if (depth > MAX_PROJECTED_DEPTH || state.nodes >= MAX_PROJECTED_NODES) {
    throw new RangeError("settings projection limit exceeded");
  }
  state.nodes += 1;
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION_ENTRIES) {
      throw new RangeError("settings projection limit exceeded");
    }
    if (state.seen.has(value)) {
      throw new RangeError("settings projection limit exceeded");
    }
    state.seen.add(value);
    return value.map((item) => cloneProjected(item, state, depth + 1));
  }
  if (typeof value !== "object" || value === null) {
    throw new TypeError("settings projection requires JSON-compatible data");
  }
  if (state.seen.has(value)) {
    throw new RangeError("settings projection limit exceeded");
  }
  state.seen.add(value);
  const entries = Object.entries(value);
  if (entries.length > MAX_COLLECTION_ENTRIES) {
    throw new RangeError("settings projection limit exceeded");
  }
  return Object.fromEntries(
    entries.map(([key, child]) => [
      key,
      cloneProjected(child, state, depth + 1),
    ]),
  );
}

function projectRecord(
  value: unknown,
  state: ProjectionState,
): Record<string, unknown> {
  if (value === undefined) return {};
  const projected = cloneProjected(value, state);
  if (
    typeof projected !== "object"
    || projected === null
    || Array.isArray(projected)
  ) {
    throw new TypeError("settings projection requires an object section");
  }
  return projected as Record<string, unknown>;
}

function removeSecret(
  root: Record<string, unknown>,
  path: readonly string[],
): void {
  let current: unknown = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]!;
    if (Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (typeof current === "object" && current !== null) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return;
    }
  }
  const leaf = path.at(-1);
  if (leaf === undefined) return;
  if (Array.isArray(current)) {
    const index = Number(leaf);
    if (Number.isInteger(index) && index >= 0 && index < current.length) {
      current[index] = null;
    }
  } else if (typeof current === "object" && current !== null) {
    delete (current as Record<string, unknown>)[leaf];
  }
}

/** Convert one already-redacted DSH descriptor into the bounded wire record. */
export function projectNamespace(
  descriptor: SettingsDescriptor,
  writable: boolean,
): SettingsNamespaceWire {
  const secrets = descriptor.secrets ?? [];
  if (secrets.length > MAX_COLLECTION_ENTRIES) {
    throw new RangeError("settings projection limit exceeded");
  }
  const state: ProjectionState = { nodes: 0, seen: new WeakSet() };
  const base = projectRecord(descriptor.base, state);
  const user = projectRecord(descriptor.user, state);
  const value = projectRecord(descriptor.value, state);
  const projectedSecrets = cloneProjected(secrets, state);
  for (const secret of secrets) {
    removeSecret(base, secret.path);
    removeSecret(user, secret.path);
    removeSecret(value, secret.path);
  }
  return {
    namespace: String(descriptor.ns),
    revision: descriptor.revision,
    applies: descriptor.applies,
    writable,
    base,
    user,
    value,
    secrets: projectedSecrets as SettingsNamespaceWire["secrets"],
  };
}

/** Map service failures to the closed settings wire taxonomy. */
export function projectSettingsError(
  error: unknown,
  namespace?: string,
): SettingsErrorWire {
  if (error instanceof SettingsConflictError) {
    return {
      code: "settings-conflict",
      message: error.message,
      ...(namespace === undefined ? {} : { namespace }),
      currentRevision: error.actual,
    };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return { code: "cancelled", message: error.message || "cancelled" };
  }
  if (error instanceof Error) {
    return {
      code: "settings-rejected",
      message: error.message,
      ...(namespace === undefined ? {} : { namespace }),
    };
  }
  return {
    code: "internal",
    message: "Settings operation failed",
    ...(namespace === undefined ? {} : { namespace }),
  };
}

import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import {
  MAX_MCP_ARGS,
  MAX_MCP_DISABLED_TOOLS,
  MAX_MCP_ENV_ENTRIES,
  MAX_MCP_HEADER_NAMES,
  MAX_MCP_LOG_DETAIL_LENGTH,
  MAX_MCP_LOG_ENTRIES,
  MAX_MCP_LOG_MESSAGE_LENGTH,
  MAX_MCP_SCOPES,
  MAX_MCP_SERVERS,
  MAX_MCP_TOOLS,
  MAX_SECRET_VALUE_LENGTH,
  MAX_WIRE_IDENTIFIER_LENGTH,
  MAX_WIRE_URL_LENGTH,
  type McpAuthWire,
  type McpLogEntryWire,
  type McpOperationWire,
  type McpServerDetailWire,
  type McpServerInputWire,
  type McpServerWire,
  type McpSettingsView,
  type McpStatusWire,
} from "@dsh-vscode/contract";
import {
  probeMcpService,
  type McpConnectionStatusLike,
  type McpLogEntryLike,
  type McpManagementService,
  type McpServerRecordLike,
} from "./optional-services.js";
import { assertBounded, truncatePluginMessage } from "./project.js";

/**
 * Aggregate node ceiling for one emitted MCP list view. Sixty-four maximal
 * server records fit below this ceiling and the contract scan budget.
 */
export const MAX_MCP_LIST_VIEW_NODES = 40_960;
/** Aggregate node ceiling for one emitted MCP server detail. */
export const MAX_MCP_DETAIL_NODES = 8_192;
/** Aggregate node ceiling for one emitted MCP logs message. */
export const MAX_MCP_LOGS_MESSAGE_NODES = 16_384;
/** Projection depth ceiling for every MCP projection. */
export const MAX_MCP_VIEW_DEPTH = 16;

const OAUTH_SECRET_NAMES = [
  "OAUTH_ACCESS",
  "OAUTH_REFRESH",
  "OAUTH_EXPIRES_AT",
  "OAUTH_CLIENT_SECRET",
] as const;
const OAUTH_WRITABLE_SECRET_NAMES = ["OAUTH_CLIENT_SECRET"] as const;

export interface McpOperationOutcome {
  /** Absent only for a completed `removeServer`. */
  detail?: McpServerDetailWire;
}

interface McpOperationIds {
  newId(): string;
  now(): string;
}

const DEFAULT_MCP_OPERATION_IDS: McpOperationIds = {
  newId: () => randomUUID(),
  now: () => new Date().toISOString(),
};

function assertNever(value: never): never {
  throw new TypeError(`Unsupported MCP discriminant: ${String(value)}`);
}

function requireMcp(ctx: Context): McpManagementService {
  const probe = probeMcpService(ctx);
  if (probe.state !== "ready") {
    throw new Error("MCP management service is not available");
  }
  return probe.service;
}

function assertCollectionCap(
  value: readonly unknown[],
  cap: number,
  label: string,
): void {
  if (value.length > cap) {
    throw new RangeError(`${label} exceeds ${cap} entries`);
  }
}

function assertString(
  value: unknown,
  max: number,
  label: string,
  allowEmpty = false,
): asserts value is string {
  if (
    typeof value !== "string"
    || (!allowEmpty && value.length === 0)
    || value.length > max
  ) {
    throw new TypeError(`${label} is not a valid bounded string`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
}

function assertPositiveInteger(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
}

function projectAuth(record: McpServerRecordLike): McpAuthWire {
  switch (record.auth.kind) {
    case "none":
      return { kind: "none" };
    case "headers":
      assertCollectionCap(
        record.auth.headerNames,
        MAX_MCP_HEADER_NAMES,
        "MCP header names",
      );
      for (const name of record.auth.headerNames) {
        assertString(name, MAX_WIRE_IDENTIFIER_LENGTH, "MCP header name");
      }
      return { kind: "headers", headerNames: [...record.auth.headerNames] };
    case "oauth":
      assertString(
        record.auth.clientId,
        MAX_WIRE_IDENTIFIER_LENGTH,
        "MCP OAuth client id",
      );
      assertString(
        record.auth.authorizeUrl,
        MAX_WIRE_URL_LENGTH,
        "MCP OAuth authorize URL",
      );
      assertString(
        record.auth.tokenUrl,
        MAX_WIRE_URL_LENGTH,
        "MCP OAuth token URL",
      );
      assertCollectionCap(record.auth.scopes, MAX_MCP_SCOPES, "MCP OAuth scopes");
      for (const scope of record.auth.scopes) {
        assertString(scope, MAX_WIRE_IDENTIFIER_LENGTH, "MCP OAuth scope");
      }
      assertString(
        record.auth.redirectPath,
        MAX_WIRE_IDENTIFIER_LENGTH,
        "MCP OAuth redirect path",
      );
      return {
        kind: "oauth",
        clientId: record.auth.clientId,
        authorizeUrl: record.auth.authorizeUrl,
        tokenUrl: record.auth.tokenUrl,
        scopes: [...record.auth.scopes],
        redirectPath: record.auth.redirectPath,
      };
    default:
      return assertNever(record.auth);
  }
}

/** Project one foreign MCP server record into the closed wire record. */
export function projectMcpServer(record: McpServerRecordLike): McpServerWire {
  assertString(record.id, MAX_WIRE_IDENTIFIER_LENGTH, "MCP server id");
  assertString(record.serverName, MAX_WIRE_IDENTIFIER_LENGTH, "MCP server name");
  if (typeof record.enabled !== "boolean") {
    throw new TypeError("MCP server enabled state must be a boolean");
  }
  if (typeof record.reconnect.enabled !== "boolean") {
    throw new TypeError("MCP reconnect enabled state must be a boolean");
  }
  assertPositiveInteger(record.toolCallTimeoutMs, "MCP tool call timeout");
  assertPositiveInteger(
    record.reconnect.initialDelayMs,
    "MCP reconnect initial delay",
  );
  assertPositiveInteger(record.reconnect.maxDelayMs, "MCP reconnect max delay");
  assertNonNegativeInteger(
    record.reconnect.maxAttempts,
    "MCP reconnect max attempts",
  );
  assertString(record.createdAt, MAX_WIRE_IDENTIFIER_LENGTH, "MCP created time");
  assertString(record.updatedAt, MAX_WIRE_IDENTIFIER_LENGTH, "MCP updated time");

  if (record.args !== undefined) {
    assertCollectionCap(record.args, MAX_MCP_ARGS, "MCP arguments");
    for (const argument of record.args) {
      assertString(
        argument,
        MAX_WIRE_IDENTIFIER_LENGTH,
        "MCP argument",
        true,
      );
    }
  }
  if (record.env !== undefined) {
    const entries = Object.entries(record.env);
    assertCollectionCap(entries, MAX_MCP_ENV_ENTRIES, "MCP environment");
    for (const [name, value] of entries) {
      assertString(name, MAX_WIRE_IDENTIFIER_LENGTH, "MCP environment name");
      assertString(value, MAX_SECRET_VALUE_LENGTH, "MCP environment value", true);
    }
  }
  if (record.disabledTools !== undefined) {
    assertCollectionCap(
      record.disabledTools,
      MAX_MCP_DISABLED_TOOLS,
      "MCP disabled tools",
    );
    for (const name of record.disabledTools) {
      assertString(name, MAX_WIRE_IDENTIFIER_LENGTH, "MCP disabled tool");
    }
  }

  let transportFields: Pick<
    McpServerWire,
    "transport" | "command" | "args" | "env" | "cwd" | "url"
  >;
  switch (record.transport) {
    case "stdio":
      assertString(record.command, MAX_WIRE_IDENTIFIER_LENGTH, "MCP command");
      if (record.cwd !== undefined) {
        assertString(record.cwd, MAX_WIRE_IDENTIFIER_LENGTH, "MCP cwd", true);
      }
      if (record.url !== undefined) {
        throw new TypeError("stdio MCP server cannot carry a URL");
      }
      transportFields = {
        transport: "stdio",
        command: record.command,
        ...(record.args === undefined ? {} : { args: [...record.args] }),
        ...(record.env === undefined
          ? {}
          : {
              env: Object.entries(record.env).map(([name, value]) => ({
                name,
                value,
              })),
            }),
        ...(record.cwd === undefined ? {} : { cwd: record.cwd }),
      };
      break;
    case "streamable-http":
      assertString(record.url, MAX_WIRE_URL_LENGTH, "MCP URL");
      if (
        record.command !== undefined
        || record.args !== undefined
        || record.env !== undefined
        || record.cwd !== undefined
      ) {
        throw new TypeError("streamable-http MCP server carries stdio fields");
      }
      transportFields = { transport: "streamable-http", url: record.url };
      break;
    default:
      return assertNever(record.transport);
  }

  return {
    id: record.id,
    serverName: record.serverName,
    enabled: record.enabled,
    ...transportFields,
    auth: projectAuth(record),
    ...(record.disabledTools === undefined
      ? {}
      : { disabledTools: [...record.disabledTools] }),
    toolCallTimeoutMs: record.toolCallTimeoutMs,
    reconnect: {
      enabled: record.reconnect.enabled,
      initialDelayMs: record.reconnect.initialDelayMs,
      maxDelayMs: record.reconnect.maxDelayMs,
      maxAttempts: record.reconnect.maxAttempts,
    },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Project every foreign MCP connection status variant. */
export function projectMcpStatus(
  status: McpConnectionStatusLike,
): McpStatusWire {
  switch (status.state) {
    case "disconnected":
      return { state: "disconnected" };
    case "connecting":
      assertNonNegativeInteger(status.attempt, "MCP connection attempt");
      return { state: "connecting", attempt: status.attempt };
    case "connected":
      assertNonNegativeInteger(status.toolCount, "MCP connected tool count");
      assertString(
        status.connectedAt,
        MAX_WIRE_IDENTIFIER_LENGTH,
        "MCP connected time",
      );
      return {
        state: "connected",
        toolCount: status.toolCount,
        connectedAt: status.connectedAt,
      };
    case "reconnecting":
      assertNonNegativeInteger(status.attempt, "MCP reconnect attempt");
      assertNonNegativeInteger(status.nextDelayMs, "MCP reconnect delay");
      return {
        state: "reconnecting",
        attempt: status.attempt,
        nextDelayMs: status.nextDelayMs,
      };
    case "failed":
      assertString(status.at, MAX_WIRE_IDENTIFIER_LENGTH, "MCP failure time");
      return {
        state: "failed",
        error: typeof status.error === "string" && status.error.length > 0
          ? truncatePluginMessage(status.error)
          : "MCP connection failed",
        at: status.at,
      };
    default:
      return assertNever(status);
  }
}

/** Return the value-free secret names implied by a server's auth record. */
export function secretNamesFor(record: McpServerRecordLike): string[] {
  switch (record.auth.kind) {
    case "none":
      return [];
    case "headers":
      assertCollectionCap(
        record.auth.headerNames,
        MAX_MCP_HEADER_NAMES,
        "MCP header names",
      );
      return [...record.auth.headerNames];
    case "oauth":
      return [...OAUTH_SECRET_NAMES];
    default:
      return assertNever(record.auth);
  }
}

/** Return the secret names one MCP record permits the editor to write. */
export function writableSecretNamesFor(record: McpServerRecordLike): string[] {
  switch (record.auth.kind) {
    case "none":
      return [];
    case "headers":
      assertCollectionCap(
        record.auth.headerNames,
        MAX_MCP_HEADER_NAMES,
        "MCP header names",
      );
      return [...record.auth.headerNames];
    case "oauth":
      return [...OAUTH_WRITABLE_SECRET_NAMES];
    default:
      return assertNever(record.auth);
  }
}

function requireRecord(
  service: McpManagementService,
  serverId: string,
): McpServerRecordLike {
  const record = service.get(serverId);
  if (record === undefined) {
    throw new Error(truncatePluginMessage(`MCP server "${serverId}" was not found`));
  }
  return record;
}

function composeRecord(
  service: McpManagementService,
  input: McpServerInputWire,
  ids: McpOperationIds,
): McpServerRecordLike {
  const existing = input.serverId === undefined
    ? undefined
    : requireRecord(service, input.serverId);
  const id = input.serverId ?? ids.newId();
  if (
    input.serverId === undefined
    && service.list().some((record) => record.id === id)
  ) {
    throw new Error(truncatePluginMessage(`MCP server id "${id}" already exists`));
  }
  const now = ids.now();
  const transportFields: Pick<
    McpServerRecordLike,
    "transport" | "command" | "args" | "env" | "cwd" | "url"
  > = input.transport === "stdio"
    ? {
        transport: "stdio",
        ...(input.command === undefined ? {} : { command: input.command }),
        ...(input.args === undefined ? {} : { args: [...input.args] }),
        ...(input.env === undefined
          ? {}
          : {
              env: Object.fromEntries(
                input.env.map(({ name, value }) => [name, value]),
              ),
            }),
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      }
    : {
        transport: "streamable-http",
        ...(input.url === undefined ? {} : { url: input.url }),
      };
  const auth = input.auth.kind === "none"
    ? { kind: "none" as const }
    : input.auth.kind === "headers"
      ? {
          kind: "headers" as const,
          headerNames: [...input.auth.headerNames],
        }
      : {
          kind: "oauth" as const,
          clientId: input.auth.clientId,
          authorizeUrl: input.auth.authorizeUrl,
          tokenUrl: input.auth.tokenUrl,
          scopes: [...input.auth.scopes],
          redirectPath: input.auth.redirectPath,
        };
  return {
    id,
    serverName: input.serverName,
    enabled: input.enabled,
    ...transportFields,
    auth,
    ...(existing?.disabledTools === undefined
      ? {}
      : { disabledTools: [...existing.disabledTools] }),
    toolCallTimeoutMs: input.toolCallTimeoutMs,
    reconnect: {
      enabled: input.reconnect.enabled,
      initialDelayMs: input.reconnect.initialDelayMs,
      maxDelayMs: input.reconnect.maxDelayMs,
      maxAttempts: input.reconnect.maxAttempts,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function pluginMessage(error: unknown, fallback: string): string {
  return truncatePluginMessage(
    error instanceof Error && error.message.length > 0 ? error.message : fallback,
  );
}

async function runPluginOperation<T>(
  operation: () => Promise<T>,
  fallback: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(pluginMessage(error, fallback));
  }
}

/**
 * Apply one MCP mutation against a freshly probed service and return fresh,
 * bounded detail unless the server was removed.
 */
export async function runMcpOperation(
  ctx: Context,
  operation: McpOperationWire,
  ids: McpOperationIds = DEFAULT_MCP_OPERATION_IDS,
): Promise<McpOperationOutcome> {
  const service = requireMcp(ctx);
  let serverId: string;
  switch (operation.kind) {
    case "upsertServer": {
      const record = composeRecord(service, operation.server, ids);
      await runPluginOperation(
        () => service.upsert(record),
        `MCP server "${record.id}" was rejected`,
      );
      serverId = record.id;
      break;
    }
    case "removeServer":
      requireRecord(service, operation.serverId);
      await runPluginOperation(
        () => service.remove(operation.serverId),
        `MCP server "${operation.serverId}" could not be removed`,
      );
      return {};
    case "setServerEnabled":
      requireRecord(service, operation.serverId);
      await runPluginOperation(
        () => service.setEnabled(operation.serverId, operation.enabled),
        `MCP server "${operation.serverId}" could not be ${
          operation.enabled ? "enabled" : "disabled"
        }`,
      );
      serverId = operation.serverId;
      break;
    case "connectServer":
      requireRecord(service, operation.serverId);
      await runPluginOperation(
        () => service.connect(operation.serverId),
        `MCP server "${operation.serverId}" could not connect`,
      );
      serverId = operation.serverId;
      break;
    case "disconnectServer":
      requireRecord(service, operation.serverId);
      await runPluginOperation(
        () => service.disconnect(operation.serverId),
        `MCP server "${operation.serverId}" could not disconnect`,
      );
      serverId = operation.serverId;
      break;
    case "setToolEnabled":
      requireRecord(service, operation.serverId);
      if (!service.getTools(operation.serverId).some(
        (tool) => tool.name === operation.toolName,
      )) {
        throw new Error(truncatePluginMessage(
          `MCP tool "${operation.toolName}" was not found on server "${operation.serverId}"`,
        ));
      }
      await runPluginOperation(
        () =>
          service.setToolEnabled(
            operation.serverId,
            operation.toolName,
            operation.enabled,
          ),
        `MCP tool "${operation.toolName}" on server "${operation.serverId}" ` +
          `could not be ${operation.enabled ? "enabled" : "disabled"}`,
      );
      serverId = operation.serverId;
      break;
    case "setServerSecrets": {
      const record = requireRecord(service, operation.serverId);
      const writable = new Set(writableSecretNamesFor(record));
      const unauthorized = operation.secrets
        .map(({ name }) => name)
        .filter((name) => !writable.has(name));
      if (unauthorized.length > 0) {
        throw new Error(truncatePluginMessage(
          `MCP server "${operation.serverId}" does not authorize secrets: ${
            unauthorized.join(", ")
          }`,
        ));
      }
      const names = operation.secrets.map(({ name }) => name);
      try {
        await service.setSecrets(
          operation.serverId,
          Object.fromEntries(
            operation.secrets.map(({ name, value }) => [name, value]),
          ),
        );
      } catch {
        throw new Error(
          `Could not store MCP secrets for server "${operation.serverId}": ${
            names.join(", ")
          }`,
        );
      }
      serverId = operation.serverId;
      break;
    }
    case "clearOAuthTokens":
      requireRecord(service, operation.serverId);
      await runPluginOperation(
        () => service.clearOAuth(operation.serverId),
        `OAuth tokens for MCP server "${operation.serverId}" could not be cleared`,
      );
      serverId = operation.serverId;
      break;
    default:
      return assertNever(operation);
  }
  return { detail: await buildMcpDetail(ctx, serverId) };
}

/** Build the bounded MCP server-list settings projection. */
export async function buildMcpView(ctx: Context): Promise<McpSettingsView> {
  const service = requireMcp(ctx);
  const records = service.list();
  assertCollectionCap(records, MAX_MCP_SERVERS, "MCP servers");
  const view: McpSettingsView = {
    section: "mcp",
    servers: records.map((record) => {
      const tools = service.getTools(record.id);
      assertCollectionCap(tools, MAX_MCP_TOOLS, "MCP tools");
      return {
        server: projectMcpServer(record),
        status: projectMcpStatus(service.getStatus(record.id)),
        toolCount: tools.length,
        disabledToolCount: record.disabledTools?.length ?? 0,
      };
    }),
    secretStates: service.describeSecrets === undefined
      ? "unavailable"
      : "available",
    oauth: { kind: "manual", reason: "no-callback-origin" },
  };
  assertBounded(
    view,
    MAX_MCP_LIST_VIEW_NODES,
    MAX_MCP_VIEW_DEPTH,
    "MCP settings view",
  );
  return view;
}

/** Build one bounded MCP server detail with value-free secret state. */
export async function buildMcpDetail(
  ctx: Context,
  serverId: string,
): Promise<McpServerDetailWire> {
  const service = requireMcp(ctx);
  const record = service.get(serverId);
  if (record === undefined) {
    throw new Error(truncatePluginMessage(`MCP server "${serverId}" was not found`));
  }
  const tools = service.getTools(serverId);
  assertCollectionCap(tools, MAX_MCP_TOOLS, "MCP tools");
  const names = secretNamesFor(record);
  let secrets: McpServerDetailWire["secrets"] = { kind: "unknown" };
  if (service.describeSecrets !== undefined) {
    try {
      const described = await service.describeSecrets(serverId);
      secrets = {
        kind: "known",
        secrets: names.map((name) => ({
          name,
          configured: described[name]?.configured === true,
        })),
      };
    } catch {
      // Optional value-free secret reporting may be absent at runtime.
    }
  }
  const detail: McpServerDetailWire = {
    server: projectMcpServer(record),
    status: projectMcpStatus(service.getStatus(serverId)),
    tools: tools.map((tool) => {
      assertString(tool.name, MAX_WIRE_IDENTIFIER_LENGTH, "MCP tool name");
      const description = tool.description ?? "";
      assertString(
        description,
        MAX_MCP_LOG_DETAIL_LENGTH,
        "MCP tool description",
        true,
      );
      if (typeof tool.enabled !== "boolean") {
        throw new TypeError("MCP tool enabled state must be a boolean");
      }
      return {
        name: tool.name,
        description,
        enabled: tool.enabled,
      };
    }),
    secrets,
  };
  assertBounded(
    detail,
    MAX_MCP_DETAIL_NODES,
    MAX_MCP_VIEW_DEPTH,
    "MCP server detail",
  );
  return detail;
}

function projectLogEntry(entry: McpLogEntryLike): McpLogEntryWire {
  assertString(entry.at, MAX_WIRE_IDENTIFIER_LENGTH, "MCP log timestamp");
  if (entry.level !== "info" && entry.level !== "warn" && entry.level !== "error") {
    throw new TypeError(`Unsupported MCP log level: ${String(entry.level)}`);
  }
  if (typeof entry.message !== "string") {
    throw new TypeError("MCP log message must be a string");
  }
  if (entry.detail !== undefined && typeof entry.detail !== "string") {
    throw new TypeError("MCP log detail must be a string");
  }
  return {
    at: entry.at,
    level: entry.level,
    message: entry.message.slice(0, MAX_MCP_LOG_MESSAGE_LENGTH),
    ...(entry.detail === undefined
      ? {}
      : { detail: entry.detail.slice(0, MAX_MCP_LOG_DETAIL_LENGTH) }),
  };
}

/** Read one incremental, bounded MCP log page from a freshly probed service. */
export function readMcpLogs(
  ctx: Context,
  serverId: string,
  after?: number,
): { serverId: string; next: number; entries: McpLogEntryWire[] } {
  const service = requireMcp(ctx);
  if (service.get(serverId) === undefined) {
    throw new Error(truncatePluginMessage(`MCP server "${serverId}" was not found`));
  }
  const logs = service.getLogs(serverId, after);
  assertNonNegativeInteger(logs.next, "MCP log cursor");
  assertCollectionCap(logs.entries, MAX_MCP_LOG_ENTRIES, "MCP log entries");
  const result = {
    serverId,
    next: logs.next,
    entries: logs.entries.map(projectLogEntry),
  };
  assertBounded(
    result,
    MAX_MCP_LOGS_MESSAGE_NODES,
    MAX_MCP_VIEW_DEPTH,
    "MCP logs message",
  );
  return result;
}

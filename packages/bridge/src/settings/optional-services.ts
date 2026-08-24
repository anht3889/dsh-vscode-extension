import type { Context } from "@deepseek-ai/cordis";

export interface McpServerRecordLike {
  id: string;
  serverName: string;
  enabled: boolean;
  transport: "stdio" | "streamable-http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  auth:
    | { kind: "none" }
    | { kind: "headers"; headerNames: string[] }
    | {
        kind: "oauth";
        clientId: string;
        authorizeUrl: string;
        tokenUrl: string;
        scopes: string[];
        redirectPath: string;
      };
  disabledTools?: string[];
  toolCallTimeoutMs: number;
  reconnect: {
    enabled: boolean;
    initialDelayMs: number;
    maxDelayMs: number;
    maxAttempts: number;
  };
  createdAt: string;
  updatedAt: string;
}

export type McpConnectionStatusLike =
  | { state: "disconnected" }
  | { state: "connecting"; attempt: number }
  | { state: "connected"; toolCount: number; connectedAt: string }
  | { state: "reconnecting"; attempt: number; nextDelayMs: number }
  | { state: "failed"; error: string; at: string };

export interface McpToolInfoLike {
  name: string;
  description?: string;
  enabled: boolean;
}

export interface McpLogEntryLike {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
}

/** Structural view of the optional MCP management service. */
export interface McpManagementService {
  list(): McpServerRecordLike[];
  get(id: string): McpServerRecordLike | undefined;
  upsert(record: McpServerRecordLike): Promise<McpServerRecordLike>;
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  connect(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  getStatus(id: string): McpConnectionStatusLike;
  getLogs(id: string, after?: number): {
    next: number;
    entries: McpLogEntryLike[];
  };
  getTools(id: string): McpToolInfoLike[];
  setToolEnabled(id: string, toolName: string, enabled: boolean): Promise<void>;
  clearOAuth(id: string): Promise<void>;
  setSecrets(id: string, secrets: Record<string, string>): Promise<void>;
  describeSecrets?(id: string): Promise<Record<string, { configured: boolean }>>;
  onCatalogChanged?(listener: () => void): () => void;
}

export interface WebSearchCatalogLike {
  engine: "tavily" | "brave" | "searxng" | null;
  engines: {
    tavily?: { baseURL?: string };
    brave?: { baseURL?: string };
    searxng?: { baseURL?: string };
  };
}

/** Structural view of the optional Web Search management service. */
export interface WebSearchManagementService {
  getCatalog(): WebSearchCatalogLike;
  putCatalog(catalog: WebSearchCatalogLike): Promise<WebSearchCatalogLike>;
  describeSecrets(): Promise<Record<string, { configured: boolean }>>;
  putSecrets(partial: Record<string, string>): Promise<void>;
  available(): boolean;
  onChanged?(listener: () => void): () => void;
}

export const MCP_SERVICE_NAME = "mcp" as const;
export const WEB_SEARCH_SERVICE_NAME = "webSearchManager" as const;

export const MCP_REQUIRED_MEMBERS: readonly string[] = [
  "list",
  "get",
  "upsert",
  "remove",
  "setEnabled",
  "connect",
  "disconnect",
  "getStatus",
  "getLogs",
  "getTools",
  "setToolEnabled",
  "clearOAuth",
  "setSecrets",
];

export const WEB_SEARCH_REQUIRED_MEMBERS: readonly string[] = [
  "getCatalog",
  "putCatalog",
  "describeSecrets",
  "putSecrets",
  "available",
];

export type OptionalServiceProbe<T> =
  | { state: "absent" }
  | { state: "incomplete"; missing: string[] }
  | { state: "ready"; service: T };

function probeService<T>(
  value: unknown,
  requiredMembers: readonly string[],
): OptionalServiceProbe<T> {
  if (value === undefined) return { state: "absent" };
  const candidate = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
  const missing = requiredMembers.filter(
    (member) => typeof candidate[member] !== "function",
  );
  if (missing.length > 0) return { state: "incomplete", missing };
  // This crosses an untyped optional-plugin line after every required method
  // has been verified above.
  return { state: "ready", service: value as T };
}

export function probeMcpService(
  ctx: Context,
): OptionalServiceProbe<McpManagementService> {
  return probeService(ctx.get(MCP_SERVICE_NAME), MCP_REQUIRED_MEMBERS);
}

export function probeWebSearchService(
  ctx: Context,
): OptionalServiceProbe<WebSearchManagementService> {
  return probeService(
    ctx.get(WEB_SEARCH_SERVICE_NAME),
    WEB_SEARCH_REQUIRED_MEMBERS,
  );
}

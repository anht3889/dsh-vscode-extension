// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  EncodedImageAttachment,
  McpServerDetailWire,
  McpServerWire,
  McpSettingsView,
  OutboundMessage,
  SettingsSectionId,
  SettingsSectionMessage,
  SlashMenuItem,
} from "@dsh-vscode/contract";
import type { UiCommand } from "./vscode.js";
import type { SettingsHostResultMessage } from "./vscode.js";

const postMessage = vi.fn<(message: unknown) => void>();
const setState = vi.fn<(state: unknown) => void>();
let retainedState: unknown;
let App: () => JSX.Element;

const SKILL: SlashMenuItem = {
  source: "skill",
  name: "brainstorming",
  description: "Design first",
  behavior: "insert",
};

const INPUT_COMMAND: SlashMenuItem = {
  source: "command",
  name: "goal",
  description: "Set the goal",
  behavior: "command-input",
  hint: "<objective>",
  acceptsImages: true,
};

const TEXT_ONLY_COMMAND: SlashMenuItem = {
  ...INPUT_COMMAND,
  name: "review",
  description: "Review code",
  acceptsImages: false,
};

const BARE_COMMAND: SlashMenuItem = {
  source: "command",
  name: "compact",
  description: "Compact context",
  behavior: "execute",
};

const IMAGE: EncodedImageAttachment = {
  mediaType: "image/png",
  data: "AQ==",
  name: "shot.png",
};

const GENERAL = {
  section: "general" as const,
  namespaces: [],
  agentPresets: [],
  permissionPresets: [],
};

const FULL_GENERAL = {
  section: "general" as const,
  namespaces: [
    {
      namespace: "agent-presets",
      revision: 1,
      applies: "live" as const,
      writable: true,
      base: { default: "standard" },
      user: {},
      value: { default: "standard" },
      secrets: [],
    },
    {
      namespace: "permission",
      revision: 2,
      applies: "live" as const,
      writable: true,
      base: { defaultPreset: "workspace-write" },
      user: {},
      value: { defaultPreset: "workspace-write" },
      secrets: [],
    },
    {
      namespace: "locale",
      revision: 3,
      applies: "live" as const,
      writable: true,
      base: { preference: "en" },
      user: {},
      value: { preference: "en" },
      secrets: [],
    },
    {
      namespace: "ui-theme",
      revision: 4,
      applies: "live" as const,
      writable: true,
      base: { preference: "system" },
      user: {},
      value: { preference: "system" },
      secrets: [],
    },
    {
      namespace: "ui-conversation",
      revision: 5,
      applies: "live" as const,
      writable: true,
      base: { busyEnter: "queue" },
      user: { busyEnter: "steer" },
      value: { busyEnter: "steer" },
      secrets: [],
    },
  ],
  agentPresets: [{ id: "standard", label: "Standard", trust: "system" as const }],
  permissionPresets: [
    { id: "workspace-write", label: "Workspace Write", dangerous: false },
    { id: "danger-full-access", label: "Full Access", dangerous: true },
  ],
};

const MODELS = {
  section: "models" as const,
  namespaces: [{
    namespace: "llm-deepseek",
    revision: 1,
    applies: "live" as const,
    writable: true,
    base: {
      apiKeyEnv: "DEEPSEEK_API_KEY",
      baseURL: "https://api.deepseek.com",
    },
    user: {},
    value: {
      apiKeyEnv: "DEEPSEEK_API_KEY",
      baseURL: "https://api.deepseek.com",
    },
    secrets: [],
  }],
  providers: [{
    id: "deepseek-official",
    namespace: "llm-deepseek",
    label: "DeepSeek",
    active: true,
    catalog: { kind: "ready" as const },
    credential: {
      ref: "DEEPSEEK_API_KEY",
      set: false,
      writable: true,
    },
    credentialStatus: { kind: "ready" as const },
    models: [{ id: "chat", label: "Chat" }],
    removable: false,
    fields: [
      {
        path: ["apiKeyEnv"],
        label: "API key reference",
        kind: "credential-ref" as const,
      },
      { path: ["baseURL"], label: "Base URL", kind: "string" as const },
    ],
  }],
  credentials: [{
    ref: "DEEPSEEK_API_KEY",
    set: false,
    writable: true,
  }],
};

const CUSTOM_MODELS = {
  section: "models" as const,
  namespaces: [{
    namespace: "llm-pi-ai",
    revision: 7,
    applies: "live" as const,
    writable: true,
    base: { providers: {} },
    user: {},
    value: { providers: {} },
    secrets: [],
  }],
  providers: [{
    id: "openai",
    namespace: "llm-pi-ai",
    label: "OpenAI",
    active: false,
    declared: false,
    catalog: { kind: "dormant" as const },
    credentialStatus: { kind: "none" as const },
    models: [],
    removable: false,
    fields: [{
      path: ["providers", "openai", "api"],
      label: "API",
      kind: "union" as const,
      options: [{
        value: "openai-completions",
        label: "OpenAI Completions",
      }],
    }],
  }],
  credentials: [],
};

const PLUGINS = {
  section: "plugins" as const,
  namespaces: [{
    namespace: "shell",
    revision: 4,
    applies: "restart" as const,
    writable: true,
    base: { timeoutMs: 10_000, maxOutputBytes: 1_000_000 },
    user: {},
    value: { timeoutMs: 10_000, maxOutputBytes: 1_000_000 },
    secrets: [],
  }],
  configurable: [{
    namespace: "shell",
    label: "Shell",
    fields: [{
      path: ["timeoutMs"],
      label: "Timeout (ms)",
      kind: "number" as const,
    }, {
      path: ["maxOutputBytes"],
      label: "Maximum output bytes",
      kind: "number" as const,
    }],
  }],
  inventory: [{
    entryId: "shell",
    moduleName: "@deepseek-ai/dsh-shell",
    enabled: true,
    fiberPhase: "active" as const,
  }],
};

const MULTI_PLUGINS = {
  ...PLUGINS,
  namespaces: [
    ...PLUGINS.namespaces,
    {
      namespace: "agent-loop",
      revision: 6,
      applies: "restart" as const,
      writable: true,
      base: { maxParallelToolCalls: 4 },
      user: {},
      value: { maxParallelToolCalls: 4 },
      secrets: [],
    },
  ],
  configurable: [
    ...PLUGINS.configurable,
    {
      namespace: "agent-loop",
      label: "Agent Loop",
      fields: [{
        path: ["maxParallelToolCalls"],
        label: "Maximum parallel tool calls",
        kind: "number" as const,
        min: 1,
        step: 1,
      }],
    },
  ],
};

const READ_ONLY_WEB_PLUGINS = {
  section: "plugins" as const,
  namespaces: [{
    namespace: "web-search-deepseek",
    revision: 2,
    applies: "live" as const,
    writable: false,
    base: { baseURL: "", maxUses: 5 },
    user: {},
    value: { baseURL: "", maxUses: 5 },
    secrets: [],
  }],
  configurable: [{
    namespace: "web-search-deepseek",
    label: "Web Search",
    fields: [{
      path: ["baseURL"],
      label: "Base URL",
      kind: "string" as const,
    }, {
      path: ["maxUses"],
      label: "Maximum uses",
      kind: "number" as const,
      min: 1,
      step: 1,
    }],
    credential: {
      ref: "DEEPSEEK_API_KEY",
      set: true,
      source: "file",
      writable: true,
    },
    credentialStatus: { kind: "ready" as const },
  }],
  inventory: [],
};

const WEB_SEARCH = {
  section: "web-search" as const,
  engine: "tavily" as const,
  engines: [
    {
      engine: "tavily" as const,
      defaultBaseURL: "https://api.tavily.com",
      baseURLRequired: false,
      secretRef: "TAVILY_API_KEY" as const,
    },
    {
      engine: "brave" as const,
      defaultBaseURL: "https://api.search.brave.com",
      baseURLRequired: false,
      secretRef: "BRAVE_API_KEY" as const,
    },
    {
      engine: "searxng" as const,
      baseURLRequired: true,
    },
  ],
  secrets: [
    { ref: "TAVILY_API_KEY" as const, configured: false, writable: true },
    { ref: "BRAVE_API_KEY" as const, configured: false, writable: true },
  ],
  available: false,
};

const MCP_SERVER: McpServerWire = {
  id: "alpha",
  serverName: "Alpha",
  enabled: false,
  transport: "stdio",
  command: "alpha-mcp",
  auth: { kind: "none" },
  toolCallTimeoutMs: 30_000,
  reconnect: {
    enabled: true,
    initialDelayMs: 1_000,
    maxDelayMs: 30_000,
    maxAttempts: 5,
  },
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
};

const MCP: McpSettingsView = {
  section: "mcp",
  servers: [{
    server: MCP_SERVER,
    status: { state: "disconnected" },
    toolCount: 0,
    disabledToolCount: 0,
  }],
  secretStates: "available",
  oauth: {
    kind: "manual",
    reason: "no-callback-origin",
    discovery: "available",
    authorization: "unavailable",
  },
};

function mcpView(...servers: McpServerDetailWire[]): McpSettingsView {
  return {
    ...MCP,
    servers: servers.map((detail) => ({
      server: detail.server,
      status: detail.status,
      toolCount: detail.tools.length,
      disabledToolCount: detail.tools.filter((tool) => !tool.enabled).length,
    })),
  };
}

function mcpDetail(
  server: McpServerWire,
  extra: Partial<Omit<McpServerDetailWire, "server">> = {},
): McpServerDetailWire {
  return {
    server,
    status: { state: "disconnected" },
    tools: [],
    secrets: { kind: "known", secrets: [] },
    ...extra,
  };
}

const AGENT_PRESETS = {
  section: "agent-presets" as const,
  namespace: {
    namespace: "agent-presets",
    revision: 3,
    applies: "live" as const,
    writable: true,
    base: { default: "standard" },
    user: {},
    value: { default: "standard" },
    secrets: [],
  },
  presets: [{
    id: "standard",
    trust: "system" as const,
    name: "Standard",
    description: "Built in",
    removable: false,
    openable: false,
  }, {
    id: "mine",
    trust: "user" as const,
    name: "Mine",
    description: "Personal",
    removable: true,
    openable: true,
  }],
};

beforeAll(async () => {
  vi.stubGlobal("acquireVsCodeApi", () => ({
    postMessage,
    getState: () => retainedState,
    setState: (state: unknown) => {
      retainedState = state;
      setState(state);
    },
  }));
  ({ App } = await import("./App.js"));
});

afterEach(() => {
  cleanup();
  postMessage.mockClear();
  setState.mockClear();
  retainedState = undefined;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function host(
  message:
    | OutboundMessage
    | { kind: "imagesPicked"; images: EncodedImageAttachment[] }
    | { kind: "hostDisconnected"; detail: string }
    | {
        kind: "settingsFullAccessConfirmation";
        requestId: string;
        confirmed: boolean;
      }
    | SettingsHostResultMessage,
): void {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: message }));
  });
}

function renderReady(): HTMLTextAreaElement {
  render(<App />);
  host({
    kind: "ready",
    sessionId: "session-1",
    cwd: "/workspace",
    models: {
      current: { provider: "deepseek", model: "chat" },
      models: [{ provider: "deepseek", model: "chat", label: "Chat" }],
    },
    permissions: {
      current: "workspace-write",
      presets: [{ id: "workspace-write", label: "Workspace Write" }],
    },
    context: { used: 0, window: 128_000 },
  });
  return screen.getByPlaceholderText("Message DeepSeek Harness…") as HTMLTextAreaElement;
}

function commands(kind: UiCommand["cmd"]["kind"]): UiCommand["cmd"][] {
  return postMessage.mock.calls
    .map(([message]) => message)
    .filter(
      (message): message is UiCommand =>
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "dsh/ui" &&
        "cmd" in message,
    )
    .map((message) => message.cmd)
    .filter((command) => command.kind === kind);
}

function sectionReads(section: SettingsSectionId): string[] {
  return commands("getSettingsSection").flatMap((command) =>
    command.kind === "getSettingsSection" && command.section === section
      ? [command.requestId]
      : [],
  );
}

function answerSectionRead(
  section: SettingsSectionId,
  view: NonNullable<SettingsSectionMessage["view"]>,
): void {
  const requestId = sectionReads(section).at(-1);
  if (requestId === undefined) {
    throw new Error(`expected a ${section} section read`);
  }
  host({ kind: "settingsSection", requestId, view });
}

function openMcpSection(view: McpSettingsView = MCP): void {
  renderReady();
  host({ kind: "settingsCapabilities", sections: ["mcp", "web-search"] });
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "MCP" }));
  answerSectionRead("mcp", view);
}

function lastMcpOperation(): { requestId: string; operation: unknown } {
  const command = commands("runMcpOperation").at(-1);
  if (command?.kind !== "runMcpOperation") {
    throw new Error("expected an MCP operation");
  }
  return command;
}

function answerMcpOperation(detail?: McpServerDetailWire): void {
  host({
    kind: "mcpOperation",
    requestId: lastMcpOperation().requestId,
    result: detail === undefined ? { ok: true } : { ok: true, detail },
  });
}

function answerMcpDetail(detail: McpServerDetailWire): void {
  const command = commands("getMcpServer").at(-1);
  if (command?.kind !== "getMcpServer") {
    throw new Error("expected an MCP detail read");
  }
  host({
    kind: "mcpServer",
    requestId: command.requestId,
    result: { ok: true, detail },
  });
}

function openMcpDetail(detail: McpServerDetailWire = mcpDetail(MCP_SERVER)): void {
  fireEvent.click(screen.getByRole("button", {
    name: new RegExp(`${detail.server.serverName}.*Standard input|${detail.server.serverName}.*Streamable HTTP`),
  }));
  answerMcpDetail(detail);
}

function openMcpEditor(detail: McpServerDetailWire = mcpDetail(MCP_SERVER)): void {
  openMcpDetail(detail);
  fireEvent.click(screen.getByRole("button", {
    name: `Edit ${detail.server.serverName}`,
  }));
}

async function openSlash(
  input: HTMLTextAreaElement,
  text: string,
  caret: number,
): Promise<string> {
  fireEvent.change(input, {
    target: { value: text, selectionStart: caret, selectionEnd: caret },
  });
  await waitFor(() => expect(commands("listSlashItems")).toHaveLength(1));
  const request = commands("listSlashItems")[0];
  if (request?.kind !== "listSlashItems") {
    throw new Error("expected listSlashItems");
  }
  return request.requestId;
}

function provideSlashItems(requestId: string, items: SlashMenuItem[]): void {
  host({
    kind: "slashItems",
    requestId,
    items,
    availability: { commands: true, skills: true },
  });
}

describe("App slash flow", () => {
  it("integrates catalog picks, command execution, and transcript projection", async () => {
    const input = renderReady();
    const catalogRequest = await openSlash(input, "/", 1);
    provideSlashItems(catalogRequest, [BARE_COMMAND, INPUT_COMMAND, SKILL]);

    expect(screen.getByText("Commands")).toBeVisible();
    expect(screen.getByText("Skills")).toBeVisible();
    expect(screen.getByRole("option", { name: /\/compact/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /\/brainstorming/ })).toBeVisible();

    fireEvent.mouseDown(screen.getByRole("option", { name: /\/brainstorming/ }));
    expect(input).toHaveValue("/brainstorming ");

    postMessage.mockClear();
    const inputRequest = await openSlash(input, "/go", 3);
    provideSlashItems(inputRequest, [INPUT_COMMAND]);
    fireEvent.mouseDown(screen.getByRole("option", { name: /\/goal/ }));
    expect(input).toHaveValue("/goal ");

    fireEvent.change(input, {
      target: {
        value: "/goal write tests",
        selectionStart: 17,
        selectionEnd: 17,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(commands("executeSlashCommand")).toContainEqual({
      kind: "executeSlashCommand",
      line: "/goal write tests",
    });

    host({
      kind: "event",
      sessionId: "session-1",
      event: {
        type: "command/run",
        seq: 1,
        time: 1,
        data: {
          commandId: "command-1",
          name: "goal",
          args: " write tests",
          source: { kind: "user" },
        },
      },
    });
    expect(screen.queryByLabelText("You")).toBeNull();
    expect(screen.getByRole("button", { name: "Command" })).toHaveTextContent(
      "/goal write tests",
    );
    expect(input).toHaveValue("");

    postMessage.mockClear();
    const bareRequest = await openSlash(input, "/", 1);
    provideSlashItems(bareRequest, [BARE_COMMAND]);
    fireEvent.mouseDown(screen.getByRole("option", { name: /\/compact/ }));
    expect(commands("executeSlashCommand")).toContainEqual({
      kind: "executeSlashCommand",
      line: "/compact",
    });
    expect(commands("submit")).toHaveLength(0);
  });

  it("opens once and filters later slash query edits locally", async () => {
    const input = renderReady();
    const requestId = await openSlash(input, "/", 1);
    provideSlashItems(requestId, [BARE_COMMAND, INPUT_COMMAND]);

    expect(screen.getByRole("option", { name: /\/compact/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /\/goal/ })).toBeVisible();

    fireEvent.change(input, {
      target: { value: "/go", selectionStart: 3, selectionEnd: 3 },
    });

    expect(screen.queryByRole("option", { name: /\/compact/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /\/goal/ })).toBeVisible();
    expect(commands("listSlashItems")).toHaveLength(1);
  });

  it("gives an active attachment token precedence over slash", async () => {
    const input = renderReady();
    fireEvent.change(input, {
      target: { value: "/ @src", selectionStart: 6, selectionEnd: 6 },
    });

    await waitFor(() => expect(commands("listFileReferences")).toHaveLength(1));
    expect(commands("listSlashItems")).toHaveLength(0);
    expect(screen.getByLabelText("Search files and folders")).toBeVisible();
  });

  it("dismisses the slash picker through the shared picker callback", async () => {
    const input = renderReady();
    const requestId = await openSlash(input, "/", 1);
    provideSlashItems(requestId, [BARE_COMMAND]);

    fireEvent.keyDown(input, { key: "Escape" });

    expect(
      screen.queryByRole("option", { name: /\/compact/ }),
    ).not.toBeInTheDocument();
    expect(input).toHaveValue("/");
  });

  it("dismisses a slash picker when the textarea caret leaves its token", async () => {
    const input = renderReady();
    const requestId = await openSlash(input, "/brain", 6);
    provideSlashItems(requestId, [SKILL]);
    const staleOption = screen.getByRole("option", { name: /\/brainstorming/ });

    fireEvent.change(input, {
      target: { value: "/brains", selectionStart: 0, selectionEnd: 0 },
    });

    expect(staleOption).not.toBeInTheDocument();
    fireEvent.mouseDown(staleOption);
    expect(input).toHaveValue("/brains");
    expect(commands("executeSlashCommand")).toHaveLength(0);
  });

  it("leaves attachment picker selection behavior unchanged", async () => {
    const input = renderReady();
    fireEvent.change(input, {
      target: { value: "read @src", selectionStart: 9, selectionEnd: 9 },
    });
    await waitFor(() => expect(commands("listFileReferences")).toHaveLength(1));

    input.setSelectionRange(0, 0);
    fireEvent.select(input);

    expect(commands("listFileReferences")).toHaveLength(1);
    expect(screen.getByLabelText("Search files and folders")).toBeVisible();
    expect(screen.getByLabelText("Search files and folders")).toHaveValue("src");
  });

  it("inserts a skill without posting a command or submit", async () => {
    const input = renderReady();
    const requestId = await openSlash(input, "use /brain now", 10);
    provideSlashItems(requestId, [SKILL]);

    fireEvent.mouseDown(screen.getByRole("option", { name: /\/brainstorming/ }));

    expect(input).toHaveValue("use /brainstorming  now");
    await waitFor(() =>
      expect(input.selectionStart).toBe("use /brainstorming ".length),
    );
    expect(input.selectionEnd).toBe("use /brainstorming ".length);
    expect(commands("executeSlashCommand")).toHaveLength(0);
    expect(commands("submit")).toHaveLength(0);
  });

  it("claims an input command and executes it on Send", async () => {
    const input = renderReady();
    const requestId = await openSlash(input, "/go", 3);
    provideSlashItems(requestId, [INPUT_COMMAND]);
    fireEvent.mouseDown(screen.getByRole("option", { name: /\/goal/ }));

    fireEvent.change(input, {
      target: {
        value: "/goal write tests",
        selectionStart: 17,
        selectionEnd: 17,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(commands("executeSlashCommand")).toContainEqual({
      kind: "executeSlashCommand",
      line: "/goal write tests",
    });
    expect(commands("submit")).toHaveLength(0);
  });

  it("executes a bare command immediately without submitting remaining text", async () => {
    const input = renderReady();
    const requestId = await openSlash(input, "keep /compact rest", 13);
    provideSlashItems(requestId, [BARE_COMMAND]);

    fireEvent.mouseDown(screen.getByRole("option", { name: /\/compact/ }));

    expect(input).toHaveValue("keep  rest");
    expect(commands("executeSlashCommand")).toContainEqual({
      kind: "executeSlashCommand",
      line: "/compact",
    });
    expect(commands("submit")).toHaveLength(0);
  });

  it("uses ordinary submit after an input-command claim is invalidated", async () => {
    const input = renderReady();
    const requestId = await openSlash(input, "/go", 3);
    provideSlashItems(requestId, [INPUT_COMMAND]);
    fireEvent.mouseDown(screen.getByRole("option", { name: /\/goal/ }));

    fireEvent.change(input, {
      target: {
        value: " /goal write tests",
        selectionStart: 18,
        selectionEnd: 18,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(commands("submit")).toContainEqual(expect.objectContaining({
      kind: "submit",
      mode: "queue",
      text: "/goal write tests",
    }));
    expect(commands("executeSlashCommand")).toHaveLength(0);
  });

  it("retains a disallowed image command draft and reports a local error", async () => {
    const input = renderReady();
    const requestId = await openSlash(input, "/rev", 4);
    provideSlashItems(requestId, [TEXT_ONLY_COMMAND]);
    fireEvent.mouseDown(screen.getByRole("option", { name: /\/review/ }));
    host({ kind: "imagesPicked", images: [IMAGE] });

    fireEvent.change(input, {
      target: {
        value: "/review src",
        selectionStart: 11,
        selectionEnd: 11,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(commands("executeSlashCommand")).toHaveLength(0);
    expect(commands("submit")).toHaveLength(0);
    expect(input).toHaveValue("/review src");
    expect(screen.getByText("shot.png")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "/review does not accept images",
    );
  });

  it("unlocks Send after an args-redacted command/run", async () => {
    const feedback: SlashMenuItem = {
      source: "command",
      name: "feedback",
      description: "Send feedback",
      behavior: "command-input",
      hint: "What should we know?",
      acceptsImages: false,
    };
    const input = renderReady();
    const requestId = await openSlash(input, "/feed", 5);
    provideSlashItems(requestId, [feedback]);
    fireEvent.mouseDown(screen.getByRole("option", { name: /\/feedback/ }));
    fireEvent.change(input, {
      target: {
        value: "/feedback the menu is slow",
        selectionStart: 26,
        selectionEnd: 26,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();

    host({
      kind: "event",
      sessionId: "session-1",
      event: {
        type: "command/run",
        seq: 1,
        time: 1,
        data: {
          commandId: "command-feedback",
          name: "feedback",
          source: { kind: "user" },
        },
      },
    });
    host({
      kind: "event",
      sessionId: "session-1",
      event: {
        type: "command/done",
        seq: 2,
        time: 2,
        data: { commandId: "command-feedback", kind: "success" },
      },
    });
    fireEvent.change(input, {
      target: { value: "next prompt", selectionStart: 11, selectionEnd: 11 },
    });
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  it("unlocks a cancelled command without unlocking an ordinary prompt submit", async () => {
    const input = renderReady();
    const requestId = await openSlash(input, "/go", 3);
    provideSlashItems(requestId, [INPUT_COMMAND]);
    fireEvent.mouseDown(screen.getByRole("option", { name: /\/goal/ }));
    fireEvent.change(input, {
      target: {
        value: "/goal write tests",
        selectionStart: 17,
        selectionEnd: 17,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();

    host({ kind: "status", state: "idle" });
    expect(input).toHaveValue("/goal write tests");
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();

    fireEvent.change(input, {
      target: { value: "ordinary prompt", selectionStart: 15, selectionEnd: 15 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(commands("submit")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();

    host({ kind: "status", state: "idle" });
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("arbitrates slash caret moves from the live textarea value", async () => {
    const opened = renderReady();
    const requestId = await openSlash(opened, "/brain", 6);
    provideSlashItems(requestId, [SKILL]);
    expect(screen.getByRole("option", { name: /\/brainstorming/ })).toBeVisible();

    const input = screen.getByPlaceholderText(
      "Message DeepSeek Harness…",
    ) as HTMLTextAreaElement;
    // Earlier picker mousedown tests leave React's select plugin armed.
    fireEvent.mouseUp(input);
    input.focus();
    fireEvent.select(input, {
      target: { value: "plain text", selectionStart: 5, selectionEnd: 5 },
    });

    expect(
      screen.queryByRole("option", { name: /\/brainstorming/ }),
    ).not.toBeInTheDocument();
  });
});

describe("App settings shell", () => {
  it("integrates staged Extension settings and explicit restart gating", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Extension" }));
    const read = commands("getExtensionSettings")[0];
    if (read?.kind !== "getExtensionSettings") {
      throw new Error("expected Extension settings read");
    }
    host({
      kind: "settingsHostResult",
      requestId: read.requestId,
      action: "read",
      result: {
        ok: true,
        settings: { binaryPath: "", handshakeTimeoutMs: 30_000 },
      },
    });
    expect(
      screen.queryByText("Extension settings are not available in this version yet."),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("DeepSeek Harness binary path"), {
      target: { value: "/opt/dsh" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const write = commands("updateExtensionSettings")[0];
    if (write?.kind !== "updateExtensionSettings") {
      throw new Error("expected Extension settings write");
    }
    host({
      kind: "settingsHostResult",
      requestId: write.requestId,
      action: "write",
      result: {
        ok: true,
        settings: { binaryPath: "/opt/dsh", handshakeTimeoutMs: 30_000 },
        restartRequired: true,
      },
    });
    expect(screen.getByText("Restart DeepSeek Harness to apply all changes.")).toBeVisible();

    host({ kind: "status", state: "thinking", detail: "arbitrary detail" });
    expect(screen.getByRole("button", { name: "Restart DeepSeek Harness" })).toBeDisabled();
    host({ kind: "status", state: "idle", detail: "still arbitrary" });
    expect(screen.getByRole("button", { name: "Restart DeepSeek Harness" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Restart DeepSeek Harness" }));
    const restart = commands("restartDsh")[0];
    if (restart?.kind !== "restartDsh") throw new Error("expected restart");
    host({
      kind: "settingsHostResult",
      requestId: restart.requestId,
      action: "restart",
      result: { ok: true },
    });
    expect(commands("getExtensionSettings")).toHaveLength(2);
    expect(
      screen.queryByText("Restart DeepSeek Harness to apply all changes."),
    ).not.toBeInTheDocument();
  });

  it("keeps Extension restart available after disconnect", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Extension" }));
    const read = commands("getExtensionSettings")[0];
    if (read?.kind !== "getExtensionSettings") throw new Error("expected read");
    host({
      kind: "settingsHostResult",
      requestId: read.requestId,
      action: "read",
      result: {
        ok: true,
        settings: { binaryPath: "", handshakeTimeoutMs: 30_000 },
      },
    });
    host({ kind: "hostDisconnected", detail: "child exited" });

    expect(screen.getByRole("button", { name: "Restart DeepSeek Harness" })).toBeEnabled();
    expect(screen.getByLabelText("Extension")).toBeVisible();
  });

  it("confirms every dirty-close path, cancels without loss, and discards the draft", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Extension" }));
    const read = commands("getExtensionSettings")[0];
    if (read?.kind !== "getExtensionSettings") throw new Error("expected read");
    host({
      kind: "settingsHostResult",
      requestId: read.requestId,
      action: "read",
      result: {
        ok: true,
        settings: { binaryPath: "", handshakeTimeoutMs: 30_000 },
      },
    });
    fireEvent.change(screen.getByLabelText("DeepSeek Harness binary path"), {
      target: { value: "/draft/dsh" },
    });

    const expectConfirmation = (): HTMLElement => {
      const confirmation = screen.getByRole("alertdialog", {
        name: "Discard unsaved settings?",
      });
      expect(within(confirmation).getByRole("button", {
        name: "Cancel",
      })).toHaveFocus();
      return confirmation;
    };
    const cancel = (): void => {
      fireEvent.click(within(expectConfirmation()).getByRole("button", {
        name: "Cancel",
      }));
      expect(screen.getByLabelText("DeepSeek Harness binary path")).toHaveValue("/draft/dsh");
      expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    };

    fireEvent.keyDown(document, { key: "Escape" });
    cancel();
    fireEvent.pointerDown(screen.getByTestId("settings-mask"));
    cancel();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    cancel();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    const confirmation = expectConfirmation();
    fireEvent.click(within(confirmation).getByRole("button", {
      name: "Discard",
    }));

    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Extension" }));
    expect(screen.getByLabelText("DeepSeek Harness binary path")).toHaveValue("");
  });

  it("discards staged drafts across every persistent settings controller", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    const modelsRead = commands("getSettingsSection").find((command) =>
      command.kind === "getSettingsSection" && command.section === "models");
    if (modelsRead?.kind !== "getSettingsSection") throw new Error("expected Models");
    host({ kind: "settingsSection", requestId: modelsRead.requestId, view: MODELS });
    fireEvent.click(screen.getByRole("button", { name: "Edit DeepSeek" }));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://draft.example/v1" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    const pluginsRead = commands("getSettingsSection").find((command) =>
      command.kind === "getSettingsSection" && command.section === "plugins");
    if (pluginsRead?.kind !== "getSettingsSection") throw new Error("expected Plugins");
    host({
      kind: "settingsSection",
      requestId: pluginsRead.requestId,
      view: MULTI_PLUGINS,
    });
    fireEvent.change(screen.getByLabelText("Timeout (ms)"), {
      target: { value: "20000" },
    });
    fireEvent.change(screen.getByLabelText("Maximum parallel tool calls"), {
      target: { value: "8" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Agent Presets" }));
    const presetsRead = commands("getSettingsSection").find((command) =>
      command.kind === "getSettingsSection" && command.section === "agent-presets");
    if (presetsRead?.kind !== "getSettingsSection") throw new Error("expected Presets");
    host({
      kind: "settingsSection",
      requestId: presetsRead.requestId,
      view: AGENT_PRESETS,
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy Standard Mode" }));
    fireEvent.change(screen.getByLabelText("Identifier"), {
      target: { value: "draft-copy" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Extension" }));
    const extensionRead = commands("getExtensionSettings")[0];
    if (extensionRead?.kind !== "getExtensionSettings") {
      throw new Error("expected Extension");
    }
    host({
      kind: "settingsHostResult",
      requestId: extensionRead.requestId,
      action: "read",
      result: {
        ok: true,
        settings: { binaryPath: "", handshakeTimeoutMs: 30_000 },
      },
    });
    fireEvent.change(screen.getByLabelText("DeepSeek Harness binary path"), {
      target: { value: "/draft/dsh" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    const confirmation = screen.getByRole("alertdialog", {
      name: "Discard unsaved settings?",
    });
    expect(setState.mock.calls.every((call) => {
      const payload = call[0];
      return (
        payload !== null &&
        typeof payload === "object" &&
        Object.keys(payload as object).length === 1 &&
        (payload as { locale?: unknown }).locale === "en"
      );
    })).toBe(true);
    fireEvent.click(within(confirmation).getByRole("button", { name: "Discard" }));

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Extension" }));
    expect(screen.getByLabelText("DeepSeek Harness binary path")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    expect(screen.getByLabelText("Base URL")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    expect(screen.getByLabelText("Timeout (ms)")).toHaveValue(10_000);
    expect(screen.getByLabelText("Maximum parallel tool calls")).toHaveValue(4);
    fireEvent.click(screen.getByRole("button", { name: "Agent Presets" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Standard Mode" }));
    expect(screen.getByLabelText("Identifier")).toHaveValue("");
  });

  it("preserves restartRequired through unrelated dirty Discard and clears it only after restart", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    const pluginsRead = commands("getSettingsSection").find((command) =>
      command.kind === "getSettingsSection" && command.section === "plugins");
    if (pluginsRead?.kind !== "getSettingsSection") {
      throw new Error("expected Plugins read");
    }
    host({
      kind: "settingsSection",
      requestId: pluginsRead.requestId,
      view: PLUGINS,
    });
    fireEvent.change(screen.getByLabelText("Timeout (ms)"), {
      target: { value: "20000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const pluginsWrite = commands("mutateSettings").at(-1);
    if (pluginsWrite?.kind !== "mutateSettings") {
      throw new Error("expected Plugins write");
    }
    host({
      kind: "settingsMutation",
      requestId: pluginsWrite.requestId,
      result: {
        ok: true,
        restartRequired: true,
        namespace: {
          ...PLUGINS.namespaces[0],
          revision: 5,
          user: { timeoutMs: 20_000 },
          value: { timeoutMs: 20_000, maxOutputBytes: 1_000_000 },
        },
      },
    });
    expect(screen.getByText("Restart DeepSeek Harness to apply all changes.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    const modelsRead = commands("getSettingsSection").find((command) =>
      command.kind === "getSettingsSection" && command.section === "models");
    if (modelsRead?.kind !== "getSettingsSection") {
      throw new Error("expected Models read");
    }
    host({ kind: "settingsSection", requestId: modelsRead.requestId, view: MODELS });
    fireEvent.click(screen.getByRole("button", { name: "Edit DeepSeek" }));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://draft.example/v1" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    const confirmation = screen.getByRole("alertdialog", {
      name: "Discard unsaved settings?",
    });
    fireEvent.click(within(confirmation).getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText("Restart DeepSeek Harness to apply all changes.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    expect(screen.getByLabelText("Base URL")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Extension" }));
    const extensionRead = commands("getExtensionSettings").at(-1);
    if (extensionRead?.kind !== "getExtensionSettings") {
      throw new Error("expected Extension read");
    }
    host({
      kind: "settingsHostResult",
      requestId: extensionRead.requestId,
      action: "read",
      result: {
        ok: true,
        settings: { binaryPath: "", handshakeTimeoutMs: 30_000 },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Restart DeepSeek Harness" }));
    const restart = commands("restartDsh")[0];
    if (restart?.kind !== "restartDsh") throw new Error("expected restart");
    host({
      kind: "settingsHostResult",
      requestId: restart.requestId,
      action: "restart",
      result: { ok: true },
    });
    expect(
      screen.queryByText("Restart DeepSeek Harness to apply all changes."),
    ).not.toBeInTheDocument();
  });

  it("bootstraps persisted Busy Enter before Settings opens", () => {
    const input = renderReady();
    const bootstrap = commands("getSettingsSection")[0];
    if (bootstrap?.kind !== "getSettingsSection") {
      throw new Error("expected General bootstrap");
    }
    host({
      kind: "settingsSection",
      requestId: bootstrap.requestId,
      view: FULL_GENERAL,
    });
    fireEvent.change(input, {
      target: { value: "steer while busy", selectionStart: 16, selectionEnd: 16 },
    });
    host({ kind: "status", state: "thinking" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(commands("submit")).toContainEqual(expect.objectContaining({
      kind: "submit",
      mode: "steer",
      text: "steer while busy",
    }));
  });

  it("does not duplicate an in-flight General bootstrap when Settings opens", () => {
    renderReady();
    expect(commands("getSettingsSection")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(commands("getSettingsSection")).toHaveLength(1);
  });

  it("refreshes persisted Busy Enter on reconnect while Settings stays closed", () => {
    const input = renderReady();
    const first = commands("getSettingsSection")[0];
    if (first?.kind !== "getSettingsSection") {
      throw new Error("expected first General bootstrap");
    }
    host({ kind: "settingsSection", requestId: first.requestId, view: FULL_GENERAL });
    host({ kind: "hostDisconnected", detail: "restart" });
    host({
      kind: "ready",
      sessionId: "session-2",
      cwd: "/workspace",
      models: {
        current: { provider: "deepseek", model: "chat" },
        models: [{ provider: "deepseek", model: "chat", label: "Chat" }],
      },
      permissions: {
        current: "workspace-write",
        presets: [{ id: "workspace-write", label: "Workspace Write" }],
      },
      context: { used: 0, window: 128_000 },
    });
    const refresh = commands("getSettingsSection")[1];
    if (refresh?.kind !== "getSettingsSection") {
      throw new Error("expected reconnect General refresh");
    }
    host({
      kind: "settingsSection",
      requestId: refresh.requestId,
      view: {
        ...FULL_GENERAL,
        namespaces: FULL_GENERAL.namespaces.map((namespace) =>
          namespace.namespace === "ui-conversation"
            ? {
                ...namespace,
                revision: 6,
                user: { busyEnter: "queue" },
                value: { busyEnter: "queue" },
              }
            : namespace.namespace === "locale"
              ? {
                  ...namespace,
                  revision: 4,
                  user: { preference: "zh" },
                  value: { preference: "zh" },
                }
            : namespace,
        ),
      },
    });
    expect(screen.getByLabelText("消息")).toBe(input);
    const readsBeforeOpen = commands("getSettingsSection").length;
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "设置" })).toBeVisible();
    expect(commands("getSettingsSection")).toHaveLength(readsBeforeOpen);
    fireEvent.change(input, {
      target: { value: "queue while busy", selectionStart: 16, selectionEnd: 16 },
    });
    host({ kind: "status", state: "thinking" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(commands("submit")).toContainEqual(expect.objectContaining({
      kind: "submit",
      mode: "queue",
      text: "queue while busy",
    }));
  });

  it("defers closed invalidation until the next Settings open", () => {
    renderReady();
    const bootstrap = commands("getSettingsSection")[0];
    if (bootstrap?.kind !== "getSettingsSection") {
      throw new Error("expected General bootstrap");
    }
    host({ kind: "settingsSection", requestId: bootstrap.requestId, view: GENERAL });
    postMessage.mockClear();
    host({
      kind: "settingsInvalidated",
      sections: ["general"],
      reason: "document",
    });
    expect(commands("getSettingsSection")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(commands("getSettingsSection")).toHaveLength(1);
  });

  it("preserves General conflict Retry and Discard across modal unmounts", async () => {
    renderReady();
    const bootstrap = commands("getSettingsSection")[0];
    if (bootstrap?.kind !== "getSettingsSection") {
      throw new Error("expected General bootstrap");
    }
    host({ kind: "settingsSection", requestId: bootstrap.requestId, view: FULL_GENERAL });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("Appearance"), {
      target: { value: "dark" },
    });
    const first = commands("mutateSettings")[0];
    if (first?.kind !== "mutateSettings") throw new Error("expected mutation");
    host({
      kind: "settingsMutation",
      requestId: first.requestId,
      result: {
        ok: false,
        error: {
          code: "settings-conflict",
          message: "changed elsewhere",
          namespace: "ui-theme",
          currentRevision: 5,
        },
      },
    });
    const refresh = commands("getSettingsSection").at(-1);
    if (refresh?.kind !== "getSettingsSection") throw new Error("expected refresh");
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    host({
      kind: "settingsSection",
      requestId: refresh.requestId,
      view: {
        ...FULL_GENERAL,
        namespaces: FULL_GENERAL.namespaces.map((namespace) =>
          namespace.namespace === "ui-theme"
            ? { ...namespace, revision: 5, value: { preference: "light" } }
            : namespace,
        ),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(commands("mutateSettings")[1]).toMatchObject({
      namespace: "ui-theme",
      expectedRevision: 5,
      ops: [{ op: "set", path: ["preference"], value: "dark" }],
    });

    const second = commands("mutateSettings")[1];
    if (second?.kind !== "mutateSettings") throw new Error("expected retry");
    host({
      kind: "settingsMutation",
      requestId: second.requestId,
      result: {
        ok: false,
        error: {
          code: "settings-conflict",
          message: "changed again",
          namespace: "ui-theme",
          currentRevision: 6,
        },
      },
    });
    const secondRefresh = commands("getSettingsSection").at(-1);
    if (secondRefresh?.kind !== "getSettingsSection") {
      throw new Error("expected second refresh");
    }
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    host({
      kind: "settingsSection",
      requestId: secondRefresh.requestId,
      view: {
        ...FULL_GENERAL,
        namespaces: FULL_GENERAL.namespaces.map((namespace) =>
          namespace.namespace === "ui-theme"
            ? { ...namespace, revision: 6, value: { preference: "light" } }
            : namespace,
        ),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByLabelText("Appearance")).toHaveValue("light");
    expect(commands("mutateSettings")).toHaveLength(2);
  });

  it("settles settings confirmation on disconnect and ignores a late result", async () => {
    renderReady();
    const bootstrap = commands("getSettingsSection")[0];
    if (bootstrap?.kind !== "getSettingsSection") throw new Error("expected bootstrap");
    host({ kind: "settingsSection", requestId: bootstrap.requestId, view: FULL_GENERAL });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("Default permission"), {
      target: { value: "danger-full-access" },
    });
    const confirmation = commands("confirmSettingsFullAccess")[0];
    if (confirmation?.kind !== "confirmSettingsFullAccess") {
      throw new Error("expected confirmation");
    }
    host({ kind: "hostDisconnected", detail: "restart" });
    host({
      kind: "settingsFullAccessConfirmation",
      requestId: confirmation.requestId,
      confirmed: true,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(commands("mutateSettings")).toHaveLength(0);
  });

  it("settles settings confirmation on teardown and ignores a late result", async () => {
    const mounted = render(<App />);
    host({
      kind: "ready",
      sessionId: "session-1",
      cwd: "/workspace",
      models: {
        current: { provider: "deepseek", model: "chat" },
        models: [{ provider: "deepseek", model: "chat", label: "Chat" }],
      },
      permissions: {
        current: "workspace-write",
        presets: [{ id: "workspace-write", label: "Workspace Write" }],
      },
    });
    const bootstrap = commands("getSettingsSection")[0];
    if (bootstrap?.kind !== "getSettingsSection") throw new Error("expected bootstrap");
    host({ kind: "settingsSection", requestId: bootstrap.requestId, view: FULL_GENERAL });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("Default permission"), {
      target: { value: "danger-full-access" },
    });
    const confirmation = commands("confirmSettingsFullAccess")[0];
    if (confirmation?.kind !== "confirmSettingsFullAccess") {
      throw new Error("expected confirmation");
    }
    mounted.unmount();
    host({
      kind: "settingsFullAccessConfirmation",
      requestId: confirmation.requestId,
      confirmed: true,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(commands("mutateSettings")).toHaveLength(0);
  });

  it("mutates the dangerous default only after host confirmation", async () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const request = commands("getSettingsSection")[0];
    if (request?.kind !== "getSettingsSection") {
      throw new Error("expected General request");
    }
    host({ kind: "settingsSection", requestId: request.requestId, view: FULL_GENERAL });
    fireEvent.change(screen.getByLabelText("Default permission"), {
      target: { value: "danger-full-access" },
    });
    const cancelled = commands("confirmSettingsFullAccess")[0];
    if (cancelled?.kind !== "confirmSettingsFullAccess") {
      throw new Error("expected settings confirmation");
    }
    host({
      kind: "settingsFullAccessConfirmation",
      requestId: cancelled.requestId,
      confirmed: false,
    });
    expect(commands("mutateSettings")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Default permission"), {
      target: { value: "danger-full-access" },
    });
    const accepted = commands("confirmSettingsFullAccess")[1];
    if (accepted?.kind !== "confirmSettingsFullAccess") {
      throw new Error("expected second settings confirmation");
    }
    host({
      kind: "settingsFullAccessConfirmation",
      requestId: accepted.requestId,
      confirmed: true,
    });
    await waitFor(() => expect(commands("mutateSettings")).toHaveLength(1));
    expect(commands("mutateSettings")[0]).toMatchObject({
      namespace: "permission",
      expectedRevision: 2,
      ops: [{
        op: "set",
        path: ["defaultPreset"],
        value: "danger-full-access",
      }],
    });
    expect(screen.getByLabelText("Permission")).toHaveValue("workspace-write");
  });

  it("applies General mutations without changing current-session selectors", async () => {
    const input = renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const request = commands("getSettingsSection")[0];
    if (request?.kind !== "getSettingsSection") {
      throw new Error("expected General request");
    }
    host({
      kind: "settingsSection",
      requestId: request.requestId,
      view: FULL_GENERAL,
    });

    expect(screen.getByLabelText("Permission")).toHaveValue("workspace-write");
    fireEvent.change(screen.getByLabelText("Language"), {
      target: { value: "zh" },
    });
    const mutation = commands("mutateSettings")[0];
    if (mutation?.kind !== "mutateSettings") {
      throw new Error("expected locale mutation");
    }
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    host({
      kind: "settingsMutation",
      requestId: mutation.requestId,
      result: {
        ok: true,
        namespace: {
          ...FULL_GENERAL.namespaces[2]!,
          revision: 4,
          user: { preference: "zh" },
          value: { preference: "zh" },
        },
      },
    });
    expect(await screen.findByRole("dialog", { name: "设置" })).toBeVisible();
    expect(screen.getByLabelText("Permission")).toHaveValue("workspace-write");

    fireEvent.change(input, {
      target: { value: "steer now", selectionStart: 9, selectionEnd: 9 },
    });
    host({ kind: "status", state: "thinking" });
    fireEvent.keyDown(input, { key: "Enter" });
    const submit = commands("submit")[0];
    expect(submit).toMatchObject({ kind: "submit", mode: "steer", text: "steer now" });
  });

  it("closes during a General in-flight write without dirty confirmation and reconciles the persistent controller", async () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const request = commands("getSettingsSection")[0];
    if (request?.kind !== "getSettingsSection") {
      throw new Error("expected General request");
    }
    host({
      kind: "settingsSection",
      requestId: request.requestId,
      view: FULL_GENERAL,
    });

    fireEvent.change(screen.getByLabelText("Language"), {
      target: { value: "zh" },
    });
    const mutation = commands("mutateSettings")[0];
    if (mutation?.kind !== "mutateSettings") {
      throw new Error("expected locale mutation");
    }
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("alertdialog", { name: "Discard unsaved settings?" }),
    ).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();

    host({
      kind: "settingsMutation",
      requestId: mutation.requestId,
      result: {
        ok: true,
        namespace: {
          ...FULL_GENERAL.namespaces[2]!,
          revision: 4,
          user: { preference: "zh" },
          value: { preference: "zh" },
        },
      },
    });
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("dialog", { name: "设置" })).toBeVisible();
    expect(screen.getByLabelText("语言")).toHaveValue("zh");
    expect(commands("mutateSettings")).toHaveLength(1);
  });

  it("toggles a clean modal without duplicating General", () => {
    renderReady();
    postMessage.mockClear();
    const gear = screen.getByRole("button", { name: "Settings" });

    fireEvent.click(gear);
    fireEvent.click(gear);

    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    fireEvent.click(gear);
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(commands("getSettingsSection")).toHaveLength(0);
  });

  it("opens General, dismisses transient UI, and preserves conversation composition", async () => {
    const input = renderReady();
    const bootstrap = commands("getSettingsSection")[0];
    if (bootstrap?.kind !== "getSettingsSection") {
      throw new Error("expected General bootstrap");
    }
    host({
      kind: "settingsSection",
      requestId: bootstrap.requestId,
      view: GENERAL,
    });
    const slashRequest = await openSlash(input, "/go", 3);
    provideSlashItems(slashRequest, [INPUT_COMMAND]);
    fireEvent.mouseDown(screen.getByRole("option", { name: /\/goal/ }));
    fireEvent.change(input, {
      target: {
        value: "/goal keep this",
        selectionStart: 15,
        selectionEnd: 15,
      },
    });
    host({ kind: "imagesPicked", images: [IMAGE] });
    host({
      kind: "event",
      sessionId: "session-1",
      event: {
        type: "assistant/message",
        seq: 1,
        time: 1,
        data: { message: { content: [{ type: "text", text: "Existing answer" }] } },
      },
    });
    postMessage.mockClear();
    const pickerRequest = await openSlash(input, "/goal keep this /", 17);
    provideSlashItems(pickerRequest, [BARE_COMMAND]);
    expect(screen.getByRole("option", { name: /\/compact/ })).toBeVisible();

    postMessage.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(commands("getSettingsSection")).toHaveLength(0);
    expect(screen.queryByRole("option", { name: /\/compact/ })).not.toBeInTheDocument();
    expect(input).toHaveValue("/goal keep this /");
    expect(screen.getByText("shot.png")).toBeInTheDocument();
    expect(screen.getByText("Existing answer")).toBeInTheDocument();
    expect(screen.getByText("<objective>")).toBeInTheDocument();
  });

  it("keeps conversation streaming and controls independent while Settings is open", () => {
    const input = renderReady();
    fireEvent.change(input, {
      target: { value: "composer stays", selectionStart: 14, selectionEnd: 14 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    const modelsRead = commands("getSettingsSection").find((command) =>
      command.kind === "getSettingsSection" && command.section === "models");
    if (modelsRead?.kind !== "getSettingsSection") throw new Error("expected Models");
    host({ kind: "settingsSection", requestId: modelsRead.requestId, view: MODELS });
    fireEvent.click(screen.getByRole("button", { name: "Edit DeepSeek" }));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://draft.example/v1" },
    });

    host({
      kind: "event",
      sessionId: "session-1",
      event: {
        type: "assistant/chunk",
        seq: 1,
        time: 1,
        data: { chunk: { type: "text-delta", text: "Streaming answer" } },
      },
    });
    host({
      kind: "catalog",
      current: { provider: "deepseek", model: "chat" },
      models: [
        { provider: "deepseek", model: "chat", label: "Chat" },
        { provider: "deepseek", model: "reasoner", label: "Reasoner" },
      ],
    });
    host({
      kind: "permissions",
      current: "workspace-write",
      presets: [
        { id: "workspace-write", label: "Workspace Write" },
        { id: "read-only", label: "Read Only" },
      ],
    });
    expect(screen.getByText("Streaming answer")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "deepseek\u0000reasoner" },
    });
    fireEvent.change(screen.getByLabelText("Permission"), {
      target: { value: "read-only" },
    });
    expect(commands("selectModel").at(-1)).toMatchObject({
      provider: "deepseek",
      model: "reasoner",
    });
    expect(commands("selectPermission").at(-1)).toMatchObject({
      preset: "read-only",
    });

    host({ kind: "status", state: "thinking" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(commands("submit").at(-1)).toMatchObject({
      mode: "queue",
      text: "composer stays",
    });
    fireEvent.click(screen.getByRole("button", { name: "Extension" }));
    expect(screen.getByRole("button", { name: "Restart DeepSeek Harness" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(commands("confirmNewChat")).toHaveLength(1);
    expect(commands("newSession")).toHaveLength(0);

    host({
      kind: "ask",
      askId: "approval-1",
      questions: [{
        id: "proceed",
        question: "Proceed?",
        options: [{ label: "Yes" }],
      }],
    });
    expect(screen.getByRole("button", { name: "Restart DeepSeek Harness" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    expect(input).toHaveValue("composer stays");
    expect(screen.getByLabelText("Model")).toHaveValue("deepseek\u0000chat");
    expect(screen.getByLabelText("Permission")).toHaveValue("workspace-write");
    expect(screen.getByText("Streaming answer")).toBeVisible();
  });

  it("loads bridge sections lazily once and refreshes an active invalidated section", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    postMessage.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    const firstModels = commands("getSettingsSection")[0];
    expect(firstModels).toMatchObject({
      kind: "getSettingsSection",
      section: "models",
    });
    if (firstModels?.kind !== "getSettingsSection") {
      throw new Error("expected Models request");
    }
    host({
      kind: "settingsSection",
      requestId: firstModels.requestId,
      view: { section: "models", namespaces: [], providers: [], credentials: [] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    expect(
      commands("getSettingsSection").filter(
        (command) =>
          command.kind === "getSettingsSection" && command.section === "models",
      ),
    ).toHaveLength(1);

    host({
      kind: "settingsInvalidated",
      sections: ["models"],
      reason: "models",
    });
    expect(
      commands("getSettingsSection").filter(
        (command) =>
          command.kind === "getSettingsSection" && command.section === "models",
      ),
    ).toHaveLength(2);
  });

  it("keeps model credentials out of retained state and replaces retired catalog entries", async () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    const request = commands("getSettingsSection").find(
      (command) =>
        command.kind === "getSettingsSection" && command.section === "models",
    );
    if (request?.kind !== "getSettingsSection") {
      throw new Error("expected Models request");
    }
    host({
      kind: "settingsSection",
      requestId: request.requestId,
      view: MODELS,
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit DeepSeek" }));
    const secret = screen.getByLabelText<HTMLInputElement>("API key");
    fireEvent.change(secret, { target: { value: "super-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(commands("setCredential")).toHaveLength(1));
    expect(commands("setCredential")[0]).toMatchObject({
      ref: "DEEPSEEK_API_KEY",
      value: "super-secret",
    });
    expect(secret).toHaveValue("");
    expect(setState).not.toHaveBeenCalledWith(
      expect.stringContaining("super-secret"),
    );

    host({
      kind: "catalog",
      current: { provider: "deepseek", model: "new" },
      models: [{ provider: "deepseek", model: "new", label: "New" }],
    });
    const selector = screen.getByLabelText<HTMLSelectElement>("Model");
    expect([...selector.options].map((option) => option.textContent)).toEqual([
      "New · deepseek",
    ]);
    expect(selector.textContent).not.toContain("Chat");
  });

  it("keeps a custom provider draft open on dirty close", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    const request = commands("getSettingsSection").find(
      (command) =>
        command.kind === "getSettingsSection" && command.section === "models",
    );
    if (request?.kind !== "getSettingsSection") {
      throw new Error("expected Models request");
    }
    host({ kind: "settingsSection", requestId: request.requestId, view: CUSTOM_MODELS });
    fireEvent.click(screen.getByRole("button", { name: "Add a custom provider" }));
    fireEvent.change(screen.getByLabelText("Provider ID"), {
      target: { value: "acme-gateway" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.getByLabelText("Provider ID")).toHaveValue("acme-gateway");
  });

  it("preserves a Models draft through conflict and retries the refreshed revision", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    const request = commands("getSettingsSection").find(
      (command) =>
        command.kind === "getSettingsSection" && command.section === "models",
    );
    if (request?.kind !== "getSettingsSection") {
      throw new Error("expected Models request");
    }
    host({ kind: "settingsSection", requestId: request.requestId, view: MODELS });
    fireEvent.click(screen.getByRole("button", { name: "Edit DeepSeek" }));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://draft.example/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const first = commands("mutateSettings")[0];
    if (first?.kind !== "mutateSettings") throw new Error("expected mutation");
    host({
      kind: "settingsMutation",
      requestId: first.requestId,
      result: {
        ok: false,
        error: {
          code: "settings-conflict",
          message: "Changed elsewhere",
          namespace: "llm-deepseek",
          currentRevision: 2,
        },
      },
    });
    const refresh = commands("getSettingsSection").at(-1);
    if (refresh?.kind !== "getSettingsSection") throw new Error("expected refresh");
    host({
      kind: "settingsSection",
      requestId: refresh.requestId,
      view: {
        ...MODELS,
        namespaces: MODELS.namespaces.map((namespace) => ({
          ...namespace,
          revision: 2,
          value: { ...namespace.value, baseURL: "https://remote.example/v1" },
        })),
      },
    });

    expect(screen.getByLabelText("Base URL")).toHaveValue(
      "https://draft.example/v1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(commands("mutateSettings")[1]).toMatchObject({
      expectedRevision: 2,
      ops: [{
        op: "set",
        path: ["baseURL"],
        value: "https://draft.example/v1",
      }],
    });
  });

  it("keeps Models open and identifies a partial credential failure", async () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    const request = commands("getSettingsSection").find(
      (command) =>
        command.kind === "getSettingsSection" && command.section === "models",
    );
    if (request?.kind !== "getSettingsSection") {
      throw new Error("expected Models request");
    }
    host({ kind: "settingsSection", requestId: request.requestId, view: MODELS });
    fireEvent.click(screen.getByRole("button", { name: "Edit DeepSeek" }));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://draft.example/v1" },
    });
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "super-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const settings = commands("mutateSettings")[0];
    if (settings?.kind !== "mutateSettings") throw new Error("expected mutation");
    host({
      kind: "settingsMutation",
      requestId: settings.requestId,
      result: {
        ok: true,
        namespace: {
          ...MODELS.namespaces[0],
          revision: 2,
          user: { baseURL: "https://draft.example/v1" },
          value: {
            ...MODELS.namespaces[0].value,
            baseURL: "https://draft.example/v1",
          },
        },
      },
    });
    await waitFor(() => expect(commands("setCredential")).toHaveLength(1));
    const credential = commands("setCredential")[0];
    if (credential?.kind !== "setCredential") {
      throw new Error("expected credential");
    }
    host({
      kind: "settingsMutation",
      requestId: credential.requestId,
      result: {
        ok: false,
        error: {
          code: "credentials-rejected",
          message: "Key rejected",
        },
      },
    });

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Credential: Key rejected",
    );
  });

  it("clears a Models secret bridge on disconnect and ignores late settings success", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    const request = commands("getSettingsSection").find(
      (command) =>
        command.kind === "getSettingsSection" && command.section === "models",
    );
    if (request?.kind !== "getSettingsSection") {
      throw new Error("expected Models request");
    }
    host({ kind: "settingsSection", requestId: request.requestId, view: MODELS });
    fireEvent.click(screen.getByRole("button", { name: "Edit DeepSeek" }));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://draft.example/v1" },
    });
    const secret = screen.getByLabelText<HTMLInputElement>("API key");
    fireEvent.change(secret, { target: { value: "super-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const settings = commands("mutateSettings")[0];
    if (settings?.kind !== "mutateSettings") throw new Error("expected mutation");

    host({ kind: "hostDisconnected", detail: "Bridge stopped" });
    host({
      kind: "settingsMutation",
      requestId: settings.requestId,
      result: {
        ok: true,
        namespace: {
          ...MODELS.namespaces[0],
          revision: 2,
        },
      },
    });

    expect(secret).toHaveValue("");
    expect(commands("setCredential")).toHaveLength(0);
    expect(screen.getByLabelText("Base URL")).toHaveValue(
      "https://draft.example/v1",
    );
  });

  it("renders Plugins and includes every dirty card in close protection", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    const request = commands("getSettingsSection").find(
      (command) =>
        command.kind === "getSettingsSection" && command.section === "plugins",
    );
    if (request?.kind !== "getSettingsSection") {
      throw new Error("expected Plugins request");
    }
    host({ kind: "settingsSection", requestId: request.requestId, view: PLUGINS });

    expect(screen.getByRole("tablist", { name: "Plugins" })).toBeVisible();
    expect(screen.queryByText("Plugin settings are not available in this version yet."))
      .not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Timeout (ms)"), {
      target: { value: "20000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.getByLabelText("Timeout (ms)")).toHaveValue(20_000);
  });

  it("routes Web Search reads, mutations, invalidation, and dirty close", () => {
    renderReady();
    host({
      kind: "settingsCapabilities",
      sections: ["web-search"],
    });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Web Search" }));
    const read = commands("getSettingsSection").find((command) =>
      command.kind === "getSettingsSection" && command.section === "web-search");
    if (read?.kind !== "getSettingsSection") {
      throw new Error("expected Web Search read");
    }
    host({ kind: "settingsSection", requestId: read.requestId, view: WEB_SEARCH });
    expect(screen.getByRole("radiogroup", { name: "Search engine" })).toBeVisible();

    fireEvent.click(screen.getByRole("radio", { name: "SearXNG" }));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://search.example" },
    });
    fireEvent.change(screen.getByLabelText("Tavily API key"), {
      target: { value: "app-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://search.example");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const mutation = commands("setWebSearchConfig")[0];
    if (mutation?.kind !== "setWebSearchConfig") {
      throw new Error("expected Web Search mutation");
    }
    expect(mutation).toMatchObject({
      catalog: {
        engine: "searxng",
        engines: expect.arrayContaining([
          { engine: "searxng", baseURL: "https://search.example" },
        ]),
      },
      secrets: [{ ref: "TAVILY_API_KEY", value: "app-secret" }],
    });
    expect(JSON.stringify(setState.mock.calls)).not.toContain("app-secret");
    host({
      kind: "webSearchMutation",
      requestId: mutation.requestId,
      result: {
        ok: true,
        view: {
          ...WEB_SEARCH,
          engine: "searxng",
          engines: WEB_SEARCH.engines.map((engine) =>
            engine.engine === "searxng"
              ? { ...engine, baseURL: "https://search.example" }
              : engine),
          available: true,
        },
        secretFailures: [],
      },
    });
    expect(screen.getByLabelText("Tavily API key")).toHaveValue("");

    postMessage.mockClear();
    host({
      kind: "settingsInvalidated",
      sections: ["web-search"],
      reason: "web-search",
    });
    expect(commands("getSettingsSection")).toContainEqual(expect.objectContaining({
      kind: "getSettingsSection",
      section: "web-search",
    }));
    const invalidatedRead = commands("getSettingsSection")[0];
    if (invalidatedRead?.kind !== "getSettingsSection") {
      throw new Error("expected invalidated Web Search read");
    }
    host({
      kind: "settingsSection",
      requestId: invalidatedRead.requestId,
      view: WEB_SEARCH,
    });
    host({ kind: "settingsCapabilities", sections: [] });
    expect(screen.queryByRole("button", { name: "Web Search" })).toBeNull();
    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps a partial Web Search secret failure in dirty-close protection", () => {
    renderReady();
    host({ kind: "settingsCapabilities", sections: ["web-search"] });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Web Search" }));
    const read = commands("getSettingsSection").find((command) =>
      command.kind === "getSettingsSection" && command.section === "web-search");
    if (read?.kind !== "getSettingsSection") {
      throw new Error("expected Web Search read");
    }
    host({ kind: "settingsSection", requestId: read.requestId, view: WEB_SEARCH });
    const secret = screen.getByLabelText("Brave API key");
    fireEvent.change(secret, { target: { value: "retry-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const mutation = commands("setWebSearchConfig")[0];
    if (mutation?.kind !== "setWebSearchConfig") {
      throw new Error("expected Web Search mutation");
    }
    host({
      kind: "webSearchMutation",
      requestId: mutation.requestId,
      result: {
        ok: true,
        view: WEB_SEARCH,
        secretFailures: [{
          ref: "BRAVE_API_KEY",
          message: "BRAVE_API_KEY could not be stored",
        }],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));

    expect(screen.getByRole("alertdialog", {
      name: "Discard unsaved settings?",
    })).toBeVisible();
    expect(secret).toHaveValue("retry-secret");
    expect(JSON.stringify(setState.mock.calls)).not.toContain("retry-secret");
  });

  it("clears staged Web Search intent when switching sections", () => {
    renderReady();
    host({ kind: "settingsCapabilities", sections: ["web-search"] });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Web Search" }));
    const read = commands("getSettingsSection").find((command) =>
      command.kind === "getSettingsSection" && command.section === "web-search");
    if (read?.kind !== "getSettingsSection") {
      throw new Error("expected Web Search read");
    }
    host({ kind: "settingsSection", requestId: read.requestId, view: WEB_SEARCH });
    fireEvent.change(screen.getByLabelText("Tavily API key"), {
      target: { value: "switch-secret" },
    });

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));

    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("alertdialog", {
      name: "Discard unsaved settings?",
    })).toBeNull();
  });

  it("routes Plugins mutations to the persistent controller and marks restart required", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    const request = commands("getSettingsSection").find(
      (command) =>
        command.kind === "getSettingsSection" && command.section === "plugins",
    );
    if (request?.kind !== "getSettingsSection") {
      throw new Error("expected Plugins request");
    }
    host({ kind: "settingsSection", requestId: request.requestId, view: PLUGINS });
    fireEvent.change(screen.getByLabelText("Timeout (ms)"), {
      target: { value: "20000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const mutation = commands("mutateSettings").at(-1);
    if (mutation?.kind !== "mutateSettings") {
      throw new Error("expected Plugins mutation");
    }
    expect(mutation).toMatchObject({
      namespace: "shell",
      expectedRevision: 4,
    });
    host({
      kind: "settingsMutation",
      requestId: mutation.requestId,
      result: {
        ok: true,
        restartRequired: true,
        namespace: {
          ...PLUGINS.namespaces[0],
          revision: 5,
          user: { timeoutMs: 20_000 },
          value: { timeoutMs: 20_000, maxOutputBytes: 1_000_000 },
        },
      },
    });

    expect(screen.getByText("Restart DeepSeek Harness to apply all changes.")).toBeVisible();
    expect(screen.getByLabelText("Timeout (ms)")).toHaveValue(20_000);
  });

  it("posts Web Search credential set and unset while plugin settings are read-only", async () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    const request = commands("getSettingsSection").find(
      (command) =>
        command.kind === "getSettingsSection" && command.section === "plugins",
    );
    if (request?.kind !== "getSettingsSection") {
      throw new Error("expected Plugins request");
    }
    host({
      kind: "settingsSection",
      requestId: request.requestId,
      view: READ_ONLY_WEB_PLUGINS,
    });

    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "credential-only-secret" },
    });
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(commands("setCredential")).toHaveLength(1));
    const set = commands("setCredential")[0];
    expect(set).toMatchObject({
      ref: "DEEPSEEK_API_KEY",
      value: "credential-only-secret",
    });
    if (set?.kind !== "setCredential") throw new Error("expected credential set");
    host({
      kind: "settingsMutation",
      requestId: set.requestId,
      result: { ok: true },
    });

    fireEvent.click(screen.getByLabelText("Remove configured credential"));
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(commands("unsetCredential")).toHaveLength(1));
    expect(commands("unsetCredential")[0]).toMatchObject({
      ref: "DEEPSEEK_API_KEY",
    });
  });

  it("settles a Plugins credential stage on disconnect without retaining its secret", async () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    const request = commands("getSettingsSection").find((command) =>
      command.kind === "getSettingsSection" && command.section === "plugins");
    if (request?.kind !== "getSettingsSection") throw new Error("expected Plugins");
    host({
      kind: "settingsSection",
      requestId: request.requestId,
      view: READ_ONLY_WEB_PLUGINS,
    });
    const secret = screen.getByLabelText<HTMLInputElement>("API key");
    fireEvent.change(secret, { target: { value: "plugin-stage-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(commands("setCredential")).toHaveLength(1));
    const credential = commands("setCredential")[0];
    if (credential?.kind !== "setCredential") throw new Error("expected credential");

    host({ kind: "hostDisconnected", detail: "Bridge stopped" });
    host({
      kind: "settingsMutation",
      requestId: credential.requestId,
      result: { ok: true },
    });

    expect(secret).toHaveValue("");
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(JSON.stringify(setState.mock.calls)).not.toContain("plugin-stage-secret");
    postMessage.mockClear();
    host({
      kind: "ready",
      sessionId: "session-1",
      cwd: "/workspace",
      models: {
        current: { provider: "deepseek", model: "chat" },
        models: [{ provider: "deepseek", model: "chat", label: "Chat" }],
      },
      permissions: {
        current: "workspace-write",
        presets: [{ id: "workspace-write", label: "Workspace Write" }],
      },
    });
    expect(commands("getSettingsSection").filter((command) =>
      command.kind === "getSettingsSection" && command.section === "plugins"))
      .toHaveLength(1);
  });

  it("ignores a stale pre-disconnect Plugins section response", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    const stale = commands("getSettingsSection").find((command) =>
      command.kind === "getSettingsSection" && command.section === "plugins");
    if (stale?.kind !== "getSettingsSection") throw new Error("expected stale Plugins");
    host({ kind: "hostDisconnected", detail: "restart" });
    postMessage.mockClear();
    host({
      kind: "ready",
      sessionId: "session-1",
      cwd: "/workspace",
      models: {
        current: { provider: "deepseek", model: "chat" },
        models: [{ provider: "deepseek", model: "chat", label: "Chat" }],
      },
      permissions: {
        current: "workspace-write",
        presets: [{ id: "workspace-write", label: "Workspace Write" }],
      },
    });
    const fresh = commands("getSettingsSection").find((command) =>
      command.kind === "getSettingsSection" && command.section === "plugins");
    if (fresh?.kind !== "getSettingsSection") throw new Error("expected fresh Plugins");
    const refreshed = {
      ...PLUGINS,
      namespaces: PLUGINS.namespaces.map((namespace) => ({
        ...namespace,
        revision: 10,
      })),
    };
    host({ kind: "settingsSection", requestId: fresh.requestId, view: refreshed });
    host({ kind: "settingsSection", requestId: stale.requestId, view: PLUGINS });
    fireEvent.change(screen.getByLabelText("Timeout (ms)"), {
      target: { value: "20000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(commands("mutateSettings").at(-1)).toMatchObject({
      namespace: "shell",
      expectedRevision: 10,
    });
  });

  it("does not let a late Models read replace a reconnected custom revision", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    const oldRead = commands("getSettingsSection").find(
      (command) =>
        command.kind === "getSettingsSection" && command.section === "models",
    );
    if (oldRead?.kind !== "getSettingsSection") {
      throw new Error("expected old Models request");
    }
    host({ kind: "hostDisconnected", detail: "Bridge stopped" });
    host({
      kind: "ready",
      sessionId: "session-1",
      cwd: "/workspace",
      models: {
        current: { provider: "deepseek", model: "chat" },
        models: [{ provider: "deepseek", model: "chat", label: "Chat" }],
      },
      permissions: {
        current: "workspace-write",
        presets: [{ id: "workspace-write", label: "Workspace Write" }],
      },
      context: { used: 0, window: 128_000 },
    });
    const newRead = commands("getSettingsSection").filter(
      (command) =>
        command.kind === "getSettingsSection" && command.section === "models",
    ).at(-1);
    if (newRead?.kind !== "getSettingsSection") {
      throw new Error("expected reconnected Models request");
    }
    const refreshed = {
      ...CUSTOM_MODELS,
      namespaces: CUSTOM_MODELS.namespaces.map((namespace) => ({
        ...namespace,
        revision: 10,
      })),
    };
    host({ kind: "settingsSection", requestId: newRead.requestId, view: refreshed });
    fireEvent.click(screen.getByRole("button", { name: "Add a custom provider" }));
    fireEvent.change(screen.getByLabelText("Provider ID"), {
      target: { value: "acme-gateway" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://gateway.example/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));
    fireEvent.change(screen.getByLabelText("Model ID 1"), {
      target: { value: "acme-model" },
    });

    host({ kind: "settingsSection", requestId: oldRead.requestId, view: CUSTOM_MODELS });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(commands("mutateSettings").at(-1)).toMatchObject({
      expectedRevision: 10,
    });
  });

  it("issues exactly one follow-up when invalidated during an in-flight read", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const first = commands("getSettingsSection")[0];
    if (first?.kind !== "getSettingsSection") {
      throw new Error("expected General request");
    }

    host({
      kind: "settingsInvalidated",
      sections: ["general"],
      reason: "document",
    });
    expect(commands("getSettingsSection")).toHaveLength(1);

    host({ kind: "settingsSection", requestId: first.requestId, view: GENERAL });
    expect(commands("getSettingsSection")).toHaveLength(2);
    expect(commands("getSettingsSection")[1]).toMatchObject({
      kind: "getSettingsSection",
      section: "general",
    });
  });

  it("retries a correlated error and retains last-good content through success", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const first = commands("getSettingsSection")[0];
    if (first?.kind !== "getSettingsSection") {
      throw new Error("expected General request");
    }
    host({ kind: "settingsSection", requestId: first.requestId, view: GENERAL });
    host({
      kind: "settingsInvalidated",
      sections: ["general"],
      reason: "document",
    });
    const refresh = commands("getSettingsSection")[1];
    if (refresh?.kind !== "getSettingsSection") {
      throw new Error("expected General refresh");
    }
    host({
      kind: "settingsSection",
      requestId: refresh.requestId,
      error: { code: "settings-rejected", message: "Read failed" },
    });

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Read failed");
    expect(screen.getByLabelText("General")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("Refreshing settings…")).toBeVisible();
    const retry = commands("getSettingsSection")[2];
    if (retry?.kind !== "getSettingsSection") {
      throw new Error("expected General retry");
    }
    host({ kind: "settingsSection", requestId: retry.requestId, view: GENERAL });

    expect(screen.queryByText("Read failed")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.getByLabelText("General")).toBeVisible();
  });

  it("refreshes an active error section that still has last-good data after invalidation", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const first = commands("getSettingsSection")[0];
    if (first?.kind !== "getSettingsSection") {
      throw new Error("expected General request");
    }
    host({ kind: "settingsSection", requestId: first.requestId, view: GENERAL });
    host({
      kind: "settingsInvalidated",
      sections: ["general"],
      reason: "document",
    });
    const refresh = commands("getSettingsSection")[1];
    if (refresh?.kind !== "getSettingsSection") {
      throw new Error("expected General refresh");
    }
    host({
      kind: "settingsSection",
      requestId: refresh.requestId,
      error: { code: "settings-rejected", message: "Read failed" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Read failed");
    expect(screen.getByLabelText("General")).toBeVisible();
    postMessage.mockClear();

    host({
      kind: "settingsInvalidated",
      sections: ["general"],
      reason: "document",
    });
    expect(commands("getSettingsSection")).toHaveLength(1);
    expect(commands("getSettingsSection")[0]).toMatchObject({
      kind: "getSettingsSection",
      section: "general",
    });
  });

  it("hydrates the last locale from retained state before General arrives", () => {
    retainedState = { locale: "zh" };
    render(<App />);
    expect(screen.getByLabelText("消息")).toBeVisible();
    expect(setState).toHaveBeenCalledWith({ locale: "zh" });
  });

  it("persists only the authoritative locale in retained webview state", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const request = commands("getSettingsSection")[0];
    if (request?.kind !== "getSettingsSection") {
      throw new Error("expected General request");
    }
    const localized = {
      ...FULL_GENERAL,
      namespaces: FULL_GENERAL.namespaces.map((namespace) =>
        namespace.namespace === "locale"
          ? {
              ...namespace,
              user: { preference: "zh" },
              value: { preference: "zh" },
            }
          : namespace,
      ),
    };
    host({ kind: "settingsSection", requestId: request.requestId, view: localized });
    expect(setState).toHaveBeenCalledWith({ locale: "zh" });
    expect(JSON.stringify(setState.mock.calls)).not.toContain("super-secret");
    expect(screen.getByRole("dialog", { name: "设置" })).toBeVisible();
  });

  it("rejects a stale same-request section response after reconnect", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    const first = commands("getSettingsSection").find(
      (command) =>
        command.kind === "getSettingsSection" && command.section === "models",
    );
    if (first?.kind !== "getSettingsSection") {
      throw new Error("expected Models request");
    }
    host({ kind: "hostDisconnected", detail: "DSH stopped" });
    host({
      kind: "ready",
      sessionId: "session-1",
      cwd: "/workspace",
      models: {
        current: { provider: "deepseek", model: "chat" },
        models: [{ provider: "deepseek", model: "chat", label: "Chat" }],
      },
      permissions: {
        current: "workspace-write",
        presets: [{ id: "workspace-write", label: "Workspace Write" }],
      },
    });
    host({
      kind: "settingsSection",
      requestId: first.requestId,
      view: {
        section: "models",
        namespaces: [],
        providers: [{
          ...MODELS.providers[0]!,
          label: "Stale provider",
        }],
        credentials: [],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    expect(screen.queryByText("Stale provider")).toBeNull();
  });

  it("blocks settings dismissal while a Models delete confirmation is open", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    const request = commands("getSettingsSection").find(
      (command) =>
        command.kind === "getSettingsSection" && command.section === "models",
    );
    if (request?.kind !== "getSettingsSection") {
      throw new Error("expected Models request");
    }
    host({
      kind: "settingsSection",
      requestId: request.requestId,
      view: {
        ...MODELS,
        providers: MODELS.providers.map((provider) => ({
          ...provider,
          removable: true,
        })),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete DeepSeek" }));
    expect(screen.getByRole("alertdialog", { name: "Delete provider?" })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.queryByRole("alertdialog", { name: "Delete provider?" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete DeepSeek" }));
    fireEvent.pointerDown(screen.getByTestId("settings-mask"));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("alertdialog", { name: "Delete provider?" })).toBeVisible();
  });

  it("keeps the modal and cached content on disconnect then refreshes on ready", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const request = commands("getSettingsSection")[0];
    if (request?.kind !== "getSettingsSection") {
      throw new Error("expected General request");
    }
    host({ kind: "settingsSection", requestId: request.requestId, view: GENERAL });
    postMessage.mockClear();

    host({ kind: "hostDisconnected", detail: "DSH stopped" });
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(
      screen.getAllByRole("alert").some((alert) =>
        alert.textContent?.includes("DSH stopped"),
      ),
    ).toBe(true);

    host({
      kind: "ready",
      sessionId: "session-1",
      cwd: "/workspace",
      models: {
        current: { provider: "deepseek", model: "chat" },
        models: [{ provider: "deepseek", model: "chat", label: "Chat" }],
      },
      permissions: {
        current: "workspace-write",
        presets: [{ id: "workspace-write", label: "Workspace Write" }],
      },
    });
    expect(commands("getSettingsSection")).toHaveLength(1);
    expect(commands("getSettingsSection")[0]).toMatchObject({
      kind: "getSettingsSection",
      section: "general",
    });
  });

  it("integrates Agent Presets reads, inert viewer content, and trusted open ids", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Agent Presets" }));
    const request = commands("getSettingsSection").find(
      (command) =>
        command.kind === "getSettingsSection" &&
        command.section === "agent-presets",
    );
    if (request?.kind !== "getSettingsSection") {
      throw new Error("expected Agent Presets request");
    }
    host({ kind: "settingsSection", requestId: request.requestId, view: AGENT_PRESETS });
    expect(screen.queryByText(/not available in this version/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View Standard Mode" }));
    const read = commands("readAgentPreset")[0];
    if (read?.kind !== "readAgentPreset") throw new Error("expected preset read");
    host({
      kind: "agentPresetContent",
      requestId: read.requestId,
      result: {
        ok: true,
        presetId: "standard",
        trust: "system",
        content: "<script>hostile()</script>",
      },
    });
    const viewer = screen.getByRole("dialog", { name: "Preset content · Standard Mode" });
    expect(viewer.querySelector("pre")).toHaveTextContent("<script>hostile()</script>");
    expect(viewer.querySelector("script")).toBeNull();

    fireEvent.click(within(viewer).getByRole("button", { name: "Close settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Mine" }));
    expect(commands("openAgentPreset")[0]).toEqual(expect.objectContaining({
      kind: "openAgentPreset",
      presetId: "mine",
    }));
  });

  it("includes a partial preset copy in dirty close and preserves it across disconnect", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Agent Presets" }));
    const request = commands("getSettingsSection").find(
      (command) =>
        command.kind === "getSettingsSection" &&
        command.section === "agent-presets",
    );
    if (request?.kind !== "getSettingsSection") throw new Error("expected preset request");
    host({ kind: "settingsSection", requestId: request.requestId, view: AGENT_PRESETS });
    fireEvent.click(screen.getByRole("button", { name: "Copy Standard Mode" }));
    fireEvent.change(screen.getByLabelText("Identifier"), {
      target: { value: "my-copy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.getByLabelText("Identifier")).toHaveValue("my-copy");

    host({ kind: "hostDisconnected", detail: "restart" });
    expect(screen.getByLabelText("Identifier")).toHaveValue("my-copy");
    postMessage.mockClear();
    host({
      kind: "ready",
      sessionId: "session-1",
      cwd: "/workspace",
      models: {
        current: { provider: "deepseek", model: "chat" },
        models: [{ provider: "deepseek", model: "chat", label: "Chat" }],
      },
      permissions: {
        current: "workspace-write",
        presets: [{ id: "workspace-write", label: "Workspace Write" }],
      },
    });
    expect(commands("getSettingsSection")).toContainEqual(expect.objectContaining({
      kind: "getSettingsSection",
      section: "agent-presets",
    }));
  });

  it("ignores a stale pre-disconnect Agent Presets section response", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Agent Presets" }));
    const stale = commands("getSettingsSection").find(
      (command) =>
        command.kind === "getSettingsSection" &&
        command.section === "agent-presets",
    );
    if (stale?.kind !== "getSettingsSection") throw new Error("expected stale request");

    host({ kind: "hostDisconnected", detail: "restart" });
    postMessage.mockClear();
    host({
      kind: "ready",
      sessionId: "session-1",
      cwd: "/workspace",
      models: {
        current: { provider: "deepseek", model: "chat" },
        models: [{ provider: "deepseek", model: "chat", label: "Chat" }],
      },
      permissions: {
        current: "workspace-write",
        presets: [{ id: "workspace-write", label: "Workspace Write" }],
      },
    });
    const fresh = commands("getSettingsSection").find(
      (command) =>
        command.kind === "getSettingsSection" &&
        command.section === "agent-presets",
    );
    if (fresh?.kind !== "getSettingsSection") throw new Error("expected fresh request");
    host({
      kind: "settingsSection",
      requestId: fresh.requestId,
      view: {
        ...AGENT_PRESETS,
        presets: AGENT_PRESETS.presets.map((preset) =>
          preset.id === "mine" ? { ...preset, name: "Fresh Mine" } : preset),
      },
    });
    host({ kind: "settingsSection", requestId: stale.requestId, view: AGENT_PRESETS });
    expect(screen.getByRole("button", { name: "Open Fresh Mine" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Open Mine" })).toBeNull();
  });

  it("ignores a late preset mutation after disconnect and preserves its copy draft", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Agent Presets" }));
    const request = commands("getSettingsSection").find(
      (command) =>
        command.kind === "getSettingsSection" &&
        command.section === "agent-presets",
    );
    if (request?.kind !== "getSettingsSection") throw new Error("expected preset request");
    host({ kind: "settingsSection", requestId: request.requestId, view: AGENT_PRESETS });
    fireEvent.click(screen.getByRole("button", { name: "Copy Standard Mode" }));
    fireEvent.change(screen.getByLabelText("Identifier"), {
      target: { value: "pending-copy" },
    });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Pending Copy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    const mutation = commands("copyAgentPreset")[0];
    if (mutation?.kind !== "copyAgentPreset") throw new Error("expected copy");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("dialog", {
      name: "Copy Agent Preset · Standard Mode",
    })).toBeVisible();

    host({ kind: "hostDisconnected", detail: "restart" });
    host({
      kind: "settingsMutation",
      requestId: mutation.requestId,
      result: { ok: true },
    });
    expect(screen.getByLabelText("Identifier")).toHaveValue("pending-copy");
    expect(screen.getByLabelText("Name")).toHaveValue("Pending Copy");
    expect(screen.getByRole("dialog", {
      name: "Copy Agent Preset · Standard Mode",
    })).toBeVisible();
  });
});

describe("App optional section lifecycle", () => {
  function navLabels(): string[] {
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    return within(nav)
      .getAllByRole("button")
      .map((button) => (button.textContent ?? "").replace(/[^A-Za-z ]/gu, ""));
  }

  it("advertises both optional nav rows after Plugins and revokes them live", () => {
    renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(navLabels()).toEqual([
      "General",
      "Models",
      "Plugins",
      "Agent Presets",
      "Extension",
    ]);

    host({ kind: "settingsCapabilities", sections: ["mcp", "web-search"] });
    expect(navLabels()).toEqual([
      "General",
      "Models",
      "Plugins",
      "MCP",
      "Web Search",
      "Agent Presets",
      "Extension",
    ]);

    host({ kind: "settingsCapabilities", sections: [] });
    expect(navLabels()).toEqual([
      "General",
      "Models",
      "Plugins",
      "Agent Presets",
      "Extension",
    ]);

    host({ kind: "settingsCapabilities", sections: ["mcp"] });
    expect(navLabels()).toEqual([
      "General",
      "Models",
      "Plugins",
      "MCP",
      "Agent Presets",
      "Extension",
    ]);
  });

  it("polls MCP every 2,000 ms only while open, active, and connected", () => {
    vi.useFakeTimers();
    try {
      openMcpSection();
      expect(sectionReads("mcp")).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(1_999);
      });
      expect(sectionReads("mcp")).toHaveLength(1);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(sectionReads("mcp")).toHaveLength(2);

      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(sectionReads("mcp")).toHaveLength(2);
      answerSectionRead("mcp", MCP);
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(sectionReads("mcp")).toHaveLength(3);
      answerSectionRead("mcp", MCP);

      fireEvent.click(screen.getByRole("button", { name: "Web Search" }));
      expect(sectionReads("web-search")).toHaveLength(1);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(sectionReads("mcp")).toHaveLength(3);
      expect(sectionReads("web-search")).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: "MCP" }));
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(sectionReads("mcp")).toHaveLength(4);
      answerSectionRead("mcp", MCP);

      fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(sectionReads("mcp")).toHaveLength(4);

      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(sectionReads("mcp")).toHaveLength(5);
      answerSectionRead("mcp", MCP);

      host({ kind: "hostDisconnected", detail: "DSH stopped" });
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(sectionReads("mcp")).toHaveLength(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs a full MCP server lifecycle through the relay", () => {
    openMcpSection();

    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    fireEvent.change(screen.getByLabelText("Server name"), {
      target: { value: "Beta" },
    });
    fireEvent.change(screen.getByLabelText("Command"), {
      target: { value: "beta-mcp" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(lastMcpOperation().operation).toMatchObject({
      kind: "upsertServer",
      server: { serverName: "Beta", transport: "stdio", command: "beta-mcp" },
    });
    const beta: McpServerWire = {
      ...MCP_SERVER,
      id: "beta",
      serverName: "Beta",
      command: "beta-mcp",
    };
    answerMcpOperation(mcpDetail(beta));
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.getByRole("listitem", { name: "Beta" })).toBeVisible();

    openMcpEditor();
    fireEvent.change(screen.getByLabelText("Server name"), {
      target: { value: "Alpha Prime" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(lastMcpOperation().operation).toMatchObject({
      kind: "upsertServer",
      server: { serverId: "alpha", serverName: "Alpha Prime" },
    });
    const renamed: McpServerWire = { ...MCP_SERVER, serverName: "Alpha Prime" };
    answerMcpOperation(mcpDetail(renamed));
    expect(screen.getByRole("listitem", { name: "Alpha Prime" })).toBeVisible();

    fireEvent.click(within(screen.getByRole("listitem", { name: "Alpha Prime" }))
      .getByRole("switch", { name: "Enabled" }));
    expect(lastMcpOperation().operation).toEqual({
      kind: "setServerEnabled",
      serverId: "alpha",
      enabled: true,
    });
    const enabled: McpServerWire = { ...renamed, enabled: true };
    answerMcpOperation(mcpDetail(enabled));
    expect(within(screen.getByRole("listitem", { name: "Alpha Prime" }))
      .getByRole("switch", { name: "Enabled" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(lastMcpOperation().operation).toEqual({
      kind: "connectServer",
      serverId: "alpha",
    });
    answerMcpOperation(mcpDetail(enabled, {
      status: { state: "connected", toolCount: 1, connectedAt: "now" },
      tools: [{ name: "search", description: "Search", enabled: true }],
    }));
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Alpha Prime", level: 3 }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("switch", { name: "search" }));
    expect(lastMcpOperation().operation).toEqual({
      kind: "setToolEnabled",
      serverId: "alpha",
      toolName: "search",
      enabled: false,
    });
    answerMcpOperation(mcpDetail(enabled, {
      status: { state: "connected", toolCount: 1, connectedAt: "now" },
      tools: [{ name: "search", description: "Search", enabled: false }],
    }));
    expect(screen.getByRole("switch", { name: "search" }))
      .toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByRole("button", { name: "Delete Alpha Prime" }));
    const confirmation = screen.getByRole("alertdialog", {
      name: "Delete MCP server?",
    });
    fireEvent.click(within(confirmation).getByRole("button", { name: "Delete" }));
    expect(lastMcpOperation().operation).toEqual({
      kind: "removeServer",
      serverId: "alpha",
    });
    answerMcpOperation();
    expect(screen.queryByRole("listitem", { name: "Alpha Prime" })).toBeNull();
    expect(screen.getByRole("listitem", { name: "Beta" })).toBeVisible();
  });

  it("reads MCP detail and appends newer log pages on each poll tick", () => {
    vi.useFakeTimers();
    try {
      openMcpSection();
      fireEvent.click(
        screen.getByRole("button", { name: /Alpha.*Standard input/ }),
      );
      answerMcpDetail(mcpDetail(MCP_SERVER));
      fireEvent.click(screen.getByRole("button", { name: "Logs" }));

      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      const firstLogs = commands("getMcpLogs").at(-1);
      expect(firstLogs).toEqual(expect.objectContaining({
        kind: "getMcpLogs",
        serverId: "alpha",
      }));
      expect(firstLogs).not.toHaveProperty("after");
      if (firstLogs?.kind !== "getMcpLogs") throw new Error("expected logs read");
      host({
        kind: "mcpLogs",
        requestId: firstLogs.requestId,
        result: {
          ok: true,
          serverId: "alpha",
          next: 1,
          entries: [{ at: "t1", level: "info", message: "first line" }],
        },
      });
      expect(screen.getByText("first line")).toBeVisible();

      answerSectionRead("mcp", MCP);
      answerMcpDetail(mcpDetail(MCP_SERVER));
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      const secondLogs = commands("getMcpLogs").at(-1);
      expect(secondLogs).toEqual(expect.objectContaining({
        kind: "getMcpLogs",
        serverId: "alpha",
        after: 1,
      }));
      if (secondLogs?.kind !== "getMcpLogs") throw new Error("expected logs read");
      host({
        kind: "mcpLogs",
        requestId: secondLogs.requestId,
        result: {
          ok: true,
          serverId: "alpha",
          next: 2,
          entries: [{ at: "t2", level: "warn", message: "second line" }],
        },
      });
      expect(screen.getByText("first line")).toBeVisible();
      expect(screen.getByText("second line")).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers MCP polling after a failed section read", () => {
    vi.useFakeTimers();
    try {
      openMcpSection();
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      const failed = sectionReads("mcp").at(-1);
      if (failed === undefined) throw new Error("expected a polled MCP read");
      host({
        kind: "settingsSection",
        requestId: failed,
        error: { code: "internal", message: "MCP list unavailable" },
      });
      expect(screen.getByText(
        "MCP servers could not be refreshed. Retry to keep using the last loaded data.",
      )).toBeVisible();
      expect(screen.getByRole("listitem", { name: "Alpha" })).toBeVisible();

      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(sectionReads("mcp")).toHaveLength(3);
      answerSectionRead("mcp", MCP);
      expect(screen.queryByText(
        "MCP servers could not be refreshed. Retry to keep using the last loaded data.",
      )).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an open MCP editor while an invalidated section refreshes", () => {
    openMcpSection();
    openMcpEditor();
    fireEvent.change(screen.getByLabelText("Server name"), {
      target: { value: "Alpha Draft" },
    });
    postMessage.mockClear();

    host({ kind: "settingsInvalidated", sections: ["mcp"], reason: "mcp" });
    expect(sectionReads("mcp")).toHaveLength(1);
    expect(sectionReads("web-search")).toHaveLength(0);
    answerSectionRead("mcp", mcpView(mcpDetail(MCP_SERVER, {
      status: { state: "connected", toolCount: 2, connectedAt: "now" },
    })));

    expect(screen.getByLabelText("Server name")).toHaveValue("Alpha Draft");
    expect(screen.getByText(/Connected · 2 tools · now/)).toBeVisible();
  });

  it("hydrates the MCP list once from the initial section read", () => {
    openMcpSection();

    expect(sectionReads("mcp")).toHaveLength(1);
    expect(commands("getMcpServer")).toHaveLength(0);
    expect(screen.getByRole("listitem", { name: "Alpha" })).toBeVisible();
    expect(screen.queryByText("Loading settings…")).toBeNull();
  });

  it("keeps a deleted server absent when MCP remounts before the next poll", () => {
    const beta: McpServerWire = {
      ...MCP_SERVER,
      id: "beta",
      serverName: "Beta",
      command: "beta-mcp",
    };
    openMcpSection(mcpView(mcpDetail(MCP_SERVER), mcpDetail(beta)));

    openMcpDetail();
    fireEvent.click(screen.getByRole("button", { name: "Delete Alpha" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "Delete MCP server?" }))
        .getByRole("button", { name: "Delete" }),
    );
    answerMcpOperation();
    expect(screen.queryByRole("listitem", { name: "Alpha" })).toBeNull();

    postMessage.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("listitem", { name: "Beta" })).toBeVisible();
    expect(screen.queryByRole("listitem", { name: "Alpha" })).toBeNull();
    expect(sectionReads("mcp")).toHaveLength(0);
  });

  it("keeps an adopted status and tool change across a section switch", () => {
    openMcpSection();
    fireEvent.click(within(screen.getByRole("listitem", { name: "Alpha" }))
      .getByRole("switch", { name: "Enabled" }));
    answerMcpOperation(mcpDetail({ ...MCP_SERVER, enabled: true }, {
      status: { state: "connected", toolCount: 2, connectedAt: "now" },
      tools: [
        { name: "search", description: "Search", enabled: true },
        { name: "fetch", description: "Fetch", enabled: false },
      ],
    }));
    expect(screen.getByText(/Connected · 2 tools · now/)).toBeVisible();
    postMessage.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.click(screen.getByRole("button", { name: "MCP" }));

    expect(screen.getByText(/Connected · 2 tools · now/)).toBeVisible();
    expect(within(screen.getByRole("listitem", { name: "Alpha" }))
      .getByRole("switch", { name: "Enabled" })).toHaveAttribute("aria-checked", "true");
    expect(sectionReads("mcp")).toHaveLength(0);
  });

  it("leaves the MCP list unchanged for a stale operation reply", () => {
    openMcpSection();
    postMessage.mockClear();

    host({
      kind: "mcpOperation",
      requestId: "operation-from-a-previous-life",
      result: {
        ok: true,
        detail: mcpDetail({ ...MCP_SERVER, id: "ghost", serverName: "Ghost" }),
      },
    });
    expect(screen.queryByRole("listitem", { name: "Ghost" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.click(screen.getByRole("button", { name: "MCP" }));

    expect(screen.queryByRole("listitem", { name: "Ghost" })).toBeNull();
    expect(screen.getByRole("listitem", { name: "Alpha" })).toBeVisible();
    expect(sectionReads("mcp")).toHaveLength(0);
  });

  it("discards MCP state only when its capability disappears", () => {
    openMcpSection();
    openMcpEditor();
    fireEvent.change(screen.getByLabelText("Server name"), {
      target: { value: "Alpha Draft" },
    });

    host({ kind: "settingsCapabilities", sections: ["mcp", "web-search"] });
    expect(screen.getByLabelText("Server name")).toHaveValue("Alpha Draft");

    host({ kind: "settingsInvalidated", sections: ["mcp"], reason: "mcp" });
    const pending = sectionReads("mcp").at(-1);
    if (pending === undefined) throw new Error("expected a refresh read");

    host({ kind: "settingsCapabilities", sections: ["web-search"] });
    expect(screen.queryByRole("button", { name: "MCP" })).toBeNull();
    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    host({ kind: "settingsSection", requestId: pending, view: MCP });
    expect(screen.queryByRole("button", { name: "MCP" })).toBeNull();
    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("alertdialog", {
      name: "Discard unsaved settings?",
    })).toBeNull();
  });

  it("preserves both drafts across disconnect and refreshes on reconnect", () => {
    vi.useFakeTimers();
    try {
      renderReady();
      host({ kind: "settingsCapabilities", sections: ["mcp", "web-search"] });
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));

      fireEvent.click(screen.getByRole("button", { name: "Web Search" }));
      const webSearchRead = sectionReads("web-search").at(-1);
      if (webSearchRead === undefined) {
        throw new Error("expected a Web Search read");
      }
      host({
        kind: "settingsSection",
        requestId: webSearchRead,
        view: WEB_SEARCH,
      });
      fireEvent.click(screen.getByRole("radio", { name: "SearXNG" }));
      fireEvent.change(screen.getByLabelText("Base URL"), {
        target: { value: "https://search.example" },
      });

      fireEvent.click(screen.getByRole("button", { name: "MCP" }));
      answerSectionRead("mcp", MCP);
      fireEvent.click(
        screen.getByRole("button", { name: /Alpha.*Standard input/ }),
      );
      answerMcpDetail(mcpDetail(MCP_SERVER));
      fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
      fireEvent.change(screen.getByLabelText("Server name"), {
        target: { value: "Alpha Draft" },
      });
      fireEvent.change(screen.getByLabelText("Authentication"), {
        target: { value: "headers" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
      fireEvent.click(screen.getByRole("button", { name: "Add header" }));
      fireEvent.change(screen.getByLabelText("Header name 1"), {
        target: { value: "Authorization" },
      });
      fireEvent.change(screen.getByLabelText("Header value 1"), {
        target: { value: "mcp-disconnect-secret" },
      });

      host({ kind: "hostDisconnected", detail: "DSH stopped" });
      expect(screen.getByRole("button", { name: "MCP" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Web Search" })).toBeVisible();
      expect(screen.getByText("Unavailable")).toBeVisible();
      expect(
        within(screen.getByRole("dialog", { name: "Settings" })).getByRole(
          "alert",
        ),
      ).toHaveTextContent("DSH stopped");
      expect(screen.queryByRole("form")).toBeNull();
      postMessage.mockClear();

      host({
        kind: "ready",
        sessionId: "session-1",
        cwd: "/workspace",
        models: {
          current: { provider: "deepseek", model: "chat" },
          models: [{ provider: "deepseek", model: "chat", label: "Chat" }],
        },
        permissions: {
          current: "workspace-write",
          presets: [{ id: "workspace-write", label: "Workspace Write" }],
        },
        context: { used: 0, window: 128_000 },
      });
      expect(commands("getSettingsCapabilities")).toHaveLength(1);
      expect(sectionReads("general")).toHaveLength(1);
      host({ kind: "settingsCapabilities", sections: ["mcp", "web-search"] });
      answerSectionRead("mcp", MCP);

      expect(screen.getByLabelText("Server name")).toHaveValue("Alpha Draft");
      // The remounted editor starts collapsed; the draft keeps the header name
      // while the secret value is left to be retyped.
      fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
      expect(screen.getByLabelText("Header name 1")).toHaveValue("Authorization");
      expect(screen.getByLabelText("Header value 1")).toHaveValue("");

      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(commands("getMcpServer").at(-1)).toEqual(
        expect.objectContaining({ kind: "getMcpServer", serverId: "alpha" }),
      );

      fireEvent.click(screen.getByRole("button", { name: "Web Search" }));
      expect(screen.getByRole("radio", { name: "SearXNG" })).toBeChecked();
      expect(screen.getByLabelText("Base URL")).toHaveValue(
        "https://search.example",
      );
      expect(JSON.stringify(retainedState)).not.toContain(
        "mcp-disconnect-secret",
      );
      expect(JSON.stringify(setState.mock.calls)).not.toContain(
        "mcp-disconnect-secret",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("raises one dirty-close confirmation for both optional sections", () => {
    renderReady();
    host({ kind: "settingsCapabilities", sections: ["mcp", "web-search"] });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    fireEvent.click(screen.getByRole("button", { name: "Web Search" }));
    const webSearchRead = sectionReads("web-search").at(-1);
    if (webSearchRead === undefined) {
      throw new Error("expected a Web Search read");
    }
    host({
      kind: "settingsSection",
      requestId: webSearchRead,
      view: WEB_SEARCH,
    });
    fireEvent.click(screen.getByRole("radio", { name: "Brave Search" }));

    fireEvent.click(screen.getByRole("button", { name: "MCP" }));
    answerSectionRead("mcp", MCP);
    openMcpEditor();
    fireEvent.change(screen.getByLabelText("Server name"), {
      target: { value: "Alpha Draft" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    const confirmation = screen.getByRole("alertdialog", {
      name: "Discard unsaved settings?",
    });
    fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Server name")).toHaveValue("Alpha Draft");

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByRole("form")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Web Search" }));
    expect(screen.getByRole("radio", { name: "Tavily" })).toBeChecked();
  });

  it("blocks settings dismissal while an MCP delete confirmation is open", () => {
    openMcpSection();
    openMcpDetail();
    fireEvent.click(screen.getByRole("button", { name: "Delete Alpha" }));
    expect(screen.getByRole("alertdialog", {
      name: "Delete MCP server?",
    })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    expect(screen.queryByRole("alertdialog", {
      name: "Delete MCP server?",
    })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
  });

  it("saves a staged MCP header secret without retaining its value", () => {
    openMcpSection();
    openMcpEditor();
    fireEvent.change(screen.getByLabelText("Authentication"), {
      target: { value: "headers" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: "Add header" }));
    fireEvent.change(screen.getByLabelText("Header name 1"), {
      target: { value: "Authorization" },
    });
    fireEvent.change(screen.getByLabelText("Header value 1"), {
      target: { value: "mcp-header-secret" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const upsert = lastMcpOperation();
    expect(upsert.operation).toMatchObject({
      kind: "upsertServer",
      server: { auth: { kind: "headers", headerNames: ["Authorization"] } },
    });
    expect(JSON.stringify(upsert)).not.toContain("mcp-header-secret");

    const authorized: McpServerWire = {
      ...MCP_SERVER,
      auth: { kind: "headers", headerNames: ["Authorization"] },
    };
    answerMcpOperation(mcpDetail(authorized, {
      secrets: {
        kind: "known",
        secrets: [{ name: "Authorization", configured: false }],
      },
    }));

    expect(screen.queryByRole("button", { name: "Continue saving secrets" }))
      .toBeNull();
    expect(commands("runMcpOperation")).toHaveLength(2);
    expect(lastMcpOperation().operation).toEqual({
      kind: "setServerSecrets",
      serverId: "alpha",
      secrets: [{ name: "Authorization", value: "mcp-header-secret" }],
    });
    answerMcpOperation(mcpDetail(authorized, {
      secrets: {
        kind: "known",
        secrets: [{ name: "Authorization", configured: true }],
      },
    }));

    expect(screen.queryByRole("form")).toBeNull();
    expect(JSON.stringify(retainedState)).not.toContain("mcp-header-secret");
    expect(JSON.stringify(setState.mock.calls)).not.toContain(
      "mcp-header-secret",
    );
  });
});

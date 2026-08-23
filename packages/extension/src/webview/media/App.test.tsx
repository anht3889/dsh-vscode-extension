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
  OutboundMessage,
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
  agentPresets: [{ id: "standard", label: "Standard" }],
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
  return screen.getByPlaceholderText("Message DSH…") as HTMLTextAreaElement;
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
    expect(screen.getAllByLabelText("You")).toHaveLength(1);
    expect(screen.getByLabelText("You")).toHaveTextContent("/goal write tests");
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
      "Message DSH…",
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

    fireEvent.change(screen.getByLabelText("DSH binary path"), {
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
    expect(screen.getByText("Restart DSH to apply all changes.")).toBeVisible();

    host({ kind: "status", state: "thinking", detail: "arbitrary detail" });
    expect(screen.getByRole("button", { name: "Restart DSH" })).toBeDisabled();
    host({ kind: "status", state: "idle", detail: "still arbitrary" });
    expect(screen.getByRole("button", { name: "Restart DSH" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Restart DSH" }));
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
      screen.queryByText("Restart DSH to apply all changes."),
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

    expect(screen.getByRole("button", { name: "Restart DSH" })).toBeEnabled();
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
    fireEvent.change(screen.getByLabelText("DSH binary path"), {
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
      expect(screen.getByLabelText("DSH binary path")).toHaveValue("/draft/dsh");
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
    expect(screen.getByLabelText("DSH binary path")).toHaveValue("");
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
    fireEvent.click(screen.getByRole("button", { name: "Copy Standard" }));
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
    fireEvent.change(screen.getByLabelText("DSH binary path"), {
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
    expect(screen.getByLabelText("DSH binary path")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    expect(screen.getByLabelText("Base URL")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    expect(screen.getByLabelText("Timeout (ms)")).toHaveValue(10_000);
    expect(screen.getByLabelText("Maximum parallel tool calls")).toHaveValue(4);
    fireEvent.click(screen.getByRole("button", { name: "Agent Presets" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Standard" }));
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
    expect(screen.getByText("Restart DSH to apply all changes.")).toBeVisible();

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
    expect(screen.getByText("Restart DSH to apply all changes.")).toBeVisible();
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
    fireEvent.click(screen.getByRole("button", { name: "Restart DSH" }));
    const restart = commands("restartDsh")[0];
    if (restart?.kind !== "restartDsh") throw new Error("expected restart");
    host({
      kind: "settingsHostResult",
      requestId: restart.requestId,
      action: "restart",
      result: { ok: true },
    });
    expect(
      screen.queryByText("Restart DSH to apply all changes."),
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
    expect(screen.getByRole("button", { name: "Restart DSH" })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: "Restart DSH" })).toBeDisabled();
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

    expect(screen.getByText("Restart DSH to apply all changes.")).toBeVisible();
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

    fireEvent.click(screen.getByRole("button", { name: "View Standard" }));
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
    const viewer = screen.getByRole("dialog", { name: "Preset content · Standard" });
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
    fireEvent.click(screen.getByRole("button", { name: "Copy Standard" }));
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
          preset.id === "standard" ? { ...preset, name: "Fresh Standard" } : preset),
      },
    });
    host({ kind: "settingsSection", requestId: stale.requestId, view: AGENT_PRESETS });
    expect(screen.getByRole("button", { name: "View Fresh Standard" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "View Standard" })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Copy Standard" }));
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
      name: "Copy Agent Preset · Standard",
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
      name: "Copy Agent Preset · Standard",
    })).toBeVisible();
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

const postMessage = vi.fn<(message: unknown) => void>();
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

beforeAll(async () => {
  vi.stubGlobal("acquireVsCodeApi", () => ({
    postMessage,
    getState: () => undefined,
    setState: () => undefined,
  }));
  ({ App } = await import("./App.js"));
});

afterEach(() => {
  cleanup();
  postMessage.mockClear();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function host(message: OutboundMessage | { kind: "imagesPicked"; images: EncodedImageAttachment[] }): void {
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

    expect(commands("submit")).toContainEqual({
      kind: "submit",
      text: "/goal write tests",
    });
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

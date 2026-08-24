// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React, { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isInboundMessage,
  type McpOperationMessage,
  type McpServerDetailWire,
} from "@dsh-vscode/contract";
import { McpController } from "./McpController.js";
import { McpServerEditor } from "./McpServerEditor.js";

afterEach(cleanup);

const saved: McpServerDetailWire = {
  server: {
    id: "headers",
    serverName: "Headers",
    enabled: true,
    transport: "stdio",
    command: "mcp",
    args: [],
    env: [],
    cwd: "",
    auth: { kind: "headers", headerNames: ["Authorization"] },
    toolCallTimeoutMs: 30_000,
    reconnect: {
      enabled: true,
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      maxAttempts: 5,
    },
    createdAt: "created",
    updatedAt: "updated",
  },
  status: { state: "disconnected" },
  tools: [],
  secrets: {
    kind: "known",
    secrets: [{ name: "Authorization", configured: false }],
  },
};

function setup(
  locale: "en" | "zh" = "en",
  strict = false,
  discovery: "available" | "unavailable" = "available",
  authorization: "available" | "unavailable" = "unavailable",
) {
  const sent: unknown[] = [];
  let next = 0;
  const controller = new McpController(
    (command) => sent.push(structuredClone(command)),
    vi.fn(),
    () => `request-${++next}`,
  );
  controller.updateView({
    section: "mcp",
    servers: [],
    secretStates: "available",
    oauth: authorization === "available"
      ? {
          kind: "loopback",
          origin: "http://127.0.0.1:54321",
          discovery,
          authorization,
        }
      : {
          kind: "manual",
          reason: "no-callback-origin",
          discovery,
          authorization,
        },
  });
  controller.openCreate();
  const draft = controller.snapshot().editor!;
  const editor = (
    <McpServerEditor
      controller={controller}
      locale={locale}
      draft={draft}
      secretStates="available"
      oauthDiscovery={discovery}
      oauthAuthorization={authorization}
      {...(authorization === "available"
        ? { oauthOrigin: "http://127.0.0.1:54321" }
        : {})}
    />
  );
  const mounted = render(strict ? <StrictMode>{editor}</StrictMode> : editor);
  return { controller, sent, mounted };
}

/** Switches the draft to an OAuth-over-HTTP server with the given URL. */
function selectOAuthHttp(url = "https://mcp.example/rpc"): void {
  fireEvent.click(screen.getByLabelText("Streamable HTTP"));
  fireEvent.change(screen.getByLabelText("URL"), { target: { value: url } });
  fireEvent.change(screen.getByLabelText("Authentication"), {
    target: { value: "oauth" },
  });
}

/** Fills the two fields the contract requires of every stdio record. */
function fillMandatoryStdio(name = "Headers", command = "mcp"): void {
  fireEvent.change(screen.getByLabelText("Server name"), {
    target: { value: name },
  });
  fireEvent.change(screen.getByLabelText("Command"), {
    target: { value: command },
  });
}

function declareHeader(name = "Authorization"): void {
  fireEvent.change(screen.getByLabelText("Authentication"), {
    target: { value: "headers" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add header" }));
  fireEvent.change(screen.getByLabelText("Header name 1"), {
    target: { value: name },
  });
}

function openAdvanced(): void {
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
}

function recordSuccess(requestId: string): McpOperationMessage {
  return {
    kind: "mcpOperation",
    requestId,
    result: { ok: true, detail: saved },
  };
}

function describedText(element: HTMLElement): string {
  const id = element.getAttribute("aria-describedby");
  expect(id).not.toBeNull();
  const hint = document.getElementById(id!);
  expect(hint).toBeInTheDocument();
  return hint!.textContent ?? "";
}

function secretCommands(sent: readonly unknown[]): unknown[] {
  return sent.filter((command) =>
    (command as { operation?: { kind?: string } }).operation?.kind ===
      "setServerSecrets");
}

describe.each([
  ["en", "Transport", "Command", "Authentication", "Save"],
  ["zh", "传输方式", "命令", "身份验证", "保存"],
] as const)("McpServerEditor locale %s", (locale, transport, command, auth, save) => {
  it("uses a dialog and keeps environment, timeout, and reconnect fields advanced", () => {
    setup(locale);
    expect(screen.getByRole("dialog", {
      name: locale === "en" ? "Add MCP server" : "添加 MCP 服务器",
    })).toBeVisible();
    expect(screen.getByRole("group", { name: transport })).toBeVisible();
    expect(screen.getByLabelText(command)).toBeVisible();
    expect(screen.queryByLabelText(/Tool call timeout|工具调用超时/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Streamable HTTP/ }));
    expect(screen.queryByLabelText(command)).toBeNull();
    expect(screen.getByLabelText("URL")).toBeVisible();

    fireEvent.change(screen.getByLabelText(auth), { target: { value: "oauth" } });
    for (const name of locale === "en"
      ? ["Client ID", "Authorize URL", "Token URL", "Scopes", "Redirect path"]
      : ["客户端 ID", "授权 URL", "令牌 URL", "作用域", "重定向路径"]) {
      expect(screen.getByLabelText(name)).toBeVisible();
    }
    fireEvent.click(screen.getByRole("button", { name: /Advanced|高级/ }));
    expect(screen.getByLabelText(/Tool call timeout|工具调用超时/)).toBeVisible();
    expect(screen.getByLabelText(/Initial delay|初始延迟/)).toBeVisible();
    expect(screen.getByLabelText(/Maximum delay|最大延迟/)).toBeVisible();
    expect(screen.getByLabelText(/Maximum attempts|最大尝试次数/)).toBeVisible();
    expect(screen.getByRole("button", { name: save })).toBeVisible();
    // Discovery needs no callback origin; authorization does, so it stays out.
    expect(screen.getByRole("button", {
      name: locale === "en" ? "Discover from server URL" : "从服务 URL 自动发现",
    })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Authorize|授权/ })).toBeNull();
  });

  it("localizes the refusal and the offending-field hints", () => {
    const { controller, sent } = setup(locale);
    fireEvent.submit(screen.getByRole("form"));

    expect(sent).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      locale === "en" ? /required/ : /必填/,
    );
    expect(describedText(screen.getByLabelText(/Server name|服务器名称/))).toMatch(
      locale === "en" ? /required/ : /必填/,
    );
    expect(controller.snapshot().pending).toEqual([]);
  });
});

// The plugin's own editor seeds `/callback` and its catalog refuses a redirect
// path without a leading slash, so an empty seed left a new OAuth server
// unsavable on a field the operator had no way to guess.
it("seeds the redirect path the plugin defaults to", () => {
  setup();
  selectOAuthHttp();

  expect(screen.getByLabelText("Redirect path")).toHaveValue("/callback");
  // The client id is provider-specific, so it stays empty and stays flagged.
  expect(screen.getByLabelText("Client ID")).toHaveValue("");
  expect(screen.getByLabelText("Client ID")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(screen.getByLabelText("Redirect path"))
    .not.toHaveAttribute("aria-invalid", "true");
});

describe("OAuth authorization", () => {
  it("offers Add & Authorize from name and URL and sends only provision", () => {
    const { controller, sent } = setup("en", false, "available", "available");
    selectOAuthHttp();
    fireEvent.change(screen.getByLabelText("Server name"), {
      target: { value: "Glean" },
    });

    const authorize = screen.getByRole("button", { name: "Add & Authorize" });
    expect(authorize).toBeEnabled();
    expect(screen.getByLabelText("Client ID")).toHaveValue("");
    fireEvent.click(authorize);

    expect(sent).toEqual([{
      kind: "runMcpOperation",
      requestId: "request-1",
      operation: {
        kind: "provisionOAuthServer",
        serverName: "Glean",
        url: "https://mcp.example/rpc",
        enabled: true,
      },
    }]);
    expect(screen.getByRole("button", {
      name: "Opening the identity provider…",
    })).toBeDisabled();
    expect(JSON.stringify(controller.snapshot())).not.toMatch(
      /clientSecret|accessToken|refreshToken/,
    );
  });

  it("hides Add & Authorize when authorization is unavailable", () => {
    setup();
    selectOAuthHttp();
    fireEvent.change(screen.getByLabelText("Server name"), {
      target: { value: "Glean" },
    });

    expect(screen.queryByRole("button", { name: "Add & Authorize" })).toBeNull();
  });

  it("shows the loopback callback URI under Advanced", () => {
    setup("en", false, "available", "available");
    selectOAuthHttp();
    openAdvanced();

    expect(screen.getByText(/Callback origin/)).toBeVisible();
    expect(screen.getByText("http://127.0.0.1:54321/callback")).toBeVisible();
  });
});

describe("OAuth discovery", () => {
  const discoverButton = (): HTMLElement =>
    screen.getByRole("button", { name: "Discover from server URL" });

  it("offers discovery only for an OAuth-over-HTTP draft", () => {
    setup();
    expect(screen.queryByRole("button", {
      name: "Discover from server URL",
    })).toBeNull();

    selectOAuthHttp();
    expect(discoverButton()).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Authentication"), {
      target: { value: "headers" },
    });
    expect(screen.queryByRole("button", {
      name: "Discover from server URL",
    })).toBeNull();
  });

  it("hides discovery when the mounted plugin cannot discover", () => {
    setup("en", false, "unavailable");
    selectOAuthHttp();

    expect(screen.queryByRole("button", {
      name: "Discover from server URL",
    })).toBeNull();
    expect(screen.getByText(/cannot discover OAuth endpoints/)).toBeVisible();
  });

  it("sends the request, reports progress, and fills the discovered fields", () => {
    const { controller, sent } = setup();
    selectOAuthHttp();

    fireEvent.click(discoverButton());
    expect(sent.at(-1)).toEqual({
      kind: "discoverMcpOAuth",
      requestId: "request-1",
      url: "https://mcp.example/rpc",
    });
    expect(isInboundMessage(sent.at(-1))).toBe(true);
    expect(screen.getByRole("button", { name: "Discovering…" })).toBeDisabled();

    act(() => {
      controller.receiveDiscovery({
        kind: "mcpOAuthDiscovery",
        requestId: "request-1",
        result: {
          ok: true,
          discovery: {
            clientId: "issued-client",
            authorizeUrl: "https://auth.example/authorize",
            tokenUrl: "https://auth.example/token",
            scopes: ["docs:read"],
            registered: true,
            clientSecretIssued: false,
          },
        },
      });
    });

    expect(screen.getByLabelText("Client ID")).toHaveValue("issued-client");
    expect(screen.getByLabelText("Authorize URL"))
      .toHaveValue("https://auth.example/authorize");
    expect(screen.getByLabelText("Token URL"))
      .toHaveValue("https://auth.example/token");
    expect(screen.getByLabelText("Scopes")).toHaveValue("docs:read");
    expect(discoverButton()).toBeEnabled();
  });

  it("refuses without a URL and reports a discovery failure", () => {
    const { controller, sent } = setup();
    selectOAuthHttp("");

    fireEvent.click(discoverButton());
    expect(sent).toEqual([]);
    expect(screen.getByRole("alert"))
      .toHaveTextContent("Enter the HTTP server URL first.");

    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://mcp.example/rpc" },
    });
    fireEvent.click(discoverButton());
    act(() => {
      controller.receiveDiscovery({
        kind: "mcpOAuthDiscovery",
        requestId: "request-1",
        result: {
          ok: false,
          error: { code: "mcp-rejected", message: "no metadata published" },
        },
      });
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "OAuth discovery failed: no metadata published",
    );
  });

  it("tells the operator to re-enter a registration client secret", () => {
    const { controller } = setup();
    selectOAuthHttp();
    fireEvent.click(discoverButton());

    act(() => {
      controller.receiveDiscovery({
        kind: "mcpOAuthDiscovery",
        requestId: "request-1",
        result: {
          ok: true,
          discovery: {
            clientId: "issued-client",
            authorizeUrl: "https://auth.example/authorize",
            tokenUrl: "https://auth.example/token",
            scopes: [],
            registered: true,
            clientSecretIssued: true,
          },
        },
      });
    });

    expect(screen.getByRole("status"))
      .toHaveTextContent(/issued a client secret/);
  });
});

it("gates Save on the shared contract predicate and keeps an invalid draft escapable", () => {
  const { controller, sent } = setup();
  const name = screen.getByLabelText("Server name");
  const command = screen.getByLabelText("Command");

  expect(controller.editorValid()).toBe(false);
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(command).toHaveAttribute("aria-invalid", "true");
  expect(describedText(name)).toBe("This value is required.");
  expect(describedText(command)).toBe("This value is required.");

  fireEvent.submit(screen.getByRole("form"));
  expect(sent).toEqual([]);
  expect(controller.snapshot()).toMatchObject({
    pending: [],
    editor: { errorKey: "mcpInvalidRecord" },
  });
  expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();

  fireEvent.change(name, { target: { value: "Headers" } });
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(screen.getByLabelText("Server name")).not.toHaveAttribute("aria-invalid");

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(controller.snapshot().editor).toBeUndefined();
});

it("marks every naturally reachable offending field without sending anything", () => {
  const { controller, sent } = setup();
  fillMandatoryStdio();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  openAdvanced();

  fireEvent.change(screen.getByLabelText("Tool call timeout (ms)"), {
    target: { value: "" },
  });
  expect(controller.editorValid()).toBe(false);
  expect(describedText(screen.getByLabelText("Tool call timeout (ms)")))
    .toBe("Enter a whole number greater than zero.");
  fireEvent.change(screen.getByLabelText("Tool call timeout (ms)"), {
    target: { value: "30000" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Add environment variable" }));
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(describedText(screen.getByLabelText("Environment name 1")))
    .toBe("This value is required.");
  fireEvent.click(screen.getByRole("button", {
    name: "Remove environment variable 1",
  }));

  declareHeader("");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(describedText(screen.getByLabelText("Header name 1")))
    .toBe("This value is required.");

  fireEvent.change(screen.getByLabelText("Authentication"), {
    target: { value: "oauth" },
  });
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  // The redirect path arrives seeded with the plugin's default, so only the
  // provider-specific fields are empty on arrival.
  for (const label of ["Client ID", "Authorize URL", "Token URL"]) {
    expect(describedText(screen.getByLabelText(label)))
      .toBe("This value is required.");
  }
  fireEvent.change(screen.getByLabelText("Redirect path"), {
    target: { value: "" },
  });
  expect(describedText(screen.getByLabelText("Redirect path")))
    .toBe("This value is required.");

  fireEvent.change(screen.getByLabelText("Authentication"), {
    target: { value: "none" },
  });
  fireEvent.click(screen.getByRole("radio", { name: /Streamable HTTP/ }));
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(describedText(screen.getByLabelText("URL")))
    .toBe("This value is required.");
  fireEvent.change(screen.getByLabelText("URL"), {
    target: { value: "https://mcp.example" },
  });
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  expect(sent).toEqual([]);
});

it("sends only commands the webview-to-host relay accepts", () => {
  const { controller, sent } = setup();
  fillMandatoryStdio();
  declareHeader();
  fireEvent.change(screen.getByLabelText("Header value 1"), {
    target: { value: "relayed-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  act(() => {
    controller.receiveOperation(recordSuccess("request-1"));
  });

  fireEvent.click(screen.getByRole("radio", { name: /Streamable HTTP/ }));

  expect(sent.length).toBeGreaterThan(1);
  for (const command of sent) {
    expect(isInboundMessage(command)).toBe(true);
  }
});

it("performs record then secrets from one Save without a second click", () => {
  const { controller, sent } = setup();
  fillMandatoryStdio();
  declareHeader();
  const secret = screen.getByLabelText<HTMLInputElement>("Header value 1");
  fireEvent.change(secret, { target: { value: "one-save-secret" } });
  expect(secret).toHaveAttribute("type", "password");
  expect(JSON.stringify(controller.snapshot())).not.toContain("one-save-secret");

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    kind: "runMcpOperation",
    operation: { kind: "upsertServer" },
  });
  expect(JSON.stringify(sent[0])).not.toContain("one-save-secret");

  act(() => {
    controller.receiveOperation(recordSuccess("request-1"));
  });

  expect(secretCommands(sent)).toHaveLength(1);
  expect(sent[1]).toMatchObject({
    kind: "runMcpOperation",
    operation: {
      kind: "setServerSecrets",
      secrets: [{ name: "Authorization", value: "one-save-secret" }],
    },
  });
  expect(screen.queryByRole("button", { name: "Continue saving secrets" }))
    .toBeNull();
  expect(JSON.stringify(controller.snapshot())).not.toContain("one-save-secret");

  act(() => {
    controller.receiveOperation(recordSuccess("request-2"));
  });
  expect(controller.snapshot()).toMatchObject({ secretEpoch: 1, dirty: false });
  expect(document.body).not.toHaveTextContent("one-save-secret");
});

it("writes the automatic secret command once under duplicated effects", () => {
  const { controller, sent } = setup("en", true);
  fillMandatoryStdio();
  declareHeader();
  fireEvent.change(screen.getByLabelText("Header value 1"), {
    target: { value: "strict-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const spy = vi.spyOn(controller, "continueSecretSave");

  act(() => {
    controller.receiveOperation(recordSuccess("request-1"));
  });
  act(() => {
    controller.updateView({
      section: "mcp",
      servers: [],
      secretStates: "available",
      oauth: {
        kind: "manual",
        reason: "no-callback-origin",
        discovery: "available",
        authorization: "unavailable",
      },
    });
  });

  expect(spy).toHaveBeenCalledTimes(1);
  expect(secretCommands(sent)).toHaveLength(1);
});

it("keeps the local value for retry when the automatic secret write fails", () => {
  const { controller, sent } = setup();
  fillMandatoryStdio();
  declareHeader();
  const secret = screen.getByLabelText<HTMLInputElement>("Header value 1");
  fireEvent.change(secret, { target: { value: "retryable-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  act(() => {
    controller.receiveOperation(recordSuccess("request-1"));
  });

  act(() => {
    controller.receiveOperation({
      kind: "mcpOperation",
      requestId: "request-2",
      result: {
        ok: false,
        error: {
          code: "mcp-rejected",
          message: "must not render foreign secret detail",
        },
      },
    } satisfies McpOperationMessage);
  });

  expect(secret).toHaveValue("retryable-secret");
  expect(screen.getByRole("alert")).not.toHaveTextContent("foreign secret detail");
  fireEvent.click(screen.getByRole("button", { name: "Retry secrets" }));
  expect(secretCommands(sent)).toHaveLength(2);

  act(() => {
    controller.receiveOperation(recordSuccess("request-3"));
  });
  expect(controller.snapshot()).toMatchObject({ secretEpoch: 1, dirty: false });
  expect(secret).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent("retryable-secret");
  expect(JSON.stringify(controller.snapshot())).not.toContain("retryable-secret");
});

it("shows plugin record validation verbatim and warns that env is plain text", () => {
  const { controller, sent } = setup();
  fillMandatoryStdio();
  declareHeader();
  fireEvent.change(screen.getByLabelText("Header value 1"), {
    target: { value: "unwritten-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  act(() => {
    controller.receiveOperation({
      kind: "mcpOperation",
      requestId: "request-1",
      result: {
        ok: false,
        error: { code: "mcp-rejected", message: "Plugin says name is invalid" },
      },
    });
  });

  expect(screen.getByRole("alert")).toHaveTextContent("Plugin says name is invalid");
  openAdvanced();
  expect(screen.getByText(/environment values are stored in plain text/i)).toBeVisible();
  expect(secretCommands(sent)).toEqual([]);
  expect(sent).toHaveLength(1);
});

it("keeps manual continuation only while a requested value is missing locally", () => {
  const { controller, sent } = setup();
  fillMandatoryStdio();
  act(() => {
    controller.setEditorField("auth", {
      kind: "headers",
      headerNames: ["Authorization"],
    });
    controller.stageSecret("Authorization", "staged-elsewhere");
    controller.saveEditor();
    controller.receiveOperation(recordSuccess("request-1"));
  });

  expect(sent).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Continue saving secrets" }))
    .toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Skip and close" }));

  expect(sent).toHaveLength(1);
  expect(controller.snapshot()).toMatchObject({
    secretEpoch: 1,
    dirty: false,
  });
  expect(controller.snapshot().editor).toBeUndefined();
  expect(document.body).not.toHaveTextContent("staged-elsewhere");
});

it("clears local secret fields on disconnect and clears staged intent on unmount", () => {
  const { controller, mounted } = setup();
  fireEvent.change(screen.getByLabelText("Authentication"), {
    target: { value: "oauth" },
  });
  const secret = screen.getByLabelText<HTMLInputElement>("Client secret");
  fireEvent.change(secret, { target: { value: "temporary-secret" } });
  act(() => controller.disconnect());
  expect(secret).toHaveValue("");
  expect(controller.snapshot().secretEpoch).toBe(1);
  mounted.unmount();
  expect(JSON.stringify(controller.snapshot())).not.toContain("temporary-secret");

  const second = setup();
  const stage = vi.spyOn(second.controller, "stageSecret");
  fireEvent.change(screen.getByLabelText("Authentication"), {
    target: { value: "oauth" },
  });
  fireEvent.change(screen.getByLabelText("Client secret"), {
    target: { value: "unmount-secret" },
  });
  second.mounted.unmount();
  expect(stage).toHaveBeenCalledWith("OAUTH_CLIENT_SECRET", "");
  expect(JSON.stringify(second.controller.snapshot())).not.toContain("unmount-secret");
});

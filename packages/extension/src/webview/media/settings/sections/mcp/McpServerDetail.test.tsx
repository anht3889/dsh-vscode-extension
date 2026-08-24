// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServerDetailWire } from "@dsh-vscode/contract";
import { McpController } from "./McpController.js";
import { McpServerDetail } from "./McpServerDetail.js";

afterEach(cleanup);

const detail: McpServerDetailWire = {
  server: {
    id: "oauth",
    serverName: "OAuth Server",
    enabled: true,
    transport: "streamable-http",
    url: "https://example.test",
    auth: {
      kind: "oauth",
      clientId: "client",
      authorizeUrl: "https://example.test/authorize",
      tokenUrl: "https://example.test/token",
      scopes: ["read"],
      redirectPath: "/callback",
    },
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
  status: { state: "connected", toolCount: 2, connectedAt: "now" },
  tools: [
    { name: "search", description: "Search verbatim", enabled: true },
    { name: "fetch", description: "Fetch verbatim", enabled: false },
  ],
  secrets: {
    kind: "known",
    secrets: [
      { name: "OAUTH_CLIENT_SECRET", configured: true },
      { name: "OAUTH_REFRESH", configured: false },
    ],
  },
};

function setup(
  locale: "en" | "zh" = "en",
  selected = detail,
  authorization: "available" | "unavailable" = "unavailable",
) {
  let next = 0;
  const sent: unknown[] = [];
  const controller = new McpController(
    (command) => sent.push(structuredClone(command)),
    vi.fn(),
    () => `request-${++next}`,
  );
  controller.updateView({
    section: "mcp",
    servers: [{
      server: selected.server,
      status: selected.status,
      toolCount: selected.tools.length,
      disabledToolCount: selected.tools.filter((tool) => !tool.enabled).length,
    }],
    secretStates: selected.secrets.kind === "unknown" ? "unavailable" : "available",
    oauth: authorization === "available"
      ? {
          kind: "loopback",
          origin: "http://127.0.0.1:54321",
          discovery: "available",
          authorization,
        }
      : {
          kind: "manual",
          reason: "no-callback-origin",
          discovery: "available",
          authorization,
        },
  });
  controller.select(selected.server.id);
  controller.receiveDetail({
    kind: "mcpServer",
    requestId: "request-1",
    result: { ok: true, detail: selected },
  });
  const mounted = render(
    <McpServerDetail
      controller={controller}
      locale={locale}
      snapshot={controller.snapshot()}
    />,
  );
  return { controller, mounted, sent };
}

describe.each([
  ["en", "Clear OAuth tokens", "Cancel", "Clear OAuth tokens?"],
  ["zh", "清除 OAuth 令牌", "取消", "清除 OAuth 令牌？"],
] as const)("McpServerDetail locale %s", (locale, clear, cancel, title) => {
  it("renders plugin-style dialog actions and reveals logs on demand", () => {
    const { controller } = setup(locale);
    const dialog = screen.getByRole("dialog", { name: "OAuth Server" });
    expect(dialog).toBeVisible();
    expect(screen.getByRole("switch", { name: "search" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "fetch" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByText("OAUTH_CLIENT_SECRET").parentElement).toHaveTextContent(
      locale === "en" ? "Configured" : "已配置",
    );
    expect(screen.getByText(/DeepSeek Harness Web/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Authorize|授权|Discover|发现/ })).toBeNull();
    expect(screen.queryByText(/No log entries|暂无日志条目/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Logs|日志/ }));
    expect(screen.getByText(/No log entries|暂无日志条目/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Done|完成/ }));
    expect(controller.snapshot().selectedServerId).toBeUndefined();
  });

  it("traps, dismisses, and restores focus for OAuth confirmation", () => {
    setup(locale);
    const invoking = screen.getByRole("button", { name: clear });
    fireEvent.click(invoking);
    expect(screen.getByRole("alertdialog", { name: title })).toBeVisible();
    expect(screen.getByRole("button", { name: cancel })).toHaveFocus();
    act(() => fireEvent.keyDown(document, { key: "Escape" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(invoking).toHaveFocus();
  });
});

it("renders unavailable secret reporting as degraded copy", () => {
  setup("en", { ...detail, secrets: { kind: "unknown" } });
  expect(screen.getByText(/cannot report configured secret state/i)).toBeVisible();
});

it("offers Authorize for loopback OAuth and omits the DeepSeek Harness Web note", () => {
  const { controller, sent } = setup("en", detail, "available");

  expect(screen.queryByText(/DeepSeek Harness Web/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Authorize" }));
  expect(sent.at(-1)).toMatchObject({
    kind: "runMcpOperation",
    operation: { kind: "startOAuth", serverId: "oauth" },
  });
  expect(controller.snapshot().authorizing).toBe(true);
});

it("keeps the DeepSeek Harness Web note and hides Authorize for manual OAuth", () => {
  setup();

  expect(screen.getByText(/DeepSeek Harness Web/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Authorize" })).toBeNull();
});

it("preserves the destructive button focus across controller refreshes", () => {
  const { controller } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Clear OAuth tokens" }));
  const destructive = screen.getAllByRole("button", {
    name: "Clear OAuth tokens",
  })[1]!;
  destructive.focus();
  act(() => controller.updateView({
    section: "mcp",
    servers: [{
      server: detail.server,
      status: detail.status,
      toolCount: detail.tools.length,
      disabledToolCount: 1,
    }],
    secretStates: "available",
    oauth: {
      kind: "manual",
      reason: "no-callback-origin",
      discovery: "available",
      authorization: "unavailable",
    },
  }));
  expect(destructive).toHaveFocus();
});

it("disables a busy OAuth clear and restores the surviving detail context", () => {
  const { controller } = setup();
  const invoking = screen.getByRole("button", { name: "Clear OAuth tokens" });
  const heading = screen.getByRole("heading", { name: "OAuth Server" });
  fireEvent.click(invoking);
  act(() => controller.toggleTool("oauth", "search", false));
  const destructive = screen.getAllByRole("button", {
    name: "Clear OAuth tokens",
  })[1]!;
  expect(destructive).toBeDisabled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("alertdialog")).toBeVisible();

  act(() => controller.receiveOperation({
    kind: "mcpOperation",
    requestId: "request-2",
    result: {
      ok: false,
      error: { code: "mcp-rejected", message: "toggle refused" },
    },
  }));
  fireEvent.click(destructive);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(invoking).toBeDisabled();
  expect(heading).toHaveFocus();
  act(() => controller.receiveOperation({
    kind: "mcpOperation",
    requestId: "request-3",
    result: { ok: true, detail },
  }));
  expect(heading).toHaveFocus();
});

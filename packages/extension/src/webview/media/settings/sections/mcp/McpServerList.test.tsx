// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServerListItemWire, McpStatusWire } from "@dsh-vscode/contract";
import { McpController } from "./McpController.js";
import { McpServerList } from "./McpServerList.js";

afterEach(cleanup);

const server = (id: string, status: McpStatusWire): McpServerListItemWire => ({
  server: {
    id,
    serverName: `Server ${id}`,
    enabled: id !== "disabled",
    transport: id === "http" ? "streamable-http" : "stdio",
    ...(id === "http" ? { url: "https://example.test" } : { command: "mcp" }),
    auth: { kind: "none" },
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
  status,
  toolCount: status.state === "connected" ? status.toolCount : 0,
  disabledToolCount: 0,
});

const rows = [
  server("off", { state: "disconnected" }),
  server("connecting", { state: "connecting", attempt: 2 }),
  server("connected", { state: "connected", toolCount: 3, connectedAt: "at" }),
  server("retrying", { state: "reconnecting", attempt: 4, nextDelayMs: 500 }),
  server("failed", { state: "failed", error: "plugin failure", at: "then" }),
];

const catalog = (items: McpServerListItemWire[]) => ({
  section: "mcp" as const,
  servers: items,
  secretStates: "available" as const,
  oauth: { kind: "manual" as const, reason: "no-callback-origin" as const },
});

function setup(locale: "en" | "zh" = "en", items = rows) {
  const controller = new McpController(vi.fn(), vi.fn(), () => "request");
  controller.updateView(catalog(items));
  controller.select("connected");
  render(
    <McpServerList
      controller={controller}
      locale={locale}
      snapshot={controller.snapshot()}
    />,
  );
  return controller;
}

describe.each([
  ["en", "Add server", "Connect Server off", "Edit Server connected", "Delete Server off", "Cancel"],
  ["zh", "添加服务器", "连接 Server off", "编辑 Server connected", "删除 Server off", "取消"],
] as const)("McpServerList locale %s", (locale, add, connect, edit, remove, cancel) => {
  it("renders every status and named action with selection semantics", () => {
    const controller = setup(locale);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText(/attempt 2|第 2 次/)).toBeVisible();
    expect(screen.getAllByText(/3 tools|3 个工具/).length).toBeGreaterThan(0);
    expect(screen.getByText(locale === "en" ? /500 ms/ : /500 毫秒/)).toBeVisible();
    expect(screen.getByText(/plugin failure/)).toBeVisible();
    expect(screen.getByRole("listitem", { name: "Server connected" }))
      .toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: connect })).toBeEnabled();
    expect(screen.getByRole("button", { name: edit })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: edit }));
    expect(controller.snapshot().editor?.serverId).toBe("connected");
  });

  it("shows an actionable empty state", () => {
    setup(locale, []);
    const empty = screen.getByRole("status");
    expect(within(empty).getByRole("button", { name: add })).toBeEnabled();
  });

  it("disables the editor slot during save while other server actions remain usable", () => {
    const controller = setup(locale);
    act(() => {
      controller.openEdit("connected");
      controller.saveEditor();
    });
    expect(screen.getByRole("button", { name: add })).toBeDisabled();
    expect(screen.getByRole("button", { name: edit })).toBeDisabled();
    expect(screen.getByRole("button", { name: connect })).toBeEnabled();
  });

  it("focuses Cancel and restores the delete control after Escape", () => {
    setup(locale);
    const invoking = screen.getByRole("button", { name: remove });
    fireEvent.click(invoking);
    expect(screen.getByRole("button", { name: cancel })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(invoking).toHaveFocus();
  });
});

it("preserves destructive-button focus across controller refreshes", () => {
  const controller = setup();
  fireEvent.click(screen.getByRole("button", { name: "Delete Server off" }));
  const destructive = screen.getByRole("button", { name: "Delete" });
  destructive.focus();
  act(() => controller.updateView(catalog(rows)));
  expect(destructive).toHaveFocus();
});

it("refuses a busy delete and restores the nearest surviving list context", () => {
  const controller = setup();
  const invoking = screen.getByRole("button", { name: "Delete Server off" });
  const add = screen.getByRole("button", { name: "Add server" });
  fireEvent.click(invoking);
  act(() => controller.connectServer("off"));
  const destructive = screen.getByRole("button", { name: "Delete" });
  expect(destructive).toBeDisabled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("alertdialog")).toBeVisible();

  act(() => controller.receiveOperation({
    kind: "mcpOperation",
    requestId: "request",
    result: {
      ok: false,
      error: { code: "mcp-rejected", message: "connect refused" },
    },
  }));
  expect(destructive).toBeEnabled();
  fireEvent.click(destructive);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(add).toHaveFocus();
  act(() => controller.receiveOperation({
    kind: "mcpOperation",
    requestId: "request",
    result: { ok: true },
  }));
  expect(invoking).not.toBeInTheDocument();
  expect(add).toHaveFocus();
});

it("keeps the confirmation open when the controller refuses execution", () => {
  const controller = setup();
  fireEvent.click(screen.getByRole("button", { name: "Delete Server off" }));
  vi.spyOn(controller, "runConfirmed").mockReturnValue(false);
  const destructive = screen.getByRole("button", { name: "Delete" });
  fireEvent.click(destructive);
  expect(screen.getByRole("alertdialog")).toBeVisible();
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
});

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
  oauth: {
    kind: "manual" as const,
    reason: "no-callback-origin" as const,
    discovery: "available" as const,
    authorization: "unavailable" as const,
  },
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
  ["en", "Add server", "Enabled"],
  ["zh", "添加服务器", "已启用"],
] as const)("McpServerList locale %s", (locale, add, enabled) => {
  it("renders plugin-style summary cards with one immediate enable switch", () => {
    const controller = setup(locale);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText(/attempt 2|第 2 次/)).toBeVisible();
    expect(screen.getAllByText(/3 tools|3 个工具/).length).toBeGreaterThan(0);
    expect(screen.getByText(locale === "en" ? /500 ms/ : /500 毫秒/)).toBeVisible();
    expect(screen.getByText(/plugin failure/)).toBeVisible();
    expect(screen.getByRole("listitem", { name: "Server connected" }))
      .toHaveAttribute("aria-current", "true");
    const row = screen.getByRole("listitem", { name: "Server off" });
    expect(within(row).getByRole("switch", { name: enabled })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(row).queryByRole("button", { name: /Connect|Edit|Delete|连接|编辑|删除/ }))
      .toBeNull();

    fireEvent.click(within(row).getByRole("button", {
      name: /Server off.*Standard input\/output|Server off.*标准输入\/输出/,
    }));
    expect(controller.snapshot().selectedServerId).toBe("off");
  });

  it("shows an actionable empty state", () => {
    setup(locale, []);
    const empty = screen.getByRole("status");
    expect(within(empty).getByRole("button", { name: add })).toBeEnabled();
  });

  it("disables Add and row switches during a save", () => {
    const controller = setup(locale);
    act(() => {
      controller.openEdit("connected");
      controller.saveEditor();
    });
    expect(screen.getByRole("button", { name: add })).toBeDisabled();
    expect(screen.getAllByRole("switch").every((control) =>
      control.hasAttribute("disabled"))).toBe(true);
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { McpLogView } from "./McpLogView.js";

afterEach(cleanup);

describe.each([
  ["en", ["Info", "Warning", "Error"]],
  ["zh", ["信息", "警告", "错误"]],
] as const)("McpLogView locale %s", (locale, levels) => {
  it("renders incremental log rows in a polite bounded region", () => {
    render(
      <McpLogView
        locale={locale}
        entries={[
          { at: "one", level: "info", message: "started" },
          { at: "two", level: "warn", message: "slow", detail: "detail" },
          { at: "three", level: "error", message: "failed" },
        ]}
      />,
    );
    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-live", "polite");
    expect(log).toHaveClass("dsh-mcp-log");
    for (const level of levels) expect(log).toHaveTextContent(level);
    expect(log).toHaveTextContent("started");
    expect(log).toHaveTextContent("detail");
    expect(log.querySelectorAll(".dsh-mcp-log-row")).toHaveLength(3);
  });
});

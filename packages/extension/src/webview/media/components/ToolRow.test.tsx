// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineRow } from "../store.js";
import { ToolRow } from "./ToolRow.js";

type ToolTimelineRow = Extract<TimelineRow, { kind: "tool" }>;

const baseRow: ToolTimelineRow = {
  kind: "tool",
  seq: 1,
  callId: "call-1",
  name: "read",
  argsRaw: "{\"path\":\"/src/a.ts\"}",
  status: "ok",
  resultText: "fallback result",
  diffs: [],
};

afterEach(cleanup);

describe("ToolRow", () => {
  it.each(["running", "ok", "error", "stopped"] as const)(
    "shows its title, summary, and %s status while collapsed",
    (status) => {
      render(<ToolRow row={{ ...baseRow, status }} />);

      expect(screen.getByRole("button", { name: "read" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(screen.getByText("/src/a.ts")).toBeVisible();
      expect(screen.getByText(status)).toBeVisible();
      expect(screen.queryByText("fallback result")).toBeNull();
    },
  );

  it("shows malformed raw arguments and falls back to result text when expanded", () => {
    render(<ToolRow row={{ ...baseRow, argsRaw: "{broken" }} />);
    fireEvent.click(screen.getByRole("button", { name: "read" }));

    expect(screen.getByText("{broken")).toBeVisible();
    expect(screen.getByText("fallback result")).toBeVisible();
  });

  it("prefers terminal presenter output to result text", () => {
    render(
      <ToolRow
        row={{
          ...baseRow,
          callView: {
            card: "terminal",
            title: "pnpm test",
            description: "Run tests",
          },
          resultView: {
            card: "terminal",
            output: "Tests passed\n",
            exitCode: 0,
          },
        }}
      />,
    );

    expect(screen.getByText("Run tests")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "pnpm test" }));
    expect(screen.getByText(/Tests passed/)).toBeVisible();
    expect(screen.queryByText("fallback result")).toBeNull();
  });

  it("renders generic presenter content when available", () => {
    render(
      <ToolRow
        row={{
          ...baseRow,
          resultView: {
            card: "generic",
            content: ["plain", { count: 2 }],
          },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "read" }));

    expect(screen.getByText(/plain/)).toBeVisible();
    expect(screen.getByText(/"count": 2/)).toBeVisible();
    expect(screen.queryByText("fallback result")).toBeNull();
  });

  it("keeps row-local diffs hidden until expanded", () => {
    render(
      <ToolRow
        row={{
          ...baseRow,
          diffs: [{ path: "/src/a.ts", oldText: "old", newText: "new" }],
        }}
      />,
    );

    expect(screen.queryByText("old")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "read" }));
    expect(screen.getByText("/src/a.ts")).toBeVisible();
    expect(screen.getByText("old")).toBeVisible();
    expect(screen.getByText("new")).toBeVisible();
  });
});

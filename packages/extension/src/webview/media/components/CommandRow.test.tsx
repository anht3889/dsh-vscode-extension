// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineRow } from "../store.js";
import { CommandRow } from "./CommandRow.js";

type CommandTimelineRow = Extract<TimelineRow, { kind: "command" }>;

const row: CommandTimelineRow = {
  kind: "command",
  seq: 1,
  commandId: "command-1",
  name: "goal",
  args: " write tests",
  status: "success",
  output: "Goal saved",
};

afterEach(cleanup);

describe("CommandRow", () => {
  it("shows the invocation, accessible label, and status while collapsed", () => {
    render(<CommandRow row={row} />);

    const button = screen.getByRole("button", { name: "Command" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button.querySelector(".dsh-row-title")).toHaveTextContent(
      "/goal write tests",
      { normalizeWhitespace: false },
    );
    expect(screen.getByText("success")).toBeVisible();
    expect(screen.queryByText("Goal saved")).toBeNull();
  });

  it("reveals command output when expanded", () => {
    render(<CommandRow row={row} />);
    fireEvent.click(screen.getByRole("button", { name: "Command" }));

    expect(screen.getByText("Goal saved")).toBeVisible();
  });

  it.each(["running", "success", "error"] as const)(
    "renders the %s status",
    (status) => {
      render(<CommandRow row={{ ...row, status }} />);
      expect(screen.getByText(status)).toBeVisible();
    },
  );

  it("omits spacing when command arguments are absent", () => {
    render(<CommandRow row={{ ...row, args: null }} />);
    expect(screen.getByRole("button", { name: "Command" })).toHaveTextContent(
      "/goal",
    );
    expect(screen.getByRole("button", { name: "Command" })).not.toHaveTextContent(
      "/goal ",
    );
  });
});

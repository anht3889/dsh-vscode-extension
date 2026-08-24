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

    const button = screen.getByRole("button", {
      name: "/goal write tests success",
    });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button.querySelector(".dsh-row-title")).toHaveTextContent(
      "/goal write tests",
      { normalizeWhitespace: false },
    );
    expect(
      screen.getByLabelText("Command", { selector: "article" }),
    ).toContainElement(button);
    expect(screen.getByText("success")).toBeVisible();
    expect(screen.queryByText("Goal saved")).toBeNull();
  });

  it("reveals command output through the region the toggle controls", () => {
    render(<CommandRow row={row} />);
    const button = screen.getByRole("button", { name: /\/goal/ });
    const output = document.getElementById(
      button.getAttribute("aria-controls") ?? "",
    );
    expect(output).not.toBeNull();
    expect(output).not.toBeVisible();

    fireEvent.click(button);
    expect(output).toBeVisible();
    expect(output).toHaveTextContent("Goal saved");
  });

  it("keeps the output region hidden for a command that produced none", () => {
    render(<CommandRow row={{ ...row, output: undefined }} />);
    const button = screen.getByRole("button", { name: /\/goal/ });
    fireEvent.click(button);

    expect(
      document.getElementById(button.getAttribute("aria-controls") ?? ""),
    ).not.toBeVisible();
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
    const title = screen
      .getByLabelText("Command", { selector: "article" })
      .querySelector(".dsh-row-title");
    expect(title).toHaveTextContent("/goal", { normalizeWhitespace: false });
    expect(title).not.toHaveTextContent("/goal ", {
      normalizeWhitespace: false,
    });
  });
});

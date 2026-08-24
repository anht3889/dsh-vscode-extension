// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { firstLine, latestLine, ThinkingRow } from "./ThinkingRow.js";

afterEach(cleanup);

describe("ThinkingRow", () => {
  it("starts a running row expanded with its full text", () => {
    render(<ThinkingRow text={"first thought\nlatest thought"} running />);

    const button = screen.getByRole("button", { name: "Think" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    const reasoning = screen.getByText(/first thought\s+latest thought/);
    expect(reasoning).toBeVisible();
    expect(button.getAttribute("aria-controls")).toBe(reasoning.id);
  });

  it("collapses a completed row on first mount to its first line", () => {
    render(<ThinkingRow text={"first thought\nlatest thought"} running={false} />);

    expect(screen.getByRole("button", { name: "Think" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByText("first thought")).toBeVisible();
    expect(screen.queryByText("latest thought")).toBeNull();
  });

  it("collapses only on a running-to-complete transition and can be reopened", () => {
    const { rerender } = render(
      <ThinkingRow text={"first thought\nlatest thought"} running />,
    );

    rerender(
      <ThinkingRow text={"first thought\nlatest thought"} running={false} />,
    );
    const button = screen.getByRole("button", { name: "Think" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("first thought")).toBeVisible();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/first thought\s+latest thought/)).toBeVisible();

    rerender(
      <ThinkingRow text={"first thought\nlatest thought"} running={false} />,
    );
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("summarizes a manually collapsed running row with its latest line", () => {
    render(<ThinkingRow text={"first thought\nlatest thought"} running />);
    fireEvent.click(screen.getByRole("button", { name: "Think" }));

    expect(screen.getByText("latest thought")).toBeVisible();
    expect(screen.queryByText("first thought")).toBeNull();
  });
});

describe("thinking line summaries", () => {
  it("selects the first and latest non-empty lines", () => {
    expect(firstLine("\nfirst\nlatest\n")).toBe("first");
    expect(latestLine("\nfirst\nlatest\n")).toBe("latest");
  });
});

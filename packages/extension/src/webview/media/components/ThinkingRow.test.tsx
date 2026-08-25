// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ThinkingRow } from "./ThinkingRow.js";

afterEach(cleanup);

describe("ThinkingRow", () => {
  it("starts an active group expanded as Thinking with its full text", () => {
    render(<ThinkingRow text={"first thought\n\nlatest thought"} active />);

    const button = screen.getByRole("button", { name: "Thinking" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    const reasoning = screen.getByText(/first thought/);
    expect(reasoning).toHaveTextContent("latest thought");
    expect(reasoning).toBeVisible();
    expect(button.getAttribute("aria-controls")).toBe(reasoning.id);
    expect(screen.getByLabelText("Thinking", { selector: "article" })).toBeVisible();
  });

  it("mounts a finished group collapsed as Thought with reasoning hidden", () => {
    render(
      <ThinkingRow text={"first thought\n\nlatest thought"} active={false} />,
    );

    expect(screen.getByRole("button", { name: "Thought" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("first thought")).toBeNull();
    expect(screen.queryByText("latest thought")).toBeNull();
  });

  it("collapses only on an active-to-finished transition and can be reopened", () => {
    const { rerender } = render(
      <ThinkingRow text={"first thought\n\nlatest thought"} active />,
    );

    rerender(
      <ThinkingRow text={"first thought\n\nlatest thought"} active={false} />,
    );
    const button = screen.getByRole("button", { name: "Thought" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("first thought")).toBeNull();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/first thought/)).toHaveTextContent("latest thought");

    rerender(
      <ThinkingRow text={"first thought\n\nlatest thought"} active={false} />,
    );
    expect(button).toHaveAttribute("aria-expanded", "true");
  });
});

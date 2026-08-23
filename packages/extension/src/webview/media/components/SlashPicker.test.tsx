// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SlashMenuItem } from "@dsh-vscode/contract";
import type { SlashPickerState } from "../store.js";
import { SlashPicker } from "./SlashPicker.js";

const command: SlashMenuItem = {
  source: "command",
  name: "help",
  description: "Show available commands",
  behavior: "execute",
};

const skill: SlashMenuItem = {
  source: "skill",
  name: "brainstorming",
  description: "Explore requirements",
  behavior: "insert",
};

function picker(
  overrides: Partial<SlashPickerState> = {},
): SlashPickerState {
  return {
    kind: "slash",
    token: { start: 0, end: 1, query: "", position: "leading" },
    requestId: "slash-1",
    catalog: [command, skill],
    groups: [
      { source: "command", items: [command] },
      { source: "skill", items: [skill] },
    ],
    availability: { commands: true, skills: true },
    highlightedKey: "command:help",
    ...overrides,
  };
}

afterEach(cleanup);

describe("SlashPicker", () => {
  it("renders headings only for groups with rows", () => {
    render(
      <SlashPicker
        picker={picker({
          groups: [
            { source: "command", items: [command] },
            { source: "skill", items: [] },
          ],
        })}
        onPick={vi.fn()}
      />,
    );

    expect(screen.getByText("Commands")).toBeInTheDocument();
    expect(screen.queryByText("Skills")).not.toBeInTheDocument();
  });

  it("marks the highlighted row with a stable option id", () => {
    render(<SlashPicker picker={picker()} onPick={vi.fn()} />);

    expect(screen.getByRole("option", { name: /\/help/ })).toHaveAttribute(
      "id",
      "dsh-slash-option-command-help",
    );
    expect(screen.getByRole("option", { name: /\/help/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("option", { name: /\/brainstorming/ }),
    ).toHaveAttribute("aria-selected", "false");
  });

  it("picks on mousedown without moving textarea focus", () => {
    const onPick = vi.fn();
    render(<SlashPicker picker={picker()} onPick={onPick} />);
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });

    screen.getByRole("option", { name: /\/help/ }).dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onPick).toHaveBeenCalledWith(command);
  });

  it("shows an unavailable-source diagnostic beside rows from the other source", () => {
    render(
      <SlashPicker
        picker={picker({
          groups: [{ source: "skill", items: [skill] }],
          availability: { commands: false, skills: true },
        })}
        onPick={vi.fn()}
      />,
    );

    expect(screen.getByText("Commands unavailable")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /\/brainstorming/ })).toBeVisible();
  });

  it("owns options through labelled groups and keeps diagnostics outside the listbox", () => {
    render(
      <SlashPicker
        picker={picker({
          groups: [{ source: "skill", items: [skill] }],
          availability: { commands: false, skills: true },
        })}
        onPick={vi.fn()}
      />,
    );

    const listbox = screen.getByRole("listbox");
    const skills = screen.getByRole("group", { name: "Skills" });
    const diagnostic = screen.getByText("Commands unavailable");
    expect(listbox).toHaveAttribute("id", "dsh-slash-listbox");
    expect(listbox).toContainElement(skills);
    expect(skills).toContainElement(
      screen.getByRole("option", { name: /\/brainstorming/ }),
    );
    expect(listbox.contains(diagnostic)).toBe(false);
    expect(screen.queryByRole("group", { name: "Commands" })).toBeNull();
  });

  it.each([
    {
      name: "empty",
      state: picker({
        catalog: [],
        groups: [],
        availability: { commands: true, skills: true },
        highlightedKey: undefined,
      }),
    },
    {
      name: "unavailable",
      state: picker({
        catalog: [],
        groups: [],
        availability: { commands: false, skills: false },
        highlightedKey: undefined,
      }),
    },
  ])("renders no selectable rows when both sources are $name", ({ state }) => {
    render(<SlashPicker picker={state} onPick={vi.fn()} />);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});

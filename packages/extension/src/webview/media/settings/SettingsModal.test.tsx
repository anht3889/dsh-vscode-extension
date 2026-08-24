// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Header } from "../components/Header.js";
import { SettingsModal } from "./SettingsModal.js";
import { en } from "./localization/en.js";
import { zh } from "./localization/zh.js";
import { initialSettingsState } from "./reducer.js";

afterEach(cleanup);

describe("SettingsModal", () => {
  it("renders labelled modal chrome and active navigation", () => {
    const onSection = vi.fn();
    render(
      <SettingsModal
        state={{ ...initialSettingsState, open: true }}
        onSection={onSection}
        onRequestClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Settings" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Close settings" })).toHaveFocus();
    expect(screen.getByRole("navigation", { name: "Settings sections" })).toHaveClass(
      "dsh-settings-nav-responsive",
    );
    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    expect(onSection).toHaveBeenCalledWith("models");
  });

  it("renders optional navigation only for announced capabilities", () => {
    const props = {
      onSection: vi.fn(),
      onRequestClose: vi.fn(),
    };
    const { rerender } = render(
      <SettingsModal
        {...props}
        state={{ ...initialSettingsState, open: true }}
      />,
    );

    expect(screen.queryByRole("button", { name: "MCP" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Web Search" }),
    ).not.toBeInTheDocument();

    rerender(
      <SettingsModal
        {...props}
        state={{
          ...initialSettingsState,
          open: true,
          capabilities: ["mcp", "web-search"],
          capabilitiesKnown: true,
        }}
      />,
    );
    const navigation = screen.getByRole("navigation", {
      name: "Settings sections",
    });
    expect(
      within(navigation).getAllByRole("button").map((button) => button.textContent),
    ).toEqual([
      "⚙General",
      "◫Models",
      "◇Plugins",
      "⇄MCP",
      "⌕Web Search",
      "◎Agent Presets",
      "▣Extension",
    ]);
  });

  it("requests close for Escape and the mask but not panel pointer events", () => {
    const onRequestClose = vi.fn();
    render(
      <SettingsModal
        state={{ ...initialSettingsState, open: true }}
        onSection={vi.fn()}
        onRequestClose={onRequestClose}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onRequestClose).toHaveBeenCalledWith("escape", false);

    fireEvent.pointerDown(screen.getByTestId("settings-mask"));
    expect(onRequestClose).toHaveBeenCalledWith("mask", false);

    fireEvent.pointerDown(screen.getByRole("dialog"));
    expect(onRequestClose).toHaveBeenCalledTimes(2);
  });

  it("exposes the dirty-close controller seam without bypassing it", () => {
    const onRequestClose = vi.fn();
    render(
      <SettingsModal
        state={{ ...initialSettingsState, open: true }}
        controller={{ dirty: true }}
        onSection={vi.fn()}
        onRequestClose={onRequestClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(onRequestClose).toHaveBeenCalledWith("button", true);
  });

  it("blocks every dismissal path while a confirmation is active", () => {
    const onRequestClose = vi.fn();
    const onCancelClose = vi.fn();
    const onDiscardClose = vi.fn();
    render(
      <SettingsModal
        state={{
          ...initialSettingsState,
          open: true,
          confirmation: { kind: "dirty-close" },
        }}
        onSection={vi.fn()}
        onRequestClose={onRequestClose}
        onCancelClose={onCancelClose}
        onDiscardClose={onDiscardClose}
      />,
    );

    fireEvent.pointerDown(screen.getByTestId("settings-mask"));
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));

    expect(onRequestClose).not.toHaveBeenCalled();
    const confirmation = screen.getByRole("alertdialog", {
      name: "Discard unsaved settings?",
    });
    expect(within(confirmation).getByText(
      "Your unsaved changes will be lost.",
    )).toBeVisible();
    expect(within(confirmation).getByRole("button", {
      name: "Cancel",
    })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancelClose).toHaveBeenCalledOnce();
    fireEvent.click(within(confirmation).getByRole("button", {
      name: "Cancel",
    }));
    expect(onCancelClose).toHaveBeenCalledTimes(2);
    expect(onDiscardClose).not.toHaveBeenCalled();

    fireEvent.click(within(confirmation).getByRole("button", {
      name: "Discard",
    }));
    expect(onDiscardClose).toHaveBeenCalledOnce();
  });

  it("traps dirty-close focus and blocks pointer events behind the confirmation", () => {
    const onRequestClose = vi.fn();
    render(
      <SettingsModal
        state={{
          ...initialSettingsState,
          open: true,
          confirmation: { kind: "dirty-close" },
        }}
        onSection={vi.fn()}
        onRequestClose={onRequestClose}
      >
        <button type="button">Behind</button>
      </SettingsModal>,
    );

    const confirmation = screen.getByRole("alertdialog", {
      name: "Discard unsaved settings?",
    });
    const cancel = within(confirmation).getByRole("button", { name: "Cancel" });
    const discard = within(confirmation).getByRole("button", { name: "Discard" });
    expect(screen.getByTestId("settings-confirmation-scrim")).toBeInTheDocument();
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(discard).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(cancel).toHaveFocus();

    fireEvent.pointerDown(screen.getByTestId("settings-confirmation-scrim"));
    fireEvent.click(screen.getByRole("button", { name: "Behind" }));
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("blocks parent dismissal while a section confirmation is active", () => {
    const onRequestClose = vi.fn();
    render(
      <SettingsModal
        state={{ ...initialSettingsState, open: true }}
        controller={{ dirty: false, confirmation: true }}
        onSection={vi.fn()}
        onRequestClose={onRequestClose}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(screen.getByTestId("settings-mask"));
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("restores gear focus when the modal unmounts", () => {
    const gearRef = createRef<HTMLButtonElement>();
    const { rerender } = render(
      <>
        <button ref={gearRef}>Gear</button>
        <SettingsModal
          state={{ ...initialSettingsState, open: true }}
          returnFocusRef={gearRef}
          onSection={vi.fn()}
          onRequestClose={vi.fn()}
        />
      </>,
    );

    rerender(<button ref={gearRef}>Gear</button>);
    expect(screen.getByRole("button", { name: "Gear" })).toHaveFocus();
  });

  it("traps Tab focus within the dialog", () => {
    render(
      <SettingsModal
        state={{ ...initialSettingsState, open: true }}
        onSection={vi.fn()}
        onRequestClose={vi.fn()}
      />,
    );
    const close = screen.getByRole("button", { name: "Close settings" });
    const last = screen.getByRole("button", { name: "Extension" });

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("recomputes focusable controls and skips disabled or hidden entries", () => {
    const props = {
      state: { ...initialSettingsState, open: true },
      onSection: vi.fn(),
      onRequestClose: vi.fn(),
    };
    const { rerender } = render(<SettingsModal {...props} />);

    rerender(
      <SettingsModal {...props}>
        <button type="button" data-testid="dynamic-control">Dynamic</button>
        <button type="button" disabled>Disabled</button>
        <button type="button" hidden>Hidden</button>
        <span aria-hidden="true">
          <button type="button">Aria hidden</button>
        </span>
        <span style={{ display: "none" }}>
          <button type="button">CSS hidden</button>
        </span>
      </SettingsModal>,
    );

    const close = screen.getByRole("button", { name: "Close settings" });
    const dynamic = screen.getByTestId("dynamic-control");
    dynamic.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(dynamic).toHaveFocus();
  });

});

describe("settings shell integration", () => {
  it("gives the enabled gear dialog semantics", () => {
    const settingsRef = createRef<HTMLButtonElement>();
    render(
      <Header
        busy={false}
        recentOpen={false}
        settingsOpen
        settingsButtonRef={settingsRef}
        onRecent={vi.fn()}
        onCloseRecent={vi.fn()}
        onSettings={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );

    const gear = screen.getByRole("button", { name: "Settings" });
    expect(gear).toBeEnabled();
    expect(gear).toHaveAttribute("aria-haspopup", "dialog");
    expect(gear).toHaveAttribute("aria-expanded", "true");
    expect(settingsRef.current).toBe(gear);
  });

  it("keeps English and Chinese dictionaries complete and non-empty", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    expect(Object.values(en).every((value) => value.trim() !== "")).toBe(true);
    expect(Object.values(zh).every((value) => value.trim() !== "")).toBe(true);
  });
});

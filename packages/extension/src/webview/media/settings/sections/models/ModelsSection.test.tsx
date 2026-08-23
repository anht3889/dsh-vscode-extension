// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelsSettingsView } from "@dsh-vscode/contract";
import { ModelsController } from "./ModelsController.js";
import { ModelsSection } from "./ModelsSection.js";

afterEach(cleanup);

const view: ModelsSettingsView = {
  section: "models",
  namespaces: [{
    namespace: "llm-pi-ai",
    revision: 1,
    applies: "live",
    writable: true,
    base: { providers: {} },
    user: {},
    value: { providers: { pinned: {} } },
    secrets: [],
  }],
  providers: [{
    id: "openai",
    namespace: "llm-pi-ai",
    label: "OpenAI",
    active: false,
    declared: false,
    catalog: { kind: "dormant" },
    credentialStatus: { kind: "none" },
    models: [],
    removable: false,
    fields: [{
      path: ["providers", "openai", "baseURL"],
      label: "Base URL",
      kind: "string",
    }, {
      path: ["providers", "openai", "api"],
      label: "API",
      kind: "union",
      options: [
        { value: "openai-completions", label: "OpenAI Completions" },
        { value: "anthropic-messages", label: "Anthropic Messages" },
      ],
    }],
  }, {
    id: "pinned",
    namespace: "llm-pi-ai",
    label: "Pinned",
    active: true,
    declared: true,
    catalog: { kind: "ready" },
    credentialStatus: { kind: "none" },
    models: [],
    removable: false,
    fields: [],
  }],
  credentials: [],
};

describe("ModelsSection", () => {
  it("lists configured rows and keeps directory, custom, and edit mutually exclusive", () => {
    const controller = new ModelsController(vi.fn(), vi.fn());
    controller.updateView(view);
    render(
      <ModelsSection
        controller={controller}
        view={view}
        locale="en"
        onCredential={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Dormant · Catalog dormant/)).toBeNull();
    expect(screen.getByText("Pinned")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
    expect(
      screen.getByRole<HTMLSelectElement>("combobox", { name: "Provider" }).value,
    ).toBe("openai");
    expect(screen.getAllByRole("button", { name: "Apply" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Add a custom provider" }));
    expect(screen.queryByRole("combobox", { name: "Provider" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Custom provider" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Edit Pinned/ }));
    expect(screen.queryByRole("heading", { name: "Custom provider" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Apply" })).toHaveLength(1);
  });

  it("does not expose delete for a composition-owned declared route", () => {
    const controller = new ModelsController(vi.fn(), vi.fn());
    controller.updateView(view);
    render(
      <ModelsSection
        controller={controller}
        view={view}
        locale="zh"
        onCredential={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /删除 Pinned/ })).toBeNull();
    expect(screen.queryByText(/休眠 · 目录休眠/)).toBeNull();
  });

  it("labels delete confirmation, focuses Cancel, and returns focus on dismissal", async () => {
    const removableView: ModelsSettingsView = {
      ...view,
      providers: view.providers.map((provider) =>
        provider.id === "pinned"
          ? { ...provider, removable: true }
          : provider),
    };
    const controller = new ModelsController(vi.fn(), vi.fn());
    controller.updateView(removableView);
    render(
      <ModelsSection
        controller={controller}
        view={removableView}
        locale="en"
        onCredential={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "Delete Pinned",
    });
    fireEvent.click(trigger);

    expect(
      screen.getByRole("alertdialog", { name: "Delete provider?" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("traps delete confirmation focus and reports ownership while the scrim is active", async () => {
    const removableView: ModelsSettingsView = {
      ...view,
      providers: view.providers.map((provider) =>
        provider.id === "pinned"
          ? { ...provider, removable: true }
          : provider),
    };
    const onConfirmationChange = vi.fn();
    const controller = new ModelsController(vi.fn(), vi.fn());
    controller.updateView(removableView);
    render(
      <ModelsSection
        controller={controller}
        view={removableView}
        locale="en"
        onCredential={vi.fn()}
        onConfirmationChange={onConfirmationChange}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Delete Pinned" });
    fireEvent.click(trigger);

    expect(onConfirmationChange).toHaveBeenCalledWith(true);
    const dialog = screen.getByRole("alertdialog", { name: "Delete provider?" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const remove = within(dialog).getByRole("button", { name: "Delete" });
    expect(screen.getByTestId("settings-confirmation-scrim")).toBeInTheDocument();
    await waitFor(() => expect(cancel).toHaveFocus());
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(remove).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.click(cancel);
    expect(onConfirmationChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByTestId("settings-confirmation-scrim")).toBeNull();
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginsSettingsView } from "@dsh-vscode/contract";
import { PluginsController } from "./PluginsController.js";
import { PluginsSection } from "./PluginsSection.js";

afterEach(cleanup);

function view(): PluginsSettingsView {
  return {
    section: "plugins",
    namespaces: [{
      namespace: "shell",
      revision: 1,
      applies: "live",
      writable: true,
      base: { timeoutMs: 10_000, maxOutputBytes: 1_000_000 },
      user: { timeoutMs: 20_000 },
      value: { timeoutMs: 20_000, maxOutputBytes: 1_000_000 },
      secrets: [],
    }, {
      namespace: "web-search-deepseek",
      revision: 2,
      applies: "restart",
      writable: true,
      base: { baseURL: "", maxUses: 5 },
      user: {},
      value: { baseURL: "", maxUses: 5 },
      secrets: [],
    }],
    configurable: [{
      namespace: "shell",
      label: "Shell",
      fields: [{
        path: ["timeoutMs"],
        label: "Timeout (ms)",
        kind: "number",
      }, {
        path: ["maxOutputBytes"],
        label: "Maximum output bytes",
        kind: "number",
      }],
    }, {
      namespace: "web-search-deepseek",
      label: "Web Search",
      fields: [{
        path: ["baseURL"],
        label: "Base URL",
        kind: "string",
      }, {
        path: ["maxUses"],
        label: "Maximum uses",
        kind: "number",
        min: 1,
        step: 1,
      }],
      credential: {
        ref: "DEEPSEEK_API_KEY",
        set: true,
        source: "env",
        writable: true,
      },
      credentialStatus: { kind: "ready" },
    }],
    inventory: [{
      entryId: "shell",
      moduleName: "@deepseek-ai/dsh-shell",
      enabled: true,
      fiberPhase: "active",
    }, {
      entryId: "disabled-row",
      moduleName: "@deepseek-ai/dsh-disabled",
      enabled: false,
      fiberPhase: null,
    }],
  };
}

function setup(
  sectionView = view(),
  onCredential = vi.fn(),
): {
  controller: PluginsController;
  onCredential: ReturnType<typeof vi.fn>;
} {
  let next = 0;
  const controller = new PluginsController(
    vi.fn(),
    vi.fn(),
    () => `credential-${++next}`,
  );
  controller.updateView(sectionView);
  render(
    <PluginsSection
      controller={controller}
      view={sectionView}
      locale="en"
      onCredential={onCredential}
    />,
  );
  return { controller, onCredential };
}

describe("PluginsSection", () => {
  it("implements automatic Configurable/All tabs with associated panels", () => {
    setup();
    const tabs = screen.getAllByRole("tab");
    const configurable = screen.getByRole("tab", { name: "Configurable" });
    const all = screen.getByRole("tab", { name: "All" });

    expect(screen.getByRole("tablist", { name: "Plugins" })).toBeVisible();
    expect(configurable).toHaveAttribute("aria-selected", "true");
    expect(configurable).toHaveAttribute("tabindex", "0");
    expect(all).toHaveAttribute("tabindex", "-1");
    const panel = screen.getByRole("tabpanel");
    expect(configurable).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", configurable.id);

    configurable.focus();
    fireEvent.keyDown(configurable, { key: "ArrowRight" });
    expect(all).toHaveFocus();
    expect(all).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Plugin inventory" })).toBeVisible();
    fireEvent.keyDown(all, { key: "ArrowRight" });
    expect(tabs[0]).toHaveFocus();
    fireEvent.keyDown(configurable, { key: "End" });
    expect(all).toHaveFocus();
    fireEvent.keyDown(all, { key: "Home" });
    expect(configurable).toHaveFocus();
    fireEvent.keyDown(configurable, { key: "ArrowLeft" });
    expect(all).toHaveFocus();
  });

  it("renders exact configurable fields, overrides, applies badges, and card actions", () => {
    const { controller } = setup();

    expect(screen.getByLabelText("Timeout (ms)")).toHaveValue(20_000);
    expect(screen.getByLabelText("Maximum output bytes")).toHaveValue(1_000_000);
    expect(screen.getByText("Overridden")).toBeVisible();
    expect(screen.getByText("Applies immediately")).toBeVisible();
    expect(screen.getByText("Requires restart")).toBeVisible();
    expect(screen.getByLabelText("Plugin namespace: shell")).toHaveTextContent(
      "shell",
    );

    fireEvent.change(screen.getByLabelText("Timeout (ms)"), {
      target: { value: "30000" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Discard" })[0]!);
    expect(screen.getByLabelText("Timeout (ms)")).toHaveValue(20_000);
    fireEvent.click(screen.getAllByRole("button", {
      name: "Reset Timeout (ms)",
    })[0]!);
    expect(controller.card("shell")?.fields.timeoutMs).toMatchObject({
      text: "10000",
      overridden: false,
    });
  });

  it("renders only four inventory fields and no fabricated description", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: "All" }));

    expect(screen.getByText("@deepseek-ai/dsh-shell")).toBeVisible();
    expect(screen.getByText("shell")).toBeVisible();
    expect(screen.getByText("Enabled")).toBeVisible();
    expect(screen.getByText(/Runtime phase:\s+active/)).toBeVisible();
    expect(screen.getByText("Disabled")).toBeVisible();
    expect(screen.getByText(/Runtime phase:\s+Unavailable/)).toBeVisible();
    expect(screen.queryByText(/description/i)).toBeNull();
  });

  it("renders localized empty configurable state", () => {
    const empty = view();
    empty.namespaces = [];
    empty.configurable = [];
    const controller = new PluginsController(vi.fn(), vi.fn());
    controller.updateView(empty);
    render(
      <PluginsSection
        controller={controller}
        view={empty}
        locale="zh"
        onCredential={vi.fn()}
      />,
    );

    expect(screen.getByText("没有可配置的插件。")).toBeVisible();
  });

  it("keeps secret component-local, clears it after apply, and posts after settings", async () => {
    const onCredential = vi.fn();
    const { controller } = setup(view(), onCredential);
    const secret = screen.getByLabelText("API key");
    fireEvent.change(secret, { target: { value: "super-secret" } });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://search.example/v1" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]!);

    expect(secret).toHaveValue("");
    expect(JSON.stringify(controller.snapshot())).not.toContain("super-secret");
    controller.receive({
      kind: "settingsMutation",
      requestId: "credential-1",
      result: {
        ok: true,
        namespace: {
          ...view().namespaces[1]!,
          revision: 3,
          user: { baseURL: "https://search.example/v1" },
          value: { baseURL: "https://search.example/v1", maxUses: 5 },
        },
      },
    });

    await waitFor(() => expect(onCredential).toHaveBeenCalledWith({
      kind: "setCredential",
      requestId: "credential-2",
      ref: "DEEPSEEK_API_KEY",
      value: "super-secret",
    }));
    expect(JSON.stringify(controller.snapshot())).not.toContain("super-secret");
  });

  it("saves a writable credential while Web Search settings are read-only", async () => {
    const readOnly = view();
    readOnly.namespaces[1] = { ...readOnly.namespaces[1]!, writable: false };
    const onCredential = vi.fn();
    setup(readOnly, onCredential);
    const secret = screen.getByLabelText("API key");
    fireEvent.change(secret, { target: { value: "credential-only-secret" } });
    const save = screen.getAllByRole("button", { name: "Save" })[1]!;

    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(onCredential).toHaveBeenCalledWith({
      kind: "setCredential",
      requestId: "credential-1",
      ref: "DEEPSEEK_API_KEY",
      value: "credential-only-secret",
    }));
    expect(secret).toHaveValue("");
  });

  it("saves credential removal independently from read-only settings", async () => {
    const readOnly = view();
    readOnly.namespaces[1] = { ...readOnly.namespaces[1]!, writable: false };
    const onCredential = vi.fn();
    setup(readOnly, onCredential);
    fireEvent.click(screen.getByLabelText("Remove configured credential"));
    const save = screen.getAllByRole("button", { name: "Save" })[1]!;

    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(onCredential).toHaveBeenCalledWith({
      kind: "unsetCredential",
      requestId: "credential-1",
      ref: "DEEPSEEK_API_KEY",
    }));
  });

  it("explains mixed read-only edits and enables credential-only after discard", () => {
    const sectionView = view();
    const { controller } = setup(sectionView);
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://search.example/v1" },
    });
    const readOnly = view();
    readOnly.namespaces[1] = { ...readOnly.namespaces[1]!, writable: false };
    controller.updateView(readOnly);
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "credential-only-secret" },
    });
    const save = screen.getAllByRole("button", { name: "Save" })[1]!;

    expect(save).toBeDisabled();
    expect(screen.getByText(
      "Discard read-only settings edits to save the credential separately.",
    )).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "Discard" })[1]!);
    expect(save).toBeEnabled();
  });

  it("clears a secret bridge on disconnect and requires re-entry", async () => {
    const onCredential = vi.fn();
    const { controller } = setup(view(), onCredential);
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "super-secret" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://search.example/v1" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]!);
    controller.disconnect();
    controller.updateView(view());
    controller.receive({
      kind: "settingsMutation",
      requestId: "credential-1",
      result: { ok: true, namespace: view().namespaces[1] },
    });

    await waitFor(() => expect(onCredential).not.toHaveBeenCalled());
    expect(screen.getByLabelText("API key")).toHaveValue("");
  });
});

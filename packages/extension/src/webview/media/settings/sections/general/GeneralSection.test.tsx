// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GeneralSettingsView,
  MutateSettingsCommand,
  SettingsMutationMessage,
  SettingsNamespaceWire,
} from "@dsh-vscode/contract";
import { GeneralController } from "./GeneralController.js";
import { GeneralSection } from "./GeneralSection.js";

function ns(
  namespace: string,
  revision: number,
  value: Record<string, unknown>,
  writable = true,
): SettingsNamespaceWire {
  return {
    namespace,
    revision,
    applies: "live",
    writable,
    base: value,
    user: {},
    value,
    secrets: [],
  };
}

function general(): GeneralSettingsView {
  return {
    section: "general",
    namespaces: [
      ns("agent-presets", 1, { default: "standard" }),
      ns("permission", 2, { defaultPreset: "workspace-write" }),
      ns("locale", 3, { preference: "en" }),
      ns("ui-theme", 4, { preference: "system" }),
      ns("ui-conversation", 5, { busyEnter: "queue" }),
    ],
    agentPresets: [{ id: "standard", label: "Standard" }],
    permissionPresets: [
      { id: "workspace-write", label: "Workspace Write", dangerous: false },
      { id: "danger-full-access", label: "Full Access", dangerous: true },
    ],
  };
}

afterEach(cleanup);

describe("GeneralSection", () => {
  it("renders the five rows in canonical order with editor and busy copy", () => {
    render(
      <GeneralSection
        controller={new GeneralController(vi.fn(), vi.fn())}
        view={general()}
        locale="en"
        confirmFullAccess={vi.fn(async () => true)}
      />,
    );
    expect(
      screen.getAllByTestId("general-row").map((row) => row.getAttribute("data-row")),
    ).toEqual([
      "agent-preset",
      "permission",
      "locale",
      "appearance",
      "busy-enter",
    ]);
    expect(
      screen.getByText("The extension follows the VS Code or Cursor theme."),
    ).toBeVisible();
    expect(screen.getByRole("option", { name: "Queue" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Steer" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "System default" })).toBeInTheDocument();
    expect(screen.getByLabelText("Language")).toHaveValue("");
  });

  it("unsets locale preference when System default is selected", () => {
    const send = vi.fn();
    const value = general();
    value.namespaces[2] = {
      ...ns("locale", 3, { preference: "zh" }),
      user: { preference: "zh" },
    };
    render(
      <GeneralSection
        controller={new GeneralController(send, vi.fn(), () => "system-locale")}
        view={value}
        locale="zh"
        confirmFullAccess={vi.fn(async () => true)}
      />,
    );

    expect(screen.getByLabelText("语言")).toHaveValue("zh");
    fireEvent.change(screen.getByLabelText("语言"), { target: { value: "" } });
    expect(send).toHaveBeenCalledWith({
      requestId: "system-locale",
      kind: "mutateSettings",
      namespace: "locale",
      expectedRevision: 3,
      ops: [{ op: "unset", path: ["preference"] }],
    });
  });

  it("switches locale copy only after the correlated accepted namespace", async () => {
    const sent: MutateSettingsCommand[] = [];
    const controller = new GeneralController((command) => sent.push(command), vi.fn());
    const props = {
      controller,
      view: general(),
      locale: "en" as const,
      confirmFullAccess: vi.fn(async () => true),
    };
    const mounted = render(<GeneralSection {...props} />);
    fireEvent.change(screen.getByLabelText("Language"), {
      target: { value: "zh" },
    });
    expect(sent).toHaveLength(1);
    expect(screen.getByLabelText("Language")).toBeVisible();
    const success: SettingsMutationMessage = {
      kind: "settingsMutation",
      requestId: sent[0]!.requestId,
      result: {
        ok: true,
        namespace: ns("locale", 4, { preference: "zh" }),
      },
    };
    controller.receive(success);
    const resolved = general();
    resolved.namespaces[2] = ns("locale", 4, { preference: "zh" });
    mounted.rerender(
      <GeneralSection {...props} view={resolved} locale="zh" />,
    );
    expect(screen.getByLabelText("语言")).toBeVisible();
  });

  it("uses separate host confirmation for the dangerous default", async () => {
    const sent: MutateSettingsCommand[] = [];
    const confirm = vi.fn(async () => false);
    const controller = new GeneralController(
      (command) => sent.push(command),
      vi.fn(),
    );
    const mounted = render(
      <GeneralSection
        controller={controller}
        view={general()}
        locale="en"
        confirmFullAccess={confirm}
      />,
    );
    fireEvent.change(screen.getByLabelText("Default permission"), {
      target: { value: "danger-full-access" },
    });
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(sent).toHaveLength(0);

    mounted.rerender(
      <GeneralSection
        controller={controller}
        view={general()}
        locale="en"
        confirmFullAccess={vi.fn(async () => true)}
      />,
    );
    fireEvent.change(screen.getByLabelText("Default permission"), {
      target: { value: "danger-full-access" },
    });
    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it("disables reset while that namespace mutation is in flight", () => {
    const value = general();
    value.namespaces[2] = {
      ...ns("locale", 3, { preference: "en" }),
      user: { preference: "en" },
    };
    render(
      <GeneralSection
        controller={new GeneralController(vi.fn(), vi.fn())}
        view={value}
        locale="en"
        confirmFullAccess={vi.fn(async () => true)}
      />,
    );
    fireEvent.change(screen.getByLabelText("Language"), {
      target: { value: "zh" },
    });
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
  });

  it("hides missing namespaces and shows unknown locale as a disabled error", () => {
    const value = general();
    value.namespaces = [ns("locale", 1, { preference: "fr" }, false)];
    render(
      <GeneralSection
        controller={new GeneralController(vi.fn(), vi.fn())}
        view={value}
        locale="en"
        confirmFullAccess={vi.fn(async () => true)}
      />,
    );
    expect(screen.getAllByTestId("general-row")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Unknown locale: fr");
    expect(screen.getByLabelText("Language")).toBeDisabled();
  });
});

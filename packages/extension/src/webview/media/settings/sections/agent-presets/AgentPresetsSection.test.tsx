// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPresetsSettingsView } from "@dsh-vscode/contract";
import { AgentPresetsController } from "./AgentPresetsController.js";
import { AgentPresetsSection } from "./AgentPresetsSection.js";

afterEach(cleanup);

const VIEW: AgentPresetsSettingsView = {
  section: "agent-presets",
  namespace: {
    namespace: "agent-presets",
    revision: 3,
    applies: "live",
    writable: true,
    base: { default: "standard" },
    user: {},
    value: { default: "standard" },
    secrets: [],
  },
  presets: [
    {
      id: "mine",
      trust: "user",
      name: "Mine",
      description: "Personal preset",
      removable: true,
      openable: true,
    },
    {
      id: "standard",
      trust: "system",
      name: "Standard",
      description: "Built in preset",
      removable: false,
      openable: false,
    },
    {
      id: "broken",
      trust: "user",
      broken: "invalid YAML",
      removable: true,
      openable: true,
    },
  ],
};

function setup(
  locale: "en" | "zh" = "en",
  view: AgentPresetsSettingsView = VIEW,
  onConfirmationChange?: (active: boolean) => void,
) {
  const commands: unknown[] = [];
  const controller = new AgentPresetsController(
    (command) => commands.push(command),
    (command) => commands.push(command),
    vi.fn(),
    vi.fn(),
    (() => {
      let index = 0;
      return () => `request-${++index}`;
    })(),
  );
  const rendered = render(
    <AgentPresetsSection
      controller={controller}
      view={view}
      locale={locale}
      onConfirmationChange={onConfirmationChange}
    />,
  );
  return { controller, commands, ...rendered };
}

describe("AgentPresetsSection", () => {
  it("renders grouped trust, description, broken state, current default, and allowed actions", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Built in" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "User" })).toBeVisible();
    expect(screen.getByText(
      "A full-featured coding agent with file editing, shell, file and web search, skills, plan, goals, subagents, and workflows.",
    )).toBeVisible();
    expect(screen.getByText("Personal preset")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("invalid YAML");
    expect(screen.getByText("Default")).toBeVisible();
    expect(screen.getByRole("button", { name: "Set Standard Mode as default" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "View Standard Mode" }))
      .toHaveTextContent("View");
    expect(screen.queryByRole("button", { name: "Delete Standard Mode" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Mine" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete Mine" })).toBeEnabled();
  });

  it("renders exact hostile YAML as inert preformatted text", () => {
    const { controller } = setup();
    fireEvent.click(screen.getByRole("button", { name: "View Standard Mode" }));
    act(() => {
      controller.receiveContent({
        kind: "agentPresetContent",
        requestId: "request-1",
        result: {
          ok: true,
          presetId: "standard",
          trust: "system",
          content: "<img src=x onerror=alert(1)>\n<script>alert(2)</script>",
        },
      });
    });
    const viewer = screen.getByRole("dialog", { name: "Preset content · Standard Mode" });
    expect(viewer.querySelector("pre")).toHaveTextContent(
      "<img src=x onerror=alert(1)> <script>alert(2)</script>",
    );
    expect(viewer.querySelector("img")).toBeNull();
    expect(viewer.querySelector("script")).toBeNull();
  });

  it("traps viewer focus, closes on Escape, and returns focus", () => {
    const { controller } = setup();
    const invoke = screen.getByRole("button", { name: "View Standard Mode" });
    fireEvent.click(invoke);
    const viewer = screen.getByRole("dialog", { name: "Preset content · Standard Mode" });
    const close = within(viewer).getByRole("button", { name: "Close settings" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(controller.snapshot().viewer).toBeUndefined();
    expect(invoke).toHaveFocus();
  });

  it("uses a distinct validated copy dialog and marks partially entered data dirty", () => {
    const { controller, commands } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Copy Standard Mode" }));
    const dialog = screen.getByRole("dialog", { name: "Copy Agent Preset · Standard Mode" });
    fireEvent.change(screen.getByLabelText("Identifier"), {
      target: { value: "Bad Id" },
    });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: " " },
    });
    expect(dialog).toHaveTextContent("Use lowercase letters, digits, and hyphens");
    expect(dialog).toHaveTextContent("This value is required.");
    expect(controller.snapshot().dirty).toBe(true);
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Identifier"), {
      target: { value: "standard-copy" },
    });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Standard copy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(commands.at(-1)).toEqual(expect.objectContaining({
      kind: "copyAgentPreset",
      fromPresetId: "standard",
      presetId: "standard-copy",
      name: "Standard copy",
    }));
  });

  it("traps copy focus, blocks Escape while saving, and returns focus after close", () => {
    setup();
    const invoke = screen.getByRole("button", { name: "Copy Standard Mode" });
    fireEvent.click(invoke);
    const dialog = screen.getByRole("dialog", { name: "Copy Agent Preset · Standard Mode" });
    const id = within(dialog).getByLabelText("Identifier");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    expect(id).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(id).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", {
      name: "Copy Agent Preset · Standard Mode",
    })).toBeNull();
    expect(invoke).toHaveFocus();

    fireEvent.click(invoke);
    const savingDialog = screen.getByRole("dialog", {
      name: "Copy Agent Preset · Standard Mode",
    });
    fireEvent.change(within(savingDialog).getByLabelText("Identifier"), {
      target: { value: "copy" },
    });
    fireEvent.change(within(savingDialog).getByLabelText("Name"), {
      target: { value: "Copy" },
    });
    fireEvent.click(within(savingDialog).getByRole("button", { name: "Create" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Copy Agent Preset · Standard Mode" })).toBeVisible();
  });

  it("requires an accessible distinct fallback before deleting the default", () => {
    const { commands } = setup("en", {
      ...VIEW,
      namespace: {
        ...VIEW.namespace!,
        user: { default: "mine" },
        value: { default: "mine" },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete Mine" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete Agent Preset" });
    expect(dialog).toHaveTextContent("Choose another available default first");
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Replacement default"), {
      target: { value: "standard" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(commands.at(-1)).toEqual(expect.objectContaining({
      kind: "mutateSettings",
      namespace: "agent-presets",
      expectedRevision: 3,
      ops: [{ op: "set", path: ["default"], value: "standard" }],
    }));
  });

  it("traps delete focus, closes on Escape, and returns focus", () => {
    setup();
    const invoke = screen.getByRole("button", { name: "Delete Mine" });
    fireEvent.click(invoke);
    const dialog = screen.getByRole("alertdialog", { name: "Delete Agent Preset" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const remove = within(dialog).getByRole("button", { name: "Delete" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(remove).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(invoke).toHaveFocus();
  });

  it("reports delete confirmation ownership and keeps a pointer-blocking scrim", () => {
    const onConfirmationChange = vi.fn();
    setup("en", VIEW, onConfirmationChange);
    fireEvent.click(screen.getByRole("button", { name: "Delete Mine" }));
    expect(onConfirmationChange).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("settings-confirmation-scrim")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirmationChange).toHaveBeenLastCalledWith(false);
  });

  it("projects English copy for a system preset and keeps a user preset's own name", () => {
    const { controller } = setup("en", {
      ...VIEW,
      namespace: {
        ...VIEW.namespace!,
        user: { default: "mine" },
        value: { default: "mine" },
      },
      presets: [
        {
          id: "standard",
          trust: "system",
          name: "标准模式",
          description:
            "功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。",
          removable: false,
          openable: false,
        },
        {
          id: "mine",
          trust: "user",
          name: "My Coding Agent",
          description: "Personal preset",
          removable: true,
          openable: true,
        },
      ],
    });

    expect(screen.getByRole("button", { name: "Set Standard Mode as default" }))
      .toBeEnabled();
    expect(screen.getByText(
      "A full-featured coding agent with file editing, shell, file and web search, skills, plan, goals, subagents, and workflows.",
    )).toBeVisible();
    expect(screen.getByRole("button", { name: "Open My Coding Agent" })).toBeEnabled();
    expect(screen.getByText("Personal preset")).toBeVisible();
    expect(screen.queryByText("标准模式")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Copy Standard Mode" }));
    expect(screen.getByRole("dialog", { name: "Copy Agent Preset · Standard Mode" }))
      .toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "View Standard Mode" }));
    expect(screen.getByRole("dialog", { name: "Preset content · Standard Mode" }))
      .toBeVisible();
    expect(controller.snapshot().copy).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));

    fireEvent.click(screen.getByRole("button", { name: "Delete My Coding Agent" }));
    expect(screen.getByRole("option", { name: "Standard Mode" })).toBeInTheDocument();
  });

  it("centralizes Chinese dialog and accessibility copy", () => {
    setup("zh");
    fireEvent.click(screen.getByRole("button", { name: "复制 Standard" }));
    expect(screen.getByRole("dialog", { name: "复制智能体预设 · Standard" })).toBeVisible();
    expect(screen.getByLabelText("标识符")).toBeVisible();
    expect(screen.getByLabelText("名称")).toBeVisible();
  });
});

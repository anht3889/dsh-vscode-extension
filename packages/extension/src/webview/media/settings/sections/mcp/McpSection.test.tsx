// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpSettingsView } from "@dsh-vscode/contract";
import { SettingsModal } from "../../SettingsModal.js";
import { initialSettingsState } from "../../reducer.js";
import type { SettingsSectionState } from "../../types.js";
import { McpController } from "./McpController.js";
import { McpSection } from "./McpSection.js";

afterEach(cleanup);

const view: McpSettingsView = {
  section: "mcp",
  servers: [{
    server: {
      id: "alpha",
      serverName: "Alpha",
      enabled: true,
      transport: "stdio",
      command: "mcp",
      auth: { kind: "none" },
      toolCallTimeoutMs: 30_000,
      reconnect: {
        enabled: true,
        initialDelayMs: 1_000,
        maxDelayMs: 30_000,
        maxAttempts: 5,
      },
      createdAt: "created",
      updatedAt: "updated",
    },
    status: { state: "disconnected" },
    toolCount: 0,
    disabledToolCount: 0,
  }],
  secretStates: "available",
  oauth: { kind: "manual", reason: "no-callback-origin" },
};

const ready: SettingsSectionState = {
  status: "ready",
  view,
  stale: false,
  available: true,
};

function ConfirmationModalHarness({
  controller,
  onRequestClose,
}: {
  controller: McpController;
  onRequestClose: ReturnType<typeof vi.fn>;
}): JSX.Element {
  const [confirmation, setConfirmation] = React.useState(false);
  return (
    <SettingsModal
      state={{
        ...initialSettingsState,
        open: true,
        activeSection: "mcp",
        capabilities: ["mcp"],
        capabilitiesKnown: true,
        sections: { ...initialSettingsState.sections, mcp: ready },
      }}
      controller={{ dirty: false, confirmation }}
      onSection={vi.fn()}
      onRequestClose={onRequestClose}
    >
      <McpSection
        controller={controller}
        locale="en"
        state={ready}
        onConfirmationChange={setConfirmation}
      />
    </SettingsModal>
  );
}

/** Hydrates the controller the way the App routes an accepted section read. */
function setup(
  locale: "en" | "zh" = "en",
  state = ready,
  onConfirmationChange?: (open: boolean) => void,
) {
  let next = 0;
  const controller = new McpController(vi.fn(), vi.fn(), () => `request-${++next}`);
  if (state.view?.section === "mcp") controller.updateView(state.view);
  return {
    controller,
    ...render(
      <McpSection
        controller={controller}
        locale={locale}
        state={state}
        onConfirmationChange={onConfirmationChange}
      />,
    ),
  };
}

describe.each([
  ["en", "MCP servers", "Loading settings…", "Retry"],
  ["zh", "MCP 服务器", "正在加载设置…", "重试"],
] as const)("McpSection locale %s", (locale, listName, loading, retry) => {
  it("renders loading and error section states", () => {
    const { rerender, controller } = setup(locale, { ...ready, status: "loading", view: undefined });
    expect(screen.getByText(loading)).toBeVisible();
    rerender(
      <McpSection
        controller={controller}
        locale={locale}
        state={{ ...ready, status: "error", view: undefined, detail: "load detail" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("load detail");
    expect(screen.getByRole("button", { name: retry })).toBeVisible();
  });

  it("renders list and detail, then replaces detail with the editor", () => {
    const { controller } = setup(locale);
    expect(screen.getByRole("list", { name: listName })).toBeVisible();
    fireEvent.click(screen.getByRole("button", {
      name: /Alpha.*Standard input\/output|Alpha.*标准输入\/输出/,
    }));
    act(() => controller.receiveDetail({
      kind: "mcpServer",
      requestId: "request-1",
      result: {
        ok: true,
        detail: {
          server: view.servers[0]!.server,
          status: view.servers[0]!.status,
          tools: [],
          secrets: { kind: "known", secrets: [] },
        },
      },
    }));
    expect(screen.getByRole("region", { name: /Alpha/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Edit Alpha|编辑 Alpha/ }));
    expect(screen.getByRole("form")).toBeVisible();
    expect(screen.queryByRole("region", { name: /Alpha/ })).toBeNull();
  });
});

it("reports both destructive confirmation transitions and unmount ownership", () => {
  const onConfirmationChange = vi.fn();
  const { controller, unmount } = setup("en", ready, onConfirmationChange);
  expect(onConfirmationChange).toHaveBeenLastCalledWith(false);

  fireEvent.click(screen.getByRole("button", { name: "Delete Alpha" }));
  expect(onConfirmationChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onConfirmationChange).toHaveBeenLastCalledWith(false);

  act(() => controller.confirm("clear-oauth", "alpha"));
  expect(onConfirmationChange).toHaveBeenLastCalledWith(true);
  unmount();
  expect(onConfirmationChange).toHaveBeenLastCalledWith(false);
});

it("releases modal close blocking before rendering an empty list", () => {
  const controller = new McpController(vi.fn(), vi.fn(), () => "request");
  controller.updateView(view);
  const onRequestClose = vi.fn();
  render(
    <ConfirmationModalHarness
      controller={controller}
      onRequestClose={onRequestClose}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete Alpha" }));
  fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
  expect(onRequestClose).not.toHaveBeenCalled();

  act(() => controller.updateView({ ...view, servers: [] }));

  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByText("No MCP servers are configured.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
  expect(onRequestClose).toHaveBeenCalledWith("button", false);
});

it("keeps a shrinkable MCP layout hook for narrow and zoomed settings", () => {
  setup();
  expect(document.querySelector(".dsh-mcp-layout")).toBeInTheDocument();
  expect(document.querySelector(".dsh-mcp-secondary")).toBeInTheDocument();
});

it.each([
  ["en", "Skip and close", "The server was saved without its staged secrets. Re-enter the keys to save them later."],
  ["zh", "跳过并关闭", "服务器已保存，但未保存暂存的密钥。稍后可重新输入密钥并保存。"],
] as const)(
  "keeps the declined-secret notice after the %s editor closes",
  (locale, skip, notice) => {
    const { controller } = setup(locale);
    act(() => {
      controller.openEdit("alpha");
      controller.setEditorField("auth", {
        kind: "headers",
        headerNames: ["Authorization"],
      });
      controller.stageSecret("Authorization", "section-local");
      controller.saveEditor({ Authorization: "section-local" });
      controller.receiveOperation({
        kind: "mcpOperation",
        requestId: "request-1",
        result: {
          ok: true,
          detail: {
            server: {
              ...view.servers[0]!.server,
              auth: { kind: "headers", headerNames: ["Authorization"] },
            },
            status: view.servers[0]!.status,
            tools: [],
            secrets: {
              kind: "known",
              secrets: [{ name: "Authorization", configured: false }],
            },
          },
        },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: skip }));

    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.getByText(notice)).toBeVisible();
    expect(JSON.stringify(controller.snapshot())).not.toContain("section-local");
  },
);

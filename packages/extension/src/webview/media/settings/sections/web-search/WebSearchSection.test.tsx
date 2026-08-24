// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  WebSearchMutationMessage,
  WebSearchSettingsView,
} from "@dsh-vscode/contract";
import type { SettingsLocale } from "../../types.js";
import { WebSearchController } from "./WebSearchController.js";
import { WebSearchSection } from "./WebSearchSection.js";

afterEach(cleanup);

const VIEW: WebSearchSettingsView = {
  section: "web-search",
  engine: "tavily",
  engines: [
    {
      engine: "tavily",
      defaultBaseURL: "https://api.tavily.com",
      baseURLRequired: false,
      secretRef: "TAVILY_API_KEY",
    },
    {
      engine: "brave",
      defaultBaseURL: "https://api.search.brave.com",
      baseURLRequired: false,
      secretRef: "BRAVE_API_KEY",
    },
    { engine: "searxng", baseURLRequired: true },
  ],
  secrets: [
    { ref: "TAVILY_API_KEY", configured: true, writable: true },
    { ref: "BRAVE_API_KEY", configured: false, writable: true },
  ],
  available: true,
};

function setup(locale: SettingsLocale = "en") {
  const sent: unknown[] = [];
  const controller = new WebSearchController(
    (command) => sent.push(command),
    vi.fn(),
    () => "web-save",
  );
  controller.updateView(VIEW);
  const mounted = render(
    <WebSearchSection controller={controller} view={VIEW} locale={locale} />,
  );
  return { controller, sent, mounted };
}

describe.each([
  ["en", "Search engine", "SearXNG", "Base URL", "Save", "Other engine endpoints"],
  ["zh", "搜索引擎", "SearXNG", "基础 URL", "保存", "其他引擎端点"],
] as const)("WebSearchSection locale %s", (
  locale,
  groupName,
  searxng,
  baseURL,
  saveLabel,
  collapsedLabel,
) => {
  it("renders an accessible engine chooser and validates SearXNG", () => {
    setup(locale);
    const group = screen.getByRole("radiogroup", { name: groupName });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);

    fireEvent.click(within(group).getByRole("radio", { name: searxng }));
    const endpoint = screen.getByLabelText(baseURL);
    expect(endpoint).toBeRequired();
    expect(screen.getByRole("button", { name: saveLabel })).toBeDisabled();
    fireEvent.change(endpoint, { target: { value: "https://search.example" } });
    expect(screen.getByRole("button", { name: saveLabel })).toBeEnabled();

    const collapsed = screen.getByText(collapsedLabel).closest("details");
    expect(collapsed).not.toHaveAttribute("open");
    expect(within(collapsed!).getAllByRole("textbox", { hidden: true })).toHaveLength(2);
  });
});

describe("WebSearchSection behavior", () => {
  it("keeps write-only secrets component-local and clears them after success", () => {
    const { controller, sent } = setup();
    const tavily = screen.getByLabelText<HTMLInputElement>("Tavily API key");
    const brave = screen.getByLabelText<HTMLInputElement>("Brave API key");
    expect(tavily).toHaveAttribute("type", "password");
    expect(brave).toHaveAttribute("type", "password");
    expect(screen.getAllByText("The current value cannot be read back.")).toHaveLength(2);
    expect(screen.getByText("Configured")).toBeVisible();
    expect(screen.getByText("Not configured")).toBeVisible();

    fireEvent.change(tavily, { target: { value: "tavily-secret" } });
    fireEvent.change(brave, { target: { value: "brave-secret" } });
    expect(JSON.stringify(controller.snapshot())).not.toContain("tavily-secret");
    expect(JSON.stringify(controller.snapshot())).not.toContain("brave-secret");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(sent[0]).toMatchObject({
      kind: "setWebSearchConfig",
      secrets: [
        { ref: "TAVILY_API_KEY", value: "tavily-secret" },
        { ref: "BRAVE_API_KEY", value: "brave-secret" },
      ],
    });

    act(() => {
      controller.receive({
        kind: "webSearchMutation",
        requestId: "web-save",
        result: { ok: true, view: VIEW, secretFailures: [] },
      });
    });
    expect(tavily).toHaveValue("");
    expect(brave).toHaveValue("");
  });

  it("reports availability and retains only a failed key for retry", () => {
    const { controller } = setup();
    expect(screen.getByRole("status")).toHaveTextContent("Web Search is usable.");
    const brave = screen.getByLabelText<HTMLInputElement>("Brave API key");
    fireEvent.change(brave, { target: { value: "brave-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    act(() => {
      controller.receive({
        kind: "webSearchMutation",
        requestId: "web-save",
        result: {
          ok: true,
          view: { ...VIEW, engine: "brave", available: false },
          secretFailures: [{
            ref: "BRAVE_API_KEY",
            message: "generic bridge detail must not render",
          }],
        },
      });
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "BRAVE_API_KEY could not be saved. Re-enter or retry this key.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("bridge detail");
    expect(brave).toHaveValue("brave-secret");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Web Search needs BRAVE_API_KEY.",
    );
  });

  it("preserves a rejected secret while a catalog edit clears the error", () => {
    const { controller } = setup();
    const secret = screen.getByLabelText<HTMLInputElement>("Tavily API key");
    fireEvent.change(secret, { target: { value: "rejected-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    act(() => {
      controller.receive({
        kind: "webSearchMutation",
        requestId: "web-save",
        result: {
          ok: false,
          error: { code: "web-search-rejected", message: "Catalog rejected" },
        },
      });
    });

    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://fixed.example" },
    });

    expect(secret).toHaveValue("rejected-secret");
    expect(controller.snapshot().secrets).toContainEqual(
      expect.objectContaining({ ref: "TAVILY_API_KEY", staged: true }),
    );
    expect(JSON.stringify(controller.snapshot())).not.toContain("rejected-secret");
  });

  it("clears successful refs while retaining a failed secret literal", () => {
    const { controller } = setup();
    const tavily = screen.getByLabelText<HTMLInputElement>("Tavily API key");
    const brave = screen.getByLabelText<HTMLInputElement>("Brave API key");
    fireEvent.change(tavily, { target: { value: "successful-secret" } });
    fireEvent.change(brave, { target: { value: "failed-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    act(() => {
      controller.receive({
        kind: "webSearchMutation",
        requestId: "web-save",
        result: {
          ok: true,
          view: VIEW,
          secretFailures: [{
            ref: "BRAVE_API_KEY",
            message: "generic failure",
          }],
        },
      });
    });

    expect(tavily).toHaveValue("");
    expect(brave).toHaveValue("failed-secret");
    expect(controller.snapshot()).toMatchObject({
      dirty: true,
      secrets: [
        expect.objectContaining({ ref: "TAVILY_API_KEY", staged: false }),
        expect.objectContaining({ ref: "BRAVE_API_KEY", staged: true }),
      ],
    });
    expect(JSON.stringify(controller.snapshot())).not.toContain("failed-secret");
  });

  it("disables actions while saving and supports keyboard-operable radios", () => {
    const { controller } = setup();
    const tavily = screen.getByRole("radio", { name: "Tavily" });
    tavily.focus();
    fireEvent.keyDown(tavily, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Brave Search" })).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Brave API key"), {
      target: { value: "brave-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(controller.snapshot().status).toBe("saving");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
  });

  it("renders a localized missing-endpoint state", () => {
    const unavailable: WebSearchSettingsView = {
      ...VIEW,
      engine: "searxng",
      available: false,
    };
    const controller = new WebSearchController(vi.fn(), vi.fn());
    controller.updateView(unavailable);
    render(
      <WebSearchSection
        controller={controller}
        view={unavailable}
        locale="zh"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "网络搜索需要 SearXNG 基础 URL。",
    );
  });

  it("clears secret inputs on disconnect", () => {
    const { controller } = setup();
    const secret = screen.getByLabelText("Tavily API key");
    fireEvent.change(secret, { target: { value: "temporary-secret" } });
    act(() => controller.disconnect());
    expect(secret).toHaveValue("");
  });

  it("clears controller secret intent when the section unmounts", () => {
    const { controller, mounted } = setup();
    fireEvent.change(screen.getByLabelText("Tavily API key"), {
      target: { value: "temporary-tavily" },
    });
    fireEvent.change(screen.getByLabelText("Brave API key"), {
      target: { value: "temporary-brave" },
    });

    mounted.unmount();

    expect(controller.snapshot()).toMatchObject({
      dirty: false,
      secrets: [
        expect.objectContaining({ ref: "TAVILY_API_KEY", staged: false }),
        expect.objectContaining({ ref: "BRAVE_API_KEY", staged: false }),
      ],
    });
  });
});

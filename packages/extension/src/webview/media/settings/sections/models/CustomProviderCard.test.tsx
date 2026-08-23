// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ModelsSettingsView,
  SettingsMutationMessage,
} from "@dsh-vscode/contract";
import { ModelsController } from "./ModelsController.js";
import { ModelsSection } from "./ModelsSection.js";

afterEach(cleanup);

function view(protocols = ["openai-completions", "anthropic-messages"]): ModelsSettingsView {
  return {
    section: "models",
    namespaces: [{
      namespace: "llm-pi-ai",
      revision: 7,
      applies: "live",
      writable: true,
      base: { providers: {} },
      user: {},
      value: { providers: {} },
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
        path: ["providers", "openai", "api"],
        label: "API",
        kind: "union",
        options: protocols.map((value) => ({ value, label: value })),
      }],
    }],
    credentials: [],
  };
}

function success(requestId: string): SettingsMutationMessage {
  return {
    kind: "settingsMutation",
    requestId,
    result: {
      ok: true,
      namespace: {
        ...view().namespaces[0]!,
        revision: 8,
      },
    },
  };
}

describe("CustomProviderCard", () => {
  it("creates one complete profile then retries only its failed credential", () => {
    const sent: unknown[] = [];
    const credentials: unknown[] = [];
    let next = 0;
    const controller = new ModelsController(
      (command) => sent.push(command),
      vi.fn(),
      () => `custom-${++next}`,
    );
    const modelsView = view();
    controller.updateView(modelsView);
    render(
      <ModelsSection
        controller={controller}
        view={modelsView}
        locale="en"
        onCredential={(command) => credentials.push(command)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add a custom provider" }));
    fireEvent.change(screen.getByLabelText("Provider ID"), {
      target: { value: "acme-gateway" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Acme Gateway" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://gateway.acme.example/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));
    fireEvent.change(screen.getByLabelText("Model ID 1"), {
      target: { value: "acme-large" },
    });
    fireEvent.change(screen.getByLabelText("Context window 1"), {
      target: { value: "65536" },
    });
    const key = screen.getByLabelText<HTMLInputElement>("API key");
    fireEvent.change(key, { target: { value: "super-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(sent).toEqual([{
      kind: "mutateSettings",
      requestId: "custom-1",
      namespace: "llm-pi-ai",
      expectedRevision: 7,
      ops: [{
        op: "set",
        path: ["providers", "acme-gateway"],
        value: {
          displayName: "Acme Gateway",
          apiKeyEnv: "ACME_GATEWAY_API_KEY",
          api: "openai-completions",
          baseURL: "https://gateway.acme.example/v1",
          models: [{ id: "acme-large", contextWindow: 65536 }],
        },
      }],
    }]);
    expect(key).toHaveValue("");
    expect(JSON.stringify(controller.snapshot())).not.toContain("super-secret");

    act(() => controller.receive(success("custom-1")));
    expect(credentials).toEqual([{
      kind: "setCredential",
      requestId: "custom-2",
      ref: "ACME_GATEWAY_API_KEY",
      value: "super-secret",
    }]);
    expect(screen.getByLabelText("Provider ID")).toBeDisabled();
    act(() => controller.receive({
      kind: "settingsMutation",
      requestId: "custom-2",
      result: {
        ok: false,
        error: { code: "credentials-rejected", message: "Key rejected" },
      },
    }));

    fireEvent.change(key, { target: { value: "replacement-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(sent).toHaveLength(1);
    expect(credentials[1]).toMatchObject({
      requestId: "custom-3",
      ref: "ACME_GATEWAY_API_KEY",
      value: "replacement-secret",
    });
  });

  it("rejects every directory collision and invalid hand-declared profile", () => {
    const controller = new ModelsController(vi.fn(), vi.fn());
    const modelsView = view();
    controller.updateView(modelsView);
    render(
      <ModelsSection
        controller={controller}
        view={modelsView}
        locale="en"
        onCredential={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add a custom provider" }));
    const route = screen.getByLabelText("Provider ID");
    fireEvent.change(route, { target: { value: "openai" } });
    expect(screen.getByText("This provider ID is already in use.")).toBeVisible();
    fireEvent.change(route, { target: { value: "1bad_route" } });
    expect(screen.getByText("This provider ID has an invalid format.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("disables custom declaration when schema metadata has no protocol union", () => {
    const modelsView = view([]);
    const controller = new ModelsController(vi.fn(), vi.fn());
    controller.updateView(modelsView);
    render(
      <ModelsSection
        controller={controller}
        view={modelsView}
        locale="en"
        onCredential={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Add a custom provider" }),
    ).toBeDisabled();
  });

  it("creates an ambient-auth profile without a credential reference or write", () => {
    const sent: unknown[] = [];
    const credentials: unknown[] = [];
    const controller = new ModelsController(
      (command) => sent.push(command),
      vi.fn(),
      () => "custom-1",
    );
    const modelsView = view();
    controller.updateView(modelsView);
    render(
      <ModelsSection
        controller={controller}
        view={modelsView}
        locale="en"
        onCredential={(command) => credentials.push(command)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add a custom provider" }));
    fireEvent.change(screen.getByLabelText("Provider ID"), {
      target: { value: "ambient-provider" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://ambient.example/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));
    fireEvent.change(screen.getByLabelText("Model ID 1"), {
      target: { value: "ambient-model" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(sent[0]).toMatchObject({
      ops: [{
        op: "set",
        path: ["providers", "ambient-provider"],
        value: {
          api: "openai-completions",
          baseURL: "https://ambient.example/v1",
          models: [{ id: "ambient-model" }],
        },
      }],
    });
    expect(JSON.stringify(sent[0])).not.toContain("apiKeyEnv");
    act(() => controller.receive(success("custom-1")));
    expect(credentials).toEqual([]);
    expect(
      screen.queryByRole("heading", { name: "Custom provider" }),
    ).toBeNull();
  });

  it("rejects blank and wrapped API-key pastes", () => {
    const controller = new ModelsController(vi.fn(), vi.fn());
    const modelsView = view();
    controller.updateView(modelsView);
    render(
      <ModelsSection
        controller={controller}
        view={modelsView}
        locale="en"
        onCredential={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add a custom provider" }));
    const key = screen.getByLabelText("API key");
    fireEvent.change(key, { target: { value: "   " } });
    expect(screen.getByText(
      "Leave the API key empty or enter a non-blank value.",
    )).toBeVisible();
    fireEvent.change(key, { target: { value: "\"secret\"" } });
    expect(screen.getByText(
      "Paste the key value only, without quotes, spaces, or an environment assignment.",
    )).toBeVisible();
  });

  it.each(["relative/path", "ftp://gateway.example/v1", "://malformed"])(
    "rejects non-HTTP absolute base URL %s",
    (baseURL) => {
      const controller = new ModelsController(vi.fn(), vi.fn());
      const modelsView = view();
      controller.updateView(modelsView);
      render(
        <ModelsSection
          controller={controller}
          view={modelsView}
          locale="en"
          onCredential={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", {
        name: "Add a custom provider",
      }));
      fireEvent.change(screen.getByLabelText("Provider ID"), {
        target: { value: "acme-gateway" },
      });
      fireEvent.change(screen.getByLabelText("Base URL"), {
        target: { value: baseURL },
      });
      fireEvent.click(screen.getByRole("button", { name: "Add model" }));
      fireEvent.change(screen.getByLabelText("Model ID 1"), {
        target: { value: "acme-model" },
      });

      expect(screen.getByText(
        "Base URL must be an absolute HTTP or HTTPS URL.",
      )).toBeVisible();
      expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
      cleanup();
    },
  );

  it("exposes custom conflict Retry and Discard after revision refresh", () => {
    const sent: unknown[] = [];
    const controller = new ModelsController(
      (command) => sent.push(command),
      vi.fn(),
      () => `custom-${sent.length + 1}`,
    );
    const modelsView = view();
    controller.updateView(modelsView);
    render(
      <ModelsSection
        controller={controller}
        view={modelsView}
        locale="en"
        onCredential={vi.fn()}
      />,
    );
    act(() => {
      controller.openCustom();
      controller.setCustomField("route", "acme-gateway");
      controller.setCustomField("baseURL", "https://gateway.example/v1");
      controller.setCustomModels([{ id: "acme-model" }]);
      controller.createCustom(false);
      controller.receive({
        kind: "settingsMutation",
        requestId: "custom-1",
        result: {
          ok: false,
          error: {
            code: "settings-conflict",
            message: "Changed elsewhere",
            currentRevision: 8,
          },
        },
      });
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();

    act(() => controller.updateView({
      ...modelsView,
      namespaces: modelsView.namespaces.map((namespace) => ({
        ...namespace,
        revision: 8,
      })),
    }));
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(
      screen.queryByRole("heading", { name: "Custom provider" }),
    ).toBeNull();
  });
});

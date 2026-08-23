// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelsSettingsView } from "@dsh-vscode/contract";
import { ModelsController } from "./ModelsController.js";
import { ProviderEditor } from "./ProviderEditor.js";

afterEach(cleanup);

function modelView(): ModelsSettingsView {
  return {
    section: "models",
    namespaces: [{
      namespace: "llm-deepseek",
      revision: 1,
      applies: "live",
      writable: true,
      base: {
        apiKeyEnv: "DEEPSEEK_API_KEY",
        baseURL: "https://api.deepseek.com",
        models: [{ id: "deepseek-chat" }],
      },
      user: {},
      value: {
        apiKeyEnv: "DEEPSEEK_API_KEY",
        baseURL: "https://api.deepseek.com",
        models: [{ id: "deepseek-chat" }],
      },
      secrets: [],
    }],
    providers: [{
      id: "deepseek-official",
      namespace: "llm-deepseek",
      label: "DeepSeek",
      active: true,
      catalog: { kind: "ready" },
      credential: {
        ref: "DEEPSEEK_API_KEY",
        set: true,
        source: "env",
        writable: true,
      },
      credentialStatus: { kind: "ready" },
      models: [{ id: "deepseek-chat", label: "DeepSeek Chat" }],
      removable: false,
      fields: [
        {
          path: ["apiKeyEnv"],
          label: "API key reference",
          kind: "credential-ref",
        },
        { path: ["baseURL"], label: "Base URL", kind: "string" },
      ],
    }],
    credentials: [{
      ref: "DEEPSEEK_API_KEY",
      set: true,
      source: "env",
      writable: true,
    }],
  };
}

describe("ProviderEditor secret safety", () => {
  it("posts the secret once without retaining it and clears the DOM immediately", async () => {
    const posted: unknown[] = [];
    let next = 0;
    const controller = new ModelsController(
      (command) => posted.push(command),
      vi.fn(),
      () => `secret-${++next}`,
    );
    controller.updateView(modelView());
    controller.select("deepseek-official");
    render(
      <ProviderEditor
        controller={controller}
        locale="en"
        onCredential={(command) => posted.push(command)}
      />,
    );

    const input = screen.getByLabelText<HTMLInputElement>("API key");
    fireEvent.change(input, { target: { value: "super-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(input.value).toBe("");
    await waitFor(() => {
      expect(posted).toContainEqual({
        kind: "setCredential",
        requestId: "secret-1",
        ref: "DEEPSEEK_API_KEY",
        value: "super-secret",
      });
    });
    expect(JSON.stringify(controller.snapshot())).not.toContain("super-secret");
  });

  it("renders catalog and credential failures as separate sanitized states", () => {
    const controller = new ModelsController(vi.fn(), vi.fn());
    const current = modelView();
    current.providers[0] = {
      ...current.providers[0]!,
      catalog: {
        kind: "failed",
        message: "Model catalog is unavailable",
      },
      credential: undefined,
      credentialStatus: {
        kind: "failed",
        message: "Credential metadata is unavailable",
      },
      models: [],
    };
    controller.updateView(current);
    controller.select("deepseek-official");
    render(
      <ProviderEditor
        controller={controller}
        locale="en"
        onCredential={vi.fn()}
      />,
    );

    expect(screen.getByText("Model catalog is unavailable")).toBeTruthy();
    expect(screen.getByText("Credential metadata is unavailable")).toBeTruthy();
  });
});

import { describe, expect, it, vi } from "vitest";
import type {
  ModelsSettingsView,
  SettingsMutationMessage,
} from "@dsh-vscode/contract";
import { ModelsController } from "./ModelsController.js";

function view(revision = 3): ModelsSettingsView {
  return {
    section: "models",
    namespaces: [{
      namespace: "llm-pi-ai",
      revision,
      applies: "live",
      writable: true,
      base: { providers: {} },
      user: {
        providers: {
          openai: {
            apiKeyEnv: "OPENAI_API_KEY",
            baseURL: "https://old.example/v1",
            models: [{ id: "old" }],
          },
        },
      },
      value: {
        providers: {
          openai: {
            apiKeyEnv: "OPENAI_API_KEY",
            baseURL: "https://old.example/v1",
            models: [{ id: "old" }],
          },
        },
      },
      secrets: [],
    }],
    providers: [
      {
        id: "openai",
        namespace: "llm-pi-ai",
        label: "OpenAI",
        active: true,
        declared: false,
        catalog: { kind: "ready" },
        credential: {
          ref: "OPENAI_API_KEY",
          set: true,
          source: "file",
          writable: true,
        },
        credentialStatus: { kind: "ready" },
        models: [{ id: "old", label: "Old" }],
        removable: true,
        fields: [
          {
            path: ["providers", "openai", "apiKeyEnv"],
            label: "API key reference",
            kind: "credential-ref",
          },
          {
            path: ["providers", "openai", "displayName"],
            label: "Display name",
            kind: "string",
          },
          {
            path: ["providers", "openai", "api"],
            label: "API",
            kind: "union",
            options: [
              { value: "openai-completions", label: "openai-completions" },
              { value: "anthropic-messages", label: "anthropic-messages" },
            ],
          },
          {
            path: ["providers", "openai", "baseURL"],
            label: "Base URL",
            kind: "string",
          },
        ],
      },
      {
        id: "anthropic",
        namespace: "llm-pi-ai",
        label: "Anthropic",
        active: false,
        declared: false,
        catalog: { kind: "dormant" },
        credentialStatus: { kind: "none" },
        models: [],
        removable: false,
        fields: [
          {
            path: ["providers", "anthropic", "apiKeyEnv"],
            label: "API key reference",
            kind: "credential-ref",
          },
          {
            path: ["providers", "anthropic", "baseURL"],
            label: "Base URL",
            kind: "string",
          },
        ],
      },
    ],
    credentials: [{
      ref: "OPENAI_API_KEY",
      set: true,
      source: "file",
      writable: true,
    }],
  };
}

function bench() {
  const sent: unknown[] = [];
  let next = 0;
  const refresh = vi.fn();
  const controller = new ModelsController(
    (command) => sent.push(command),
    refresh,
    () => `models-${++next}`,
  );
  controller.updateView(view());
  return { controller, sent, refresh };
}

function success(
  requestId: string,
  namespace = view().namespaces[0],
): SettingsMutationMessage {
  return {
    kind: "settingsMutation",
    requestId,
    result: { ok: true, namespace },
  };
}

describe("ModelsController", () => {
  it("keeps one selected provider and staged non-secret draft", () => {
    const { controller } = bench();
    controller.select("openai");
    controller.setField(["providers", "openai", "baseURL"], "https://new.example/v1");
    controller.select("anthropic");

    expect(controller.snapshot()).toMatchObject({
      activeProviderId: "anthropic",
      dirty: true,
    });
    controller.select("openai");
    expect(controller.snapshot().editor?.values.baseURL).toBe(
      "https://new.example/v1",
    );
    expect(JSON.stringify(controller.snapshot())).not.toContain("super-secret");
  });

  it("validates the complete card from field metadata and provider rules", () => {
    const { controller, sent } = bench();
    controller.select("openai");
    controller.setField(["providers", "openai", "api"], "unsupported");
    controller.setField(["providers", "openai", "baseURL"], "not a url");
    controller.setModels([{ id: "dup" }, { id: "dup", contextWindow: 0 }]);

    expect(controller.apply({ kind: "keep" })).toBe(false);
    expect(controller.snapshot().editor?.errors).toEqual(expect.objectContaining({
      api: { key: "modelsValidationUnsupported", values: { field: "API" } },
      baseURL: { key: "modelsValidationBaseUrl" },
      models: expect.objectContaining({ key: "modelsValidationDuplicate" }),
    }));
    expect(sent).toEqual([]);
  });

  it("resets fields with unset operations and preserves composition defaults", () => {
    const { controller, sent } = bench();
    controller.select("openai");
    controller.resetField(["providers", "openai", "baseURL"]);
    controller.apply({ kind: "keep" });

    expect(sent[0]).toMatchObject({
      kind: "mutateSettings",
      namespace: "llm-pi-ai",
      expectedRevision: 3,
      ops: [{
        op: "unset",
        path: ["providers", "openai", "baseURL"],
      }],
    });
  });

  it("adds only a dormant provider from the authoritative directory", () => {
    const { controller, sent } = bench();
    expect(controller.snapshot().addable.map((item) => item.id)).toEqual([
      "anthropic",
    ]);
    controller.select("anthropic");
    controller.apply({ kind: "set", ref: "ANTHROPIC_API_KEY" });

    expect(sent[0]).toMatchObject({
      kind: "mutateSettings",
      namespace: "llm-pi-ai",
      expectedRevision: 3,
      ops: expect.arrayContaining([
        {
          op: "set",
          path: ["providers", "anthropic", "apiKeyEnv"],
          value: "ANTHROPIC_API_KEY",
        },
      ]),
    });
  });

  it("orders settings before credential and reports credential partial failure", () => {
    const { controller, sent } = bench();
    controller.select("openai");
    controller.setField(["providers", "openai", "baseURL"], "https://new.example/v1");
    controller.apply({ kind: "set", ref: "OPENAI_API_KEY" });
    const settingsId = (sent[0] as { requestId: string }).requestId;

    controller.receive(success(settingsId));
    expect(controller.snapshot().pendingCredential).toEqual({
      kind: "set",
      requestId: "models-2",
      ref: "OPENAI_API_KEY",
    });
    controller.credentialPosted("models-2");
    controller.receive({
      kind: "settingsMutation",
      requestId: "models-2",
      result: {
        ok: false,
        error: {
          code: "credentials-rejected",
          message: "Credential write failed",
        },
      },
    });

    expect(controller.snapshot().editor).toMatchObject({
      status: "credential-failed",
      error: "Credential write failed",
      errorKey: "modelsCredentialStage",
    });
    expect(controller.snapshot().activeProviderId).toBe("openai");
  });

  it("preserves draft on conflict and retries with the refreshed revision", () => {
    const { controller, sent } = bench();
    controller.select("openai");
    controller.setField(["providers", "openai", "baseURL"], "https://draft.example/v1");
    controller.apply({ kind: "keep" });
    const requestId = (sent[0] as { requestId: string }).requestId;
    controller.receive({
      kind: "settingsMutation",
      requestId,
      result: {
        ok: false,
        error: {
          code: "settings-conflict",
          message: "Changed elsewhere",
          currentRevision: 5,
        },
      },
    });
    controller.updateView(view(5));
    controller.retry();

    expect(sent[1]).toMatchObject({
      kind: "mutateSettings",
      expectedRevision: 5,
      ops: expect.arrayContaining([{
        op: "set",
        path: ["providers", "openai", "baseURL"],
        value: "https://draft.example/v1",
      }]),
    });
    controller.receive({
      kind: "settingsMutation",
      requestId: (sent[1] as { requestId: string }).requestId,
      result: {
        ok: false,
        error: {
          code: "settings-conflict",
          message: "Changed again",
          currentRevision: 5,
        },
      },
    });
    controller.discard();
    expect(controller.snapshot().editor?.values.baseURL).toBe(
      "https://old.example/v1",
    );
  });

  it("does not retry a cleared secret after a settings conflict", () => {
    const { controller, sent } = bench();
    controller.select("openai");
    controller.setField(
      ["providers", "openai", "baseURL"],
      "https://draft.example/v1",
    );
    controller.apply({ kind: "set", ref: "OPENAI_API_KEY" });
    controller.receive({
      kind: "settingsMutation",
      requestId: (sent[0] as { requestId: string }).requestId,
      result: {
        ok: false,
        error: {
          code: "settings-conflict",
          message: "Changed elsewhere",
          currentRevision: 5,
        },
      },
    });
    controller.updateView(view(5));
    controller.retry();
    controller.receive(success((sent[1] as { requestId: string }).requestId));

    expect(controller.snapshot().pendingCredential).toBeUndefined();
    expect(sent).toHaveLength(2);
  });

  it("settles a credential stage when its component-local secret is gone", () => {
    const { controller, sent, refresh } = bench();
    controller.select("openai");
    controller.setField(
      ["providers", "openai", "baseURL"],
      "https://draft.example/v1",
    );
    controller.apply({ kind: "set", ref: "OPENAI_API_KEY" });
    controller.receive(success((sent[0] as { requestId: string }).requestId));
    refresh.mockClear();
    controller.credentialUnavailable("models-2");

    expect(controller.snapshot().editor).toMatchObject({
      status: "credential-failed",
      errorKey: "modelsSecretReenterApply",
    });
    expect(controller.snapshot().pendingCredential).toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("deletes managed writable credential before the removable subtree", () => {
    const { controller, sent } = bench();
    controller.select("openai");
    expect(controller.deleteSelected()).toBe(true);
    expect(sent[0]).toMatchObject({
      kind: "unsetCredential",
      ref: "OPENAI_API_KEY",
    });
    controller.receive(success((sent[0] as { requestId: string }).requestId));
    expect(sent[1]).toMatchObject({
      kind: "mutateSettings",
      namespace: "llm-pi-ai",
      ops: [{ op: "unset", path: ["providers", "openai"] }],
    });
  });

  it("does not delete non-removable composition routes", () => {
    const { controller, sent } = bench();
    controller.select("anthropic");
    expect(controller.deleteSelected()).toBe(false);
    expect(sent).toEqual([]);
  });

  it("settles a disconnected settings save and ignores its late result", () => {
    const { controller, sent } = bench();
    controller.select("openai");
    controller.setField(
      ["providers", "openai", "baseURL"],
      "https://draft.example/v1",
    );
    controller.apply({ kind: "keep" });
    const lateId = (sent[0] as { requestId: string }).requestId;

    controller.disconnect();
    expect(controller.snapshot()).toMatchObject({
      connected: false,
      dirty: true,
      editor: { status: "idle" },
    });
    controller.updateView(view(4));
    controller.select("anthropic");
    controller.setField(
      ["providers", "anthropic", "baseURL"],
      "https://new-editor.example/v1",
    );
    controller.apply({ kind: "keep" });
    controller.receive(success(lateId));

    expect(sent[1]).toMatchObject({
      kind: "mutateSettings",
      expectedRevision: 4,
    });
    expect(controller.snapshot().editor).toMatchObject({
      status: "saving-settings",
      provider: { id: "anthropic" },
      values: { baseURL: "https://new-editor.example/v1" },
    });
  });

  it("does not settle a settings write from another namespace", () => {
    const { controller, sent } = bench();
    controller.select("openai");
    controller.setField(
      ["providers", "openai", "baseURL"],
      "https://draft.example/v1",
    );
    controller.apply({ kind: "keep" });
    const requestId = (sent[0] as { requestId: string }).requestId;

    expect(controller.receive({
      kind: "settingsMutation",
      requestId,
      result: {
        ok: true,
        namespace: {
          ...view(9).namespaces[0]!,
          namespace: "shell",
        },
      },
    })).toBe(false);
    expect(controller.snapshot().editor).toMatchObject({
      status: "saving-settings",
      values: { baseURL: "https://draft.example/v1" },
    });
  });

  it("settles a disconnected credential save and requires secret re-entry", () => {
    const { controller, sent } = bench();
    controller.select("openai");
    controller.setField(
      ["providers", "openai", "baseURL"],
      "https://draft.example/v1",
    );
    controller.apply({ kind: "set", ref: "OPENAI_API_KEY" });
    controller.receive(success((sent[0] as { requestId: string }).requestId));
    controller.credentialPosted("models-2");

    controller.disconnect();

    expect(controller.snapshot()).toMatchObject({
      connected: false,
      secretEpoch: 1,
      editor: {
        status: "credential-failed",
        errorKey: "modelsSecretReenterApply",
      },
    });
    expect(controller.snapshot().pendingCredential).toBeUndefined();
  });

  it("settles a disconnected custom credential stage and requires secret re-entry", () => {
    const { controller, sent } = bench();
    controller.openCustom();
    controller.setCustomField("route", "acme-gateway");
    controller.setCustomField("baseURL", "https://gateway.example/v1");
    controller.setCustomModels([{ id: "acme-model" }]);
    controller.createCustom(true);
    controller.receive(success((sent[0] as { requestId: string }).requestId));
    expect(controller.snapshot().pendingCredential).toMatchObject({
      kind: "set",
      requestId: "models-2",
    });
    controller.credentialPosted("models-2");

    controller.disconnect();

    expect(controller.snapshot()).toMatchObject({
      connected: false,
      secretEpoch: 1,
      custom: {
        status: "credential-failed",
        errorKey: "modelsSecretReenterCreate",
      },
    });
    expect(controller.snapshot().pendingCredential).toBeUndefined();
  });

  it("refreshes a dirty custom revision and detects external route creation", () => {
    const { controller, sent } = bench();
    controller.openCustom();
    controller.setCustomField("route", "acme-gateway");
    controller.setCustomField("baseURL", "https://gateway.example/v1");
    controller.setCustomModels([{ id: "acme-model" }]);
    controller.updateView(view(9));
    controller.createCustom(false);
    expect(sent[0]).toMatchObject({ expectedRevision: 9 });

    controller.disconnect();
    const collision = view(10);
    collision.providers.push({
      ...collision.providers[1]!,
      id: "acme-gateway",
      label: "External Acme",
    });
    collision.namespaces[0] = {
      ...collision.namespaces[0]!,
      value: {
        providers: {
          ...(collision.namespaces[0]!.value as { providers: object }).providers,
          "acme-gateway": {},
        },
      },
    };
    controller.updateView(collision);
    expect(controller.snapshot().custom).toMatchObject({
      route: "acme-gateway",
      routeTaken: true,
      openedAt: 10,
      retryable: false,
    });
  });

  it("retries a custom conflict at the refreshed revision without replaying a secret", () => {
    const { controller, sent } = bench();
    controller.openCustom();
    controller.setCustomField("route", "acme-gateway");
    controller.setCustomField("baseURL", "https://gateway.example/v1");
    controller.setCustomModels([{ id: "acme-model" }]);
    controller.createCustom(true);
    controller.receive({
      kind: "settingsMutation",
      requestId: (sent[0] as { requestId: string }).requestId,
      result: {
        ok: false,
        error: {
          code: "settings-conflict",
          message: "Changed elsewhere",
          currentRevision: 5,
        },
      },
    });
    expect(controller.snapshot().custom).toMatchObject({
      status: "conflict",
      retryable: false,
    });

    controller.updateView(view(5));
    controller.retryCustom();
    expect(sent[1]).toMatchObject({
      kind: "mutateSettings",
      expectedRevision: 5,
    });
    controller.receive(success((sent[1] as { requestId: string }).requestId));
    expect(controller.snapshot()).toMatchObject({
      custom: {
        committed: true,
        status: "credential-failed",
        errorKey: "modelsSecretReenterCreate",
      },
    });
    expect(controller.snapshot().pendingCredential).toBeUndefined();
  });

  it("does not remove a provider when credential deletion fails", () => {
    const { controller, sent, refresh } = bench();
    controller.select("openai");
    controller.deleteSelected();
    controller.receive({
      kind: "settingsMutation",
      requestId: (sent[0] as { requestId: string }).requestId,
      result: {
        ok: false,
        error: {
          code: "credentials-rejected",
          message: "Credential removal failed",
        },
      },
    });

    expect(sent).toHaveLength(1);
    expect(controller.snapshot().editor).toMatchObject({
      errorKey: "modelsCredentialRemovalStage",
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("reports a non-restorable credential after provider deletion fails", () => {
    const { controller, sent, refresh } = bench();
    controller.select("openai");
    controller.deleteSelected();
    controller.receive(success((sent[0] as { requestId: string }).requestId));
    controller.receive({
      kind: "settingsMutation",
      requestId: (sent[1] as { requestId: string }).requestId,
      result: {
        ok: false,
        error: {
          code: "settings-rejected",
          message: "Provider removal failed",
        },
      },
    });

    expect(controller.snapshot().editor).toMatchObject({
      errorKey: "modelsProviderRemovalCredentialGone",
    });
    expect(refresh).toHaveBeenCalled();
  });
});

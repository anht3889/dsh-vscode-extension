import { describe, expect, it } from "vitest";
import {
  SettingsConflictError,
  settingsNamespace,
  type SettingsDescriptor,
} from "@deepseek-ai/dsh-settings";
import { isOutboundMessage } from "@dsh-vscode/contract";
import {
  MAX_COLLECTION_ENTRIES,
  projectNamespace,
  projectSettingsError,
} from "./project.js";

const descriptor = (overrides: Partial<SettingsDescriptor> = {}): SettingsDescriptor => ({
  ns: settingsNamespace("provider-test"),
  schema: {},
  revision: 4,
  applies: "restart",
  value: { baseURL: "https://example.test" },
  secrets: [{ path: ["apiKey"], set: true }],
  ...overrides,
});

describe("settings projection", () => {
  it("projects redacted layers, revision, applies, and writable state", () => {
    const projected = projectNamespace(descriptor({
      base: { baseURL: "https://base.test" },
      user: { baseURL: "https://user.test" },
    }), true);

    expect(projected).toEqual({
      namespace: "provider-test",
      revision: 4,
      applies: "restart",
      writable: true,
      base: { baseURL: "https://base.test" },
      user: { baseURL: "https://user.test" },
      value: { baseURL: "https://example.test" },
      secrets: [{ path: ["apiKey"], set: true }],
    });
  });

  it("defaults absent base, user, value, and secrets to safe records", () => {
    const projected = projectNamespace(descriptor({
      base: undefined,
      user: undefined,
      value: undefined,
      secrets: undefined,
    }), false);

    expect(projected.base).toEqual({});
    expect(projected.user).toEqual({});
    expect(projected.value).toEqual({});
    expect(projected.secrets).toEqual([]);
    expect(projected.writable).toBe(false);
  });

  it("never serializes a redacted fixture secret", () => {
    const projected = projectNamespace(descriptor({
      base: { apiKey: "actual-secret" },
      user: { apiKey: "actual-secret" },
      value: { apiKey: "actual-secret" },
      secrets: [{ path: ["apiKey"], set: true }],
    }), true);
    const message = {
      kind: "settingsMutation",
      requestId: "m1",
      result: { ok: true, namespace: projected },
    } as const;

    expect(JSON.stringify(message)).not.toContain("actual-secret");
    expect(isOutboundMessage(message)).toBe(true);
  });

  it("projects the llm-pi-ai namespace a configured install writes", () => {
    // `llm-pi-ai.providers` holds one profile per configured provider, and each
    // profile may pin its own model list; 24 such profiles must still project.
    const providers = Object.fromEntries(
      Array.from({ length: 24 }, (_, index) => [`provider-${index}`, {
        displayName: `Provider ${index}`,
        apiKeyEnv: `PROVIDER_${index}_API_KEY`,
        api: "openai-completions",
        baseURL: `https://provider-${index}.example/v1`,
        models: Array.from({ length: 6 }, (_, model) => ({
          id: `model-${model}`,
          name: `Model ${model}`,
        })),
      }]),
    );

    const projected = projectNamespace(descriptor({
      ns: settingsNamespace("llm-pi-ai"),
      base: {},
      user: { providers },
      value: { providers: structuredClone(providers) },
      secrets: [],
    }), true);

    expect(Object.keys(projected.value.providers as object)).toHaveLength(24);
  });

  it("rejects a projection whose records could exceed the protocol scan guard", () => {
    const wideCollection = Object.fromEntries(
      Array.from(
        { length: MAX_COLLECTION_ENTRIES + 1 },
        (_, index) => [`field${index}`, index],
      ),
    );
    expect(() => projectNamespace(descriptor({ value: wideCollection }), true))
      .toThrow(/projection limit/);

    const deepCollection = Object.fromEntries(
      Array.from({ length: MAX_COLLECTION_ENTRIES }, (_, index) => [
        `group${index}`,
        Object.fromEntries(Array.from(
          { length: MAX_COLLECTION_ENTRIES },
          (_, leaf) => [`field${leaf}`, leaf],
        )),
      ]),
    );
    expect(() => projectNamespace(descriptor({ value: deepCollection }), true))
      .toThrow(/projection limit/);
  });
});

describe("settings errors", () => {
  it("maps conflicts with the authoritative actual revision", () => {
    expect(projectSettingsError(
      new SettingsConflictError(settingsNamespace("provider-test"), 3, 7),
      "provider-test",
    )).toEqual({
      code: "settings-conflict",
      message: expect.any(String),
      namespace: "provider-test",
      currentRevision: 7,
    });
  });

  it("maps rejected and cancelled operations without stack traces", () => {
    expect(projectSettingsError(new TypeError("invalid field"), "provider-test"))
      .toEqual({
        code: "settings-rejected",
        message: "invalid field",
        namespace: "provider-test",
      });
    expect(projectSettingsError(new DOMException("cancelled", "AbortError")))
      .toEqual({ code: "cancelled", message: "cancelled" });
    expect(projectSettingsError(
      Object.assign(new Error("superseded"), { name: "AbortError" }),
    )).toEqual({ code: "cancelled", message: "superseded" });
  });
});

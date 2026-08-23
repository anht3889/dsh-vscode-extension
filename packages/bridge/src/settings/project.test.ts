import { describe, expect, it } from "vitest";
import {
  SettingsConflictError,
  settingsNamespace,
  type SettingsDescriptor,
} from "@deepseek-ai/dsh-settings";
import { isOutboundMessage } from "@dsh-vscode/contract";
import { projectNamespace, projectSettingsError } from "./project.js";

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

  it("rejects a projection whose records could exceed the protocol scan guard", () => {
    const oversized = Object.fromEntries(
      Array.from({ length: 600 }, (_, index) => [`field${index}`, index]),
    );

    expect(() => projectNamespace(descriptor({ value: oversized }), true))
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

import { describe, it, expect } from "vitest";
import {
  isSettingsInboundCommand,
  isSettingsOutboundMessage,
  SETTINGS_WIRE_SCAN_NODE_LIMIT,
} from "./settings.js";
import { isInboundMessage, isOutboundMessage } from "./protocol.js";

const generalNamespace = {
  namespace: "permission",
  revision: 0,
  applies: "live" as const,
  writable: true,
  base: {},
  user: {},
  value: { defaultPreset: "workspace-write" },
  secrets: [],
};

describe("isSettingsInboundCommand", () => {
  it("accepts getSettingsSection", () => {
    expect(isSettingsInboundCommand({
      kind: "getSettingsSection",
      requestId: "s1",
      section: "general",
    })).toBe(true);
  });

  it("accepts mutateSettings", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 3,
      ops: [{ op: "set", path: ["defaultPreset"], value: "workspace-write" }],
    })).toBe(true);
  });

  it("accepts setCredential and unsetCredential", () => {
    expect(isSettingsInboundCommand({
      kind: "setCredential",
      requestId: "c1",
      ref: "DEEPSEEK_API_KEY",
      value: "sk-secret",
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "unsetCredential",
      requestId: "c2",
      ref: "DEEPSEEK_API_KEY",
    })).toBe(true);
  });

  it("accepts preset commands", () => {
    expect(isSettingsInboundCommand({
      kind: "copyAgentPreset",
      requestId: "p1",
      fromPresetId: "standard",
      presetId: "my-copy",
      name: "My Copy",
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "deleteAgentPreset",
      requestId: "p2",
      presetId: "mine",
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "readAgentPreset",
      requestId: "p3",
      presetId: "standard",
    })).toBe(true);
  });

  it("accepts resolveSettingsPath targets without arbitrary paths", () => {
    expect(isSettingsInboundCommand({
      kind: "resolveSettingsPath",
      requestId: "r1",
      target: { kind: "dsh-home" },
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "resolveSettingsPath",
      requestId: "r2",
      target: { kind: "settings-document", prepare: true },
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "resolveSettingsPath",
      requestId: "r3",
      target: { kind: "agent-preset", presetId: "mine" },
    })).toBe(true);
  });

  it("rejects empty request ids", () => {
    expect(isSettingsInboundCommand({
      kind: "getSettingsSection",
      requestId: "",
      section: "general",
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "",
      namespace: "permission",
      expectedRevision: 0,
      ops: [],
    })).toBe(false);
  });

  it("rejects mutateSettings with empty ops", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m-empty",
      namespace: "permission",
      expectedRevision: 0,
      ops: [],
    })).toBe(false);
  });

  it("rejects unknown sections", () => {
    expect(isSettingsInboundCommand({
      kind: "getSettingsSection",
      requestId: "s1",
      section: "extension",
    })).toBe(false);
  });

  it("rejects namespace names outside kebab-case", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "Permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"], value: "x" }],
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "bad_name",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"], value: "x" }],
    })).toBe(false);
  });

  it("rejects negative and non-integer revisions", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: -1,
      ops: [{ op: "set", path: ["defaultPreset"], value: "x" }],
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 1.5,
      ops: [{ op: "set", path: ["defaultPreset"], value: "x" }],
    })).toBe(false);
  });

  it("rejects empty paths and forbidden object keys", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: [], value: "x" }],
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "unset", path: [""] }],
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["__proto__"], value: "x" }],
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"], value: { constructor: "x" } }],
    })).toBe(false);
  });

  it("rejects malformed operation tags", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "replace", path: ["defaultPreset"], value: "x" }],
    })).toBe(false);
  });

  it("rejects empty credential values and invalid credential refs", () => {
    expect(isSettingsInboundCommand({
      kind: "setCredential",
      requestId: "c1",
      ref: "DEEPSEEK_API_KEY",
      value: "",
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "setCredential",
      requestId: "c1",
      ref: "bad-ref",
      value: "secret",
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "unsetCredential",
      requestId: "c1",
      ref: "also-bad",
    })).toBe(false);
  });

  it("rejects invalid preset ids", () => {
    expect(isSettingsInboundCommand({
      kind: "copyAgentPreset",
      requestId: "p1",
      fromPresetId: "standard",
      presetId: "Bad-ID",
      name: "Copy",
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "copyAgentPreset",
      requestId: "p1",
      fromPresetId: "Bad-ID",
      presetId: "copy",
      name: "Copy",
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "deleteAgentPreset",
      requestId: "p1",
      presetId: "",
    })).toBe(false);
  });

  it("rejects arbitrary path strings on inbound messages", () => {
    expect(isSettingsInboundCommand({
      kind: "resolveSettingsPath",
      requestId: "r1",
      target: { kind: "dsh-home" },
      path: "/etc/passwd",
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: "defaultPreset", value: "x" }],
    })).toBe(false);
  });

  it("rejects extra fields on mutation ops and resolve targets", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"], value: "x", extra: true }],
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "resolveSettingsPath",
      requestId: "r1",
      target: { kind: "dsh-home", path: "/etc/passwd" },
    })).toBe(false);
    expect(isSettingsInboundCommand({
      kind: "resolveSettingsPath",
      requestId: "r2",
      target: { kind: "settings-document", prepare: true, path: "/tmp" },
    })).toBe(false);
  });

  it("rejects set ops missing an own value property", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"] }],
    })).toBe(false);
  });

  it("accepts set ops whose own value is explicitly undefined or null", () => {
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"], value: undefined }],
    })).toBe(true);
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"], value: null }],
    })).toBe(true);
  });

  it("rejects cyclic and over-deep mutation values fail closed", () => {
    const cyclic: Record<string, unknown> = { label: "loop" };
    cyclic.self = cyclic;
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"], value: cyclic }],
    })).toBe(false);

    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 40; i += 1) {
      deep = { nested: deep };
    }
    expect(isSettingsInboundCommand({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 0,
      ops: [{ op: "set", path: ["defaultPreset"], value: deep }],
    })).toBe(false);
  });
});

describe("isSettingsOutboundMessage", () => {
  it("accepts settingsSection views for each section tag", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "general",
        namespaces: [generalNamespace],
        agentPresets: [{ id: "standard", label: "Standard", trust: "system" }],
        permissionPresets: [{ id: "workspace-write", label: "Workspace Write", dangerous: false }],
      },
    })).toBe(true);

    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "models",
        namespaces: [],
        providers: [],
        credentials: [{
          ref: "DEEPSEEK_API_KEY",
          set: true,
          source: "env",
          writable: false,
        }],
      },
    })).toBe(true);

    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "plugins",
        namespaces: [],
        configurable: [{
          namespace: "shell",
          label: "Shell",
          fields: [{ path: ["timeoutMs"], label: "Timeout", kind: "number" }],
        }],
        inventory: [{
          entryId: "shell",
          moduleName: "@deepseek-ai/dsh-shell",
          enabled: true,
          fiberPhase: "active",
        }],
      },
    })).toBe(true);

    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "agent-presets",
        namespace: generalNamespace,
        presets: [{
          id: "standard",
          trust: "system",
          removable: false,
          openable: true,
        }],
      },
    })).toBe(true);
  });

  it("requires a closed trust tag on general agent-preset choices", () => {
    const view = (agentPresets: unknown) => ({
      kind: "settingsSection" as const,
      requestId: "s1",
      view: {
        section: "general" as const,
        namespaces: [generalNamespace],
        agentPresets,
        permissionPresets: [
          { id: "workspace-write", label: "Workspace Write", dangerous: false },
        ],
      },
    });
    expect(isSettingsOutboundMessage(view([
      { id: "standard", label: "Standard", trust: "system" },
      { id: "mine", label: "Mine", trust: "user" },
    ]))).toBe(true);
    expect(isSettingsOutboundMessage(view([
      { id: "standard", label: "Standard" },
    ]))).toBe(false);
    expect(isSettingsOutboundMessage(view([
      { id: "standard", label: "Standard", trust: "root" },
    ]))).toBe(false);
  });

  it("accepts settingsMutation results", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsMutation",
      requestId: "m1",
      result: { ok: true, namespace: generalNamespace, restartRequired: true },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsMutation",
      requestId: "m1",
      result: {
        ok: false,
        error: { code: "settings-conflict", message: "stale", namespace: "permission", currentRevision: 4 },
      },
    })).toBe(true);
  });

  it("accepts an explicit settingsSection unavailable error and rejects mixed arms", () => {
    const error = {
      code: "settings-unavailable",
      message: "Models settings are not available",
    } as const;
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      error,
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      error,
      view: {
        section: "general",
        namespaces: [],
        agentPresets: [],
        permissionPresets: [],
      },
    })).toBe(false);
  });

  it("accepts settingsInvalidated", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsInvalidated",
      sections: ["general", "models"],
      reason: "document",
    })).toBe(true);
  });

  it("accepts agentPresetContent and settingsPath results", () => {
    expect(isSettingsOutboundMessage({
      kind: "agentPresetContent",
      requestId: "p1",
      result: { ok: true, presetId: "standard", trust: "system", content: "plugins: []" },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "agentPresetContent",
      requestId: "p1",
      result: { ok: false, error: { code: "preset-rejected", message: "missing" } },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsPath",
      requestId: "r1",
      result: { ok: true, path: "/home/user/.dsh", target: "dsh-home" },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsPath",
      requestId: "r1",
      result: { ok: false, error: { code: "settings-rejected", message: "no preset" } },
    })).toBe(true);
  });

  it("rejects empty request ids", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "",
      view: {
        section: "general",
        namespaces: [],
        agentPresets: [],
        permissionPresets: [],
      },
    })).toBe(false);
  });

  it("rejects malformed result tags and section tags", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsMutation",
      requestId: "m1",
      result: { ok: "yes" },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: { section: "unknown", namespaces: [] },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsInvalidated",
      sections: ["general"],
      reason: "unknown",
    })).toBe(false);
  });

  it("rejects any outbound credential value", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: { section: "models", credentialValue: "secret" },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "models",
        namespaces: [],
        providers: [],
        credentials: [{
          ref: "DEEPSEEK_API_KEY",
          set: true,
          source: "file",
          writable: true,
          value: "secret",
        }],
      },
    })).toBe(false);
  });

  it("rejects contradictory result arms and undeclared result fields", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsMutation",
      requestId: "m1",
      result: {
        ok: true,
        error: { code: "settings-conflict", message: "stale" },
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsMutation",
      requestId: "m1",
      result: {
        ok: false,
        error: { code: "settings-rejected", message: "no" },
        namespace: generalNamespace,
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "agentPresetContent",
      requestId: "p1",
      result: {
        ok: true,
        presetId: "standard",
        trust: "system",
        content: "x",
        error: { code: "preset-rejected", message: "no" },
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsPath",
      requestId: "r1",
      result: {
        ok: false,
        error: { code: "settings-rejected", message: "no" },
        path: "/tmp",
      },
    })).toBe(false);
  });

  it("rejects undeclared outbound message and section-view fields", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsInvalidated",
      sections: ["general"],
      reason: "document",
      requestId: "extra",
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "general",
        namespaces: [],
        agentPresets: [],
        permissionPresets: [],
        extra: true,
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "general",
        namespaces: [],
        agentPresets: [{ id: "standard", label: "Standard", trust: "system", prototype: "x" }],
        permissionPresets: [],
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "agent-presets",
        presets: [{
          id: "standard",
          trust: "system",
          removable: false,
          openable: true,
          constructor: "x",
        }],
      },
    })).toBe(false);
  });

  it("enforces closed credential records and rejects undeclared secret field names", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "models",
        namespaces: [],
        providers: [{
          id: "deepseek",
          namespace: "llm-deepseek",
          label: "DeepSeek",
          active: true,
          catalog: { kind: "ready" },
          credentialStatus: { kind: "none" },
          models: [],
          removable: true,
          fields: [],
          apiKey: "secret",
        }],
        credentials: [{
          ref: "DEEPSEEK_API_KEY",
          set: true,
          source: "file",
          writable: true,
        }],
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "models",
        namespaces: [],
        providers: [],
        credentials: [{
          ref: "DEEPSEEK_API_KEY",
          set: true,
          source: "file",
          writable: true,
        }],
      },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "models",
        namespaces: [],
        providers: [],
        credentials: [{
          ref: "DEEPSEEK_API_KEY",
          set: true,
          source: "file",
          writable: true,
          extra: true,
        }],
      },
    })).toBe(false);
  });

  it("rejects union settings fields without non-empty options", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "plugins",
        namespaces: [],
        configurable: [{
          namespace: "shell",
          label: "Shell",
          fields: [{ path: ["mode"], label: "Mode", kind: "union" }],
        }],
        inventory: [],
      },
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "plugins",
        namespaces: [],
        configurable: [{
          namespace: "shell",
          label: "Shell",
          fields: [{
            path: ["mode"],
            label: "Mode",
            kind: "union",
            options: [{ value: "local", label: "Local" }],
          }],
        }],
        inventory: [],
      },
    })).toBe(true);
  });

  it("accepts numeric schema step constraints and rejects undeclared constraints", () => {
    const view = (field: unknown) => ({
      section: "plugins",
      namespaces: [],
      configurable: [{
        namespace: "agent-loop",
        label: "Agent Loop",
        fields: [field],
      }],
      inventory: [],
    });
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "plugins",
      view: view({
        path: ["maxParallelToolCalls"],
        label: "Maximum parallel tool calls",
        kind: "number",
        min: 1,
        step: 1,
      }),
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "plugins",
      view: view({
        path: ["maxParallelToolCalls"],
        label: "Maximum parallel tool calls",
        kind: "number",
        integer: true,
      }),
    })).toBe(false);
  });

  it("closes plugin credential metadata without admitting values", () => {
    const view = (configurable: unknown[]) => ({
      section: "plugins",
      namespaces: [],
      configurable,
      inventory: [],
    });
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "plugins",
      view: view([{
        namespace: "web-search-deepseek",
        label: "Web Search",
        fields: [],
        credentialStatus: { kind: "ready" },
        credential: {
          ref: "DEEPSEEK_API_KEY",
          set: true,
          source: "env",
          writable: false,
        },
      }]),
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "plugins",
      view: view([{
        namespace: "web-search-deepseek",
        label: "Web Search",
        fields: [],
        credentialStatus: { kind: "ready" },
      }]),
    })).toBe(false);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "plugins",
      view: view([{
        namespace: "web-search-deepseek",
        label: "Web Search",
        fields: [],
        credentialStatus: { kind: "failed", message: "Credential metadata is unavailable" },
        credential: {
          ref: "DEEPSEEK_API_KEY",
          set: true,
          writable: true,
        },
      }]),
    })).toBe(false);
  });

  it("distinguishes dormant, ready, and failed provider catalogs", () => {
    const provider = () => ({
      namespace: "llm-pi-ai",
      label: "Provider",
      models: [],
      removable: false,
      fields: [],
      credentialStatus: { kind: "none" },
    });
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "models",
      view: {
        section: "models",
        namespaces: [],
        credentials: [],
        providers: [
          {
            ...provider(),
            id: "dormant",
            active: false,
            declared: true,
            catalog: { kind: "dormant" },
          },
          {
            ...provider(),
            id: "empty",
            active: true,
            catalog: { kind: "ready" },
          },
          {
            ...provider(),
            id: "failed",
            active: true,
            catalog: {
              kind: "failed",
              message: "Model catalog is unavailable",
            },
          },
        ],
      },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "models",
      view: {
        section: "models",
        namespaces: [],
        credentials: [],
        providers: [{
          ...provider(),
          id: "bad",
          active: true,
          catalog: { kind: "failed", message: "no", stack: "secret" },
        }],
      },
    })).toBe(false);
  });

  it("rejects every active and catalog status mismatch", () => {
    const provider = (
      active: boolean,
      catalog: unknown,
      models: unknown[] = [],
    ) => ({
      id: "provider",
      namespace: "llm-pi-ai",
      label: "Provider",
      active,
      catalog,
      credentialStatus: { kind: "none" },
      models,
      removable: false,
      fields: [],
    });
    const accepts = (candidate: unknown) => isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "models",
      view: {
        section: "models",
        namespaces: [],
        credentials: [],
        providers: [candidate],
      },
    });

    expect(accepts(provider(true, { kind: "dormant" }))).toBe(false);
    expect(accepts(provider(false, { kind: "ready" }))).toBe(false);
    expect(accepts(provider(false, {
      kind: "failed",
      message: "Model catalog is unavailable",
    }))).toBe(false);
    expect(accepts(provider(false, { kind: "dormant" }, [{
      id: "unexpected",
      label: "Unexpected",
    }]))).toBe(false);
    expect(accepts(provider(true, {
      kind: "failed",
      message: "Model catalog is unavailable",
    }, [{
      id: "unexpected",
      label: "Unexpected",
    }]))).toBe(false);
  });

  it("closes provider credential metadata status and success state", () => {
    const common = {
      namespace: "llm-deepseek",
      label: "DeepSeek",
      active: true,
      catalog: { kind: "ready" },
      models: [],
      removable: false,
      fields: [],
    };
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "models",
      view: {
        section: "models",
        namespaces: [],
        credentials: [],
        providers: [{
          ...common,
          id: "failed",
          credentialStatus: {
            kind: "failed",
            message: "Credential metadata is unavailable",
          },
        }],
      },
    })).toBe(true);
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "models",
      view: {
        section: "models",
        namespaces: [],
        credentials: [],
        providers: [{
          ...common,
          id: "ready-without-state",
          credentialStatus: { kind: "ready" },
        }],
      },
    })).toBe(false);
  });

  it("rejects nested credential-like keys inside namespace records", () => {
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "general",
        namespaces: [{
          namespace: "permission",
          revision: 0,
          applies: "live",
          writable: true,
          base: {},
          user: {},
          value: { token: "secret" },
          secrets: [],
        }],
        agentPresets: [],
        permissionPresets: [],
      },
    })).toBe(false);
  });

  it("admits a legitimate payload filling the wire scan budget", () => {
    // Four nodes per model entry: the record plus `id`, `label`, `contextWindow`.
    const models = Array.from(
      { length: Math.floor((SETTINGS_WIRE_SCAN_NODE_LIMIT - 64) / 4) },
      (_, index) => ({
        id: `model-${index}`,
        label: `Model ${index}`,
        contextWindow: 128_000,
      }),
    );

    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "models",
        namespaces: [],
        providers: [{
          id: "openrouter",
          namespace: "llm-pi-ai",
          label: "OpenRouter",
          active: true,
          catalog: { kind: "ready" },
          credentialStatus: { kind: "none" },
          models,
          removable: true,
          fields: [],
        }],
        credentials: [],
      },
    })).toBe(true);
  });

  it("still fails closed beyond the wire scan budget", () => {
    const models = Array.from(
      { length: SETTINGS_WIRE_SCAN_NODE_LIMIT },
      (_, index) => ({ id: `model-${index}`, label: `Model ${index}` }),
    );

    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "models",
        namespaces: [],
        providers: [{
          id: "openrouter",
          namespace: "llm-pi-ai",
          label: "OpenRouter",
          active: true,
          catalog: { kind: "ready" },
          credentialStatus: { kind: "none" },
          models,
          removable: true,
          fields: [],
        }],
        credentials: [],
      },
    })).toBe(false);
  });

  it("rejects cyclic namespace object layers fail closed", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(isSettingsOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "general",
        namespaces: [{
          namespace: "permission",
          revision: 0,
          applies: "live",
          writable: true,
          base: cyclic,
          user: {},
          value: {},
          secrets: [],
        }],
        agentPresets: [],
        permissionPresets: [],
      },
    })).toBe(false);
  });
});

describe("protocol v5 settings integration", () => {
  it("routes settings kinds through protocol validators", () => {
    expect(isInboundMessage({
      kind: "getSettingsSection",
      requestId: "s1",
      section: "plugins",
    })).toBe(true);
    expect(isOutboundMessage({
      kind: "settingsInvalidated",
      sections: ["plugins"],
      reason: "plugins",
    })).toBe(true);
  });
});

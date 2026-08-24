import { describe, it, expect } from "vitest";
import { PROTOCOL_VERSION, isOutboundMessage, isInboundMessage } from "./protocol.js";

describe("isOutboundMessage", () => {
  it("accepts a hello message", () => {
    expect(isOutboundMessage({ kind: "hello", version: PROTOCOL_VERSION, cwd: "/tmp", dshVersion: "0.1.0" })).toBe(true);
  });
  it("rejects an inbound message", () => {
    expect(isOutboundMessage({ kind: "submit", text: "hi" })).toBe(false);
  });
  it("returns false (does not throw) for null/undefined/primitives", () => {
    expect(isOutboundMessage(null)).toBe(false);
    expect(isOutboundMessage(undefined)).toBe(false);
    expect(isOutboundMessage("hello")).toBe(false);
    expect(isOutboundMessage(42)).toBe(false);
  });
});

describe("isInboundMessage", () => {
  it("accepts a submit message", () => {
    expect(isInboundMessage({
      kind: "submit",
      requestId: "submit-1",
      mode: "queue",
      text: "hi",
    })).toBe(true);
  });
  it("rejects submit without correlation or delivery mode", () => {
    expect(isInboundMessage({ kind: "submit", text: "hi" })).toBe(false);
    expect(isInboundMessage({
      kind: "submit",
      requestId: "",
      mode: "queue",
      text: "hi",
    })).toBe(false);
    expect(isInboundMessage({
      kind: "submit",
      requestId: "submit-1",
      mode: "later",
      text: "hi",
    })).toBe(false);
  });
  it("rejects garbage", () => {
    expect(isInboundMessage({ kind: "nope" })).toBe(false);
  });
  it("returns false (does not throw) for null/undefined/primitives", () => {
    expect(isInboundMessage(null)).toBe(false);
    expect(isInboundMessage(undefined)).toBe(false);
    expect(isInboundMessage("submit")).toBe(false);
  });
});

describe("protocol v4 slash messages", () => {
  it("accepts listSlashItems and executeSlashCommand inbound messages", () => {
    expect(isInboundMessage({ kind: "listSlashItems", requestId: "r1" })).toBe(true);
    expect(isInboundMessage({
      kind: "executeSlashCommand",
      line: "/goal ship it",
      images: [{ mediaType: "image/png", data: "AA==" }],
    })).toBe(true);
  });

  it("accepts slashItems outbound messages", () => {
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "r1",
      items: [
        {
          source: "command",
          name: "goal",
          description: "Set the goal",
          behavior: "command-input",
          hint: "<objective>",
          acceptsImages: false,
        },
        {
          source: "skill",
          name: "brainstorming",
          description: "Design before implementation",
          behavior: "insert",
        },
      ],
      availability: { commands: true, skills: true },
    })).toBe(true);
  });

  it("rejects empty request ids", () => {
    expect(isInboundMessage({ kind: "listSlashItems", requestId: "" })).toBe(false);
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "",
      items: [],
      availability: { commands: true, skills: true },
    })).toBe(false);
  });

  it("rejects non-slash execution lines", () => {
    expect(isInboundMessage({ kind: "executeSlashCommand", line: "goal ship it" })).toBe(false);
    expect(isInboundMessage({ kind: "executeSlashCommand", line: "  goal ship it" })).toBe(false);
  });

  it("rejects unknown source and behavior", () => {
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "r1",
      items: [{ source: "unknown", name: "x", description: "d", behavior: "execute" }],
      availability: { commands: true, skills: true },
    })).toBe(false);
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "r1",
      items: [{ source: "command", name: "x", description: "d", behavior: "unknown" }],
      availability: { commands: true, skills: true },
    })).toBe(false);
  });

  it("rejects empty names", () => {
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "r1",
      items: [{ source: "command", name: "", description: "d", behavior: "execute" }],
      availability: { commands: true, skills: true },
    })).toBe(false);
  });

  it("rejects skill behaviors other than insert", () => {
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "r1",
      items: [{ source: "skill", name: "x", description: "d", behavior: "execute" }],
      availability: { commands: true, skills: true },
    })).toBe(false);
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "r1",
      items: [{ source: "skill", name: "x", description: "d", behavior: "command-input", hint: "h" }],
      availability: { commands: true, skills: true },
    })).toBe(false);
  });

  it("rejects command behavior insert", () => {
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "r1",
      items: [{ source: "command", name: "x", description: "d", behavior: "insert" }],
      availability: { commands: true, skills: true },
    })).toBe(false);
  });

  it("rejects missing command-input hint", () => {
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "r1",
      items: [{ source: "command", name: "x", description: "d", behavior: "command-input" }],
      availability: { commands: true, skills: true },
    })).toBe(false);
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "r1",
      items: [{ source: "command", name: "x", description: "d", behavior: "command-input", hint: "" }],
      availability: { commands: true, skills: true },
    })).toBe(false);
  });

  it("rejects a forbidden hint on skill or execute items", () => {
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "r1",
      items: [{ source: "skill", name: "x", description: "d", behavior: "insert", hint: "nope" }],
      availability: { commands: true, skills: true },
    })).toBe(false);
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "r1",
      items: [{ source: "command", name: "x", description: "d", behavior: "execute", hint: "nope" }],
      availability: { commands: true, skills: true },
    })).toBe(false);
  });

  it("rejects a non-boolean command-input acceptsImages", () => {
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "r1",
      items: [{
        source: "command",
        name: "x",
        description: "d",
        behavior: "command-input",
        hint: "h",
        acceptsImages: "yes",
      }],
      availability: { commands: true, skills: true },
    })).toBe(false);
  });

  it("rejects acceptsImages outside command-input", () => {
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "r1",
      items: [{ source: "command", name: "x", description: "d", behavior: "execute", acceptsImages: true }],
      availability: { commands: true, skills: true },
    })).toBe(false);
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "r1",
      items: [{ source: "skill", name: "x", description: "d", behavior: "insert", acceptsImages: false }],
      availability: { commands: true, skills: true },
    })).toBe(false);
  });

  it("rejects malformed availability", () => {
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "r1",
      items: [],
      availability: { commands: true },
    })).toBe(false);
    expect(isOutboundMessage({
      kind: "slashItems",
      requestId: "r1",
      items: [],
      availability: { commands: "yes", skills: true },
    })).toBe(false);
  });

  it("rejects malformed image attachments on executeSlashCommand", () => {
    expect(isInboundMessage({
      kind: "executeSlashCommand",
      line: "/goal ship it",
      images: [{ mediaType: "image/svg+xml", data: "AA==" }],
    })).toBe(false);
    expect(isInboundMessage({
      kind: "executeSlashCommand",
      line: "/goal ship it",
      images: "not-an-array",
    })).toBe(false);
  });
});

describe("protocol v6", () => {
  it("uses protocol v6", () => {
    expect(PROTOCOL_VERSION).toBe(6);
  });

  it("accepts settings inbound and outbound messages", () => {
    expect(isInboundMessage({
      kind: "mutateSettings",
      requestId: "m1",
      namespace: "permission",
      expectedRevision: 3,
      ops: [{ op: "set", path: ["defaultPreset"], value: "workspace-write" }],
    })).toBe(true);
    expect(isOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: {
        section: "general",
        namespaces: [],
        agentPresets: [],
        permissionPresets: [],
      },
    })).toBe(true);
    expect(isOutboundMessage({
      kind: "settingsSection",
      requestId: "s1",
      view: { section: "models", credentialValue: "secret" },
    })).toBe(false);
  });

  it("accepts all five new inbound settings kinds", () => {
    expect(isInboundMessage({
      kind: "getSettingsCapabilities",
      requestId: "c1",
    })).toBe(true);
    expect(isInboundMessage({
      kind: "getMcpServer",
      requestId: "d1",
      serverId: "docs-id",
    })).toBe(true);
    expect(isInboundMessage({
      kind: "getMcpLogs",
      requestId: "l1",
      serverId: "docs-id",
    })).toBe(true);
    expect(isInboundMessage({
      kind: "runMcpOperation",
      requestId: "o1",
      operation: { kind: "connectServer", serverId: "docs-id" },
    })).toBe(true);
    expect(isInboundMessage({
      kind: "setWebSearchConfig",
      requestId: "w1",
      catalog: { engine: null, engines: [] },
      secrets: [],
    })).toBe(true);
  });

  it("accepts all five new outbound settings kinds", () => {
    expect(isOutboundMessage({
      kind: "settingsCapabilities",
      sections: [],
    })).toBe(true);
    expect(isOutboundMessage({
      kind: "mcpServer",
      requestId: "d1",
      result: {
        ok: false,
        error: { code: "settings-unavailable", message: "MCP is unavailable" },
      },
    })).toBe(true);
    expect(isOutboundMessage({
      kind: "mcpLogs",
      requestId: "l1",
      result: {
        ok: false,
        error: { code: "settings-unavailable", message: "MCP is unavailable" },
      },
    })).toBe(true);
    expect(isOutboundMessage({
      kind: "mcpOperation",
      requestId: "o1",
      result: { ok: true },
    })).toBe(true);
    expect(isOutboundMessage({
      kind: "webSearchMutation",
      requestId: "w1",
      result: {
        ok: false,
        error: {
          code: "settings-unavailable",
          message: "Web Search is unavailable",
        },
      },
    })).toBe(true);
  });

  it("rejects an incomplete mcpServer message", () => {
    expect(isOutboundMessage({ kind: "mcpServer" })).toBe(false);
  });

  it("accepts only closed correlated submit results", () => {
    expect(isOutboundMessage({
      kind: "submitResult",
      requestId: "submit-1",
      result: { ok: true },
    })).toBe(true);
    expect(isOutboundMessage({
      kind: "submitResult",
      requestId: "submit-2",
      result: { ok: false, detail: "image admission failed" },
    })).toBe(true);
    expect(isOutboundMessage({
      kind: "submitResult",
      requestId: "",
      result: { ok: true },
    })).toBe(false);
    expect(isOutboundMessage({
      kind: "submitResult",
      requestId: "submit-1",
      result: { ok: true, detail: "extra" },
    })).toBe(false);
  });

  it("accepts reference search and raster image submit records", () => {
    expect(isInboundMessage({
      kind: "listFileReferences", query: "src", requestId: "r1",
    })).toBe(true);
    expect(isOutboundMessage({
      kind: "fileReferences", requestId: "r1",
      items: [{ path: "src", kind: "directory" }],
    })).toBe(true);
    expect(isInboundMessage({
      kind: "submit",
      requestId: "submit-image",
      mode: "queue",
      text: "describe this",
      images: [{ mediaType: "image/png", data: "AQ==", name: "a.png" }],
    })).toBe(true);
  });

  it("rejects invalid image media types at the wire boundary", () => {
    expect(isInboundMessage({
      kind: "submit",
      text: "",
      images: [{ mediaType: "image/svg+xml", data: "PHN2Zz4=" }],
    })).toBe(false);
  });

  it("accepts ready, sessions, catalog, permissions, context, history", () => {
    expect(isOutboundMessage({
      kind: "ready",
      sessionId: "s1",
      cwd: "/tmp",
      models: { current: { provider: "p", model: "m" }, models: [] },
      permissions: { current: "workspace-write", presets: [] },
    })).toBe(true);
    expect(isOutboundMessage({ kind: "sessions", items: [] })).toBe(true);
    expect(isOutboundMessage({ kind: "sessions", items: [], available: false })).toBe(true);
    expect(isOutboundMessage({
      kind: "catalog",
      current: { provider: "p", model: "m" },
      models: [],
    })).toBe(true);
    expect(isOutboundMessage({
      kind: "permissions",
      current: "workspace-write",
      presets: [{ id: "workspace-write", label: "Workspace Write" }],
    })).toBe(true);
    expect(isOutboundMessage({ kind: "context", used: 10, window: 100 })).toBe(true);
    expect(isOutboundMessage({ kind: "history", sessionId: "s1", events: [] })).toBe(true);
  });

  it("accepts listSessions, newSession, selectModel, selectPermission, resume", () => {
    expect(isInboundMessage({ kind: "listSessions" })).toBe(true);
    expect(isInboundMessage({ kind: "newSession" })).toBe(true);
    expect(isInboundMessage({ kind: "selectModel", provider: "p", model: "m" })).toBe(true);
    expect(isInboundMessage({ kind: "selectPermission", preset: "read-only" })).toBe(true);
    expect(isInboundMessage({ kind: "resume", sessionId: "s1" })).toBe(true);
    expect(isInboundMessage({
      kind: "submit",
      requestId: "submit-permission",
      mode: "queue",
      text: "hi",
      permission: "workspace-write",
    })).toBe(true);
  });
});

describe("session event view", () => {
  const base = { type: "tool/call", seq: 1, time: 0, data: { callId: "c1", name: "bash", arguments: "{}" } };

  it("accepts an event without view", () => {
    expect(isOutboundMessage({ kind: "event", sessionId: "s1", event: base })).toBe(true);
  });

  it("accepts a call view", () => {
    expect(isOutboundMessage({
      kind: "event",
      sessionId: "s1",
      event: {
        ...base,
        view: { for: "call", view: { card: "generic", title: "Run bash" } },
      },
    })).toBe(true);
  });

  it("rejects an unknown view.for", () => {
    expect(isOutboundMessage({
      kind: "event",
      sessionId: "s1",
      event: { ...base, view: { for: "other", view: { card: "generic", title: "x" } } },
    })).toBe(false);
  });

  it("rejects a malformed history event view", () => {
    expect(isOutboundMessage({
      kind: "history",
      sessionId: "s1",
      events: [{ ...base, view: { for: "call" } }],
    })).toBe(false);
  });
});

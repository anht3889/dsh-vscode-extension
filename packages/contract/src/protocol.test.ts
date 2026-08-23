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
    expect(isInboundMessage({ kind: "submit", text: "hi" })).toBe(true);
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

describe("protocol v4", () => {
  it("uses protocol v4", () => {
    expect(PROTOCOL_VERSION).toBe(4);
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
    expect(isInboundMessage({ kind: "submit", text: "hi", permission: "workspace-write" })).toBe(true);
  });
});

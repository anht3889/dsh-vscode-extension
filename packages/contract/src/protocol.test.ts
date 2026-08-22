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

describe("protocol v2", () => {
  it("PROTOCOL_VERSION is 2", () => {
    expect(PROTOCOL_VERSION).toBe(2);
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

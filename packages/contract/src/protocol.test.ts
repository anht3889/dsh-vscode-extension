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

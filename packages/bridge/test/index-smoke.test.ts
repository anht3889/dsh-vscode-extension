import { describe, it, expect } from "vitest";
import { name, inject, Config, apply } from "../src/index.js";

describe("index plugin entry", () => {
  it("exports the cordis plugin surface", () => {
    expect(name).toBe("vscode-runner");
    expect(inject).toContain("agents");
    expect(inject).toContain("agentDefaultModel");
    expect(inject).toContain("sessions");
    expect(inject).toContain("userQuestions");
    expect(inject).toContain("appExit");
    expect(Config).toBeDefined();
    expect(typeof apply).toBe("function");
  });
});

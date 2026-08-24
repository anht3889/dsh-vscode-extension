import { describe, expect, it } from "vitest";
import { toolSummary } from "./toolSummary.js";

describe("toolSummary", () => {
  it("prefers terminal description then title then parsed arg keys", () => {
    expect(toolSummary({
      name: "bash",
      argsRaw: "{\"command\":\"ls\"}",
      callView: { card: "terminal", title: "ls", description: "List files" },
    })).toEqual({ title: "ls", summary: "List files" });
    expect(toolSummary({ name: "read", argsRaw: "{\"path\":\"/a.ts\"}" }))
      .toEqual({ title: "read", summary: "/a.ts" });
    expect(toolSummary({ name: "mystery", argsRaw: "{" }))
      .toEqual({ title: "mystery", summary: "" });
  });

  it("uses the first common string argument in priority order", () => {
    expect(toolSummary({
      name: "search",
      argsRaw: JSON.stringify({
        url: "https://example.com",
        pattern: "*.ts",
        query: "ignored",
        path: "/src",
        command: "pnpm test",
      }),
    })).toEqual({ title: "search", summary: "pnpm test" });
  });

  it("uses presenter titles without requiring a terminal description", () => {
    expect(toolSummary({
      name: "write",
      argsRaw: "{\"path\":\"/a.ts\"}",
      callView: { card: "generic", title: "Write a.ts" },
      resultView: { card: "generic", title: "Written" },
    })).toEqual({ title: "Write a.ts", summary: "/a.ts" });
  });
});

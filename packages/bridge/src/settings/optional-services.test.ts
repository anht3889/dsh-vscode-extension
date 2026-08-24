import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import {
  MCP_REQUIRED_MEMBERS,
  WEB_SEARCH_REQUIRED_MEMBERS,
  probeMcpService,
  probeWebSearchService,
} from "./optional-services.js";

function completeService(members: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(members.map((member) => [member, () => {}]));
}

describe("optional service probes", () => {
  it("reports absent when neither optional service is mounted", () => {
    const ctx = new Context();

    expect(probeMcpService(ctx)).toEqual({ state: "absent" });
    expect(probeWebSearchService(ctx)).toEqual({ state: "absent" });
  });

  it("reports missing required members in declaration order", () => {
    const ctx = new Context();
    const partialMcp = completeService(MCP_REQUIRED_MEMBERS);
    delete partialMcp.getTools;
    delete partialMcp.setSecrets;
    const partialWebSearch = completeService(WEB_SEARCH_REQUIRED_MEMBERS);
    delete partialWebSearch.putCatalog;
    ctx.provide("mcp", partialMcp as never);
    ctx.provide("webSearchManager", partialWebSearch as never);

    expect(probeMcpService(ctx)).toEqual({
      state: "incomplete",
      missing: ["getTools", "setSecrets"],
    });
    expect(probeWebSearchService(ctx)).toEqual({
      state: "incomplete",
      missing: ["putCatalog"],
    });
  });

  it("accepts complete services without optional notification members", () => {
    const ctx = new Context();
    ctx.provide("mcp", completeService(MCP_REQUIRED_MEMBERS) as never);
    ctx.provide(
      "webSearchManager",
      completeService(WEB_SEARCH_REQUIRED_MEMBERS) as never,
    );

    const mcp = probeMcpService(ctx);
    const webSearch = probeWebSearchService(ctx);

    expect(mcp.state).toBe("ready");
    expect(mcp.state === "ready" && mcp.service.describeSecrets).toBeUndefined();
    expect(webSearch.state).toBe("ready");
    expect(
      webSearch.state === "ready" && webSearch.service.onChanged,
    ).toBeUndefined();
  });
});

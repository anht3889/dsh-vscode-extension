import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import {
  MCP_REQUIRED_MEMBERS,
  WEB_SEARCH_REQUIRED_MEMBERS,
} from "./optional-services.js";
import { createCapabilityWatcher } from "./capabilities.js";

function completeService(members: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(members.map((member) => [member, () => {}]));
}

describe("optional capability watcher", () => {
  it("reports mounted services in fixed navigation order", async () => {
    const webSearchContext = new Context();
    webSearchContext.provide(
      "webSearchManager",
      completeService(WEB_SEARCH_REQUIRED_MEMBERS) as never,
    );
    const webSearchOnly = createCapabilityWatcher(webSearchContext);
    expect(webSearchOnly.sections()).toEqual(["web-search"]);
    webSearchOnly.dispose();
    await webSearchContext.fiber.dispose();

    const bothContext = new Context();
    bothContext.provide(
      "webSearchManager",
      completeService(WEB_SEARCH_REQUIRED_MEMBERS) as never,
    );
    bothContext.provide("mcp", completeService(MCP_REQUIRED_MEMBERS) as never);
    const both = createCapabilityWatcher(bothContext);
    expect(both.sections()).toEqual(["mcp", "web-search"]);
    both.dispose();
    await bothContext.fiber.dispose();
  });

  it("notifies once for appearance, replacement removal, and replacement", async () => {
    const ctx = new Context();
    const watcher = createCapabilityWatcher(ctx);
    const changes: string[][] = [];
    watcher.onChange((sections) => changes.push(sections));

    const first = ctx.provide("mcp", completeService(MCP_REQUIRED_MEMBERS) as never);
    watcher.sections();
    await first();
    const second = ctx.provide("mcp", completeService(MCP_REQUIRED_MEMBERS) as never);

    expect(changes).toEqual([["mcp"], [], ["mcp"]]);

    await second();
    watcher.dispose();
    await ctx.fiber.dispose();
  });

  it("deduplicates unchanged capability sets and stops after disposal", async () => {
    const ctx = new Context();
    const watcher = createCapabilityWatcher(ctx, vi.fn());
    const listener = vi.fn();
    watcher.onChange(listener);
    expect(watcher.sections()).toEqual([]);

    const incomplete = completeService(MCP_REQUIRED_MEMBERS);
    delete incomplete.list;
    const disposeIncomplete = ctx.provide("mcp", incomplete as never);
    watcher.sections();
    watcher.sections();
    expect(listener).not.toHaveBeenCalled();

    watcher.dispose();
    await disposeIncomplete();
    ctx.provide("mcp", completeService(MCP_REQUIRED_MEMBERS) as never);
    expect(listener).not.toHaveBeenCalled();
    await ctx.fiber.dispose();
  });

  it("warns once per incomplete registration generation", async () => {
    const ctx = new Context();
    const warn = vi.fn();
    const watcher = createCapabilityWatcher(ctx, warn);
    const incomplete = completeService(MCP_REQUIRED_MEMBERS);
    delete incomplete.getTools;

    const first = ctx.provide("mcp", incomplete as never);
    watcher.sections();
    watcher.sections();
    expect(warn).toHaveBeenCalledTimes(1);

    await first();
    const second = ctx.provide("mcp", incomplete as never);
    watcher.sections();
    expect(warn).toHaveBeenCalledTimes(2);

    await second();
    watcher.dispose();
    await ctx.fiber.dispose();
  });
});

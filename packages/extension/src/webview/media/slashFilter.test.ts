import type { SlashMenuItem } from "@dsh-vscode/contract";
import { describe, expect, it } from "vitest";
import { filterSlashItems } from "./slashFilter.js";

const items: readonly SlashMenuItem[] = [
  { source: "command", name: "plan", description: "Plan mode", behavior: "execute" },
  { source: "command", name: "goal", description: "Set goal", behavior: "command-input", hint: "<objective>" },
  { source: "command", name: "compact", description: "Compact context", behavior: "execute" },
  { source: "command", name: "checkpoint", description: "Save checkpoint", behavior: "execute" },
  { source: "command", name: "qx-long", description: "Long name", behavior: "execute" },
  { source: "command", name: "q-xylophone", description: "Boundary name", behavior: "execute" },
  { source: "skill", name: "brainstorming", description: "Design first", behavior: "insert" },
  { source: "skill", name: "commit", description: "Commit helper", behavior: "insert" },
  { source: "skill", name: "BrainWave", description: "Mixed case", behavior: "insert" },
];

function names(groups: ReturnType<typeof filterSlashItems>): string[] {
  return groups.flatMap(group => group.items.map(item => item.name));
}

function groupSources(groups: ReturnType<typeof filterSlashItems>): string[] {
  return groups.map(group => group.source);
}

describe("filterSlashItems pinned cases", () => {
  it("ranks command fuzzy matches with prefix bias", () => {
    expect(names(filterSlashItems(items, { query: "cp", position: "leading" })))
      .toEqual(["compact", "checkpoint"]);
  });

  it("includes prefix-matched skills", () => {
    expect(names(filterSlashItems(items, { query: "brain", position: "leading" })))
      .toContain("brainstorming");
  });

  it("excludes command-input items inline", () => {
    expect(names(filterSlashItems(items, { query: "", position: "inline" })))
      .not.toContain("goal");
  });
});

describe("filterSlashItems grouping and ordering", () => {
  it("returns commands before skills", () => {
    expect(groupSources(filterSlashItems(items, { query: "", position: "leading" })))
      .toEqual(["command", "skill"]);
  });

  it("omits empty groups", () => {
    expect(filterSlashItems(
      items.filter(item => item.source === "command"),
      { query: "brain", position: "leading" },
    )).toEqual([]);
  });

  it("returns all commands and skills for an empty leading query", () => {
    expect(names(filterSlashItems(items, { query: "", position: "leading" })))
      .toEqual([
        "plan", "goal", "compact", "checkpoint", "qx-long", "q-xylophone",
        "brainstorming", "commit", "BrainWave",
      ]);
  });
});

describe("filterSlashItems command ranking", () => {
  it("ranks prefix matches before later subsequence matches", () => {
    expect(names(filterSlashItems(items, { query: "qx", position: "leading" })))
      .toEqual(["qx-long", "q-xylophone"]);
  });

  it("matches case-insensitively for commands", () => {
    expect(names(filterSlashItems(items, { query: "CP", position: "leading" })))
      .toEqual(["compact", "checkpoint"]);
  });

  it("preserves catalog order for stable ties", () => {
    const tied: readonly SlashMenuItem[] = [
      { source: "command", name: "alpha", description: "", behavior: "execute" },
      { source: "command", name: "beta", description: "", behavior: "execute" },
    ];
    expect(names(filterSlashItems(tied, { query: "", position: "leading" })))
      .toEqual(["alpha", "beta"]);
  });

  it("prefers exact name matches", () => {
    const exact: readonly SlashMenuItem[] = [
      { source: "command", name: "cp", description: "", behavior: "execute" },
      { source: "command", name: "compact", description: "", behavior: "execute" },
    ];
    expect(names(filterSlashItems(exact, { query: "cp", position: "leading" })))
      .toEqual(["cp", "compact"]);
  });
});

describe("filterSlashItems skill filtering", () => {
  it("filters skills by case-insensitive prefix", () => {
    expect(names(filterSlashItems(items, { query: "brain", position: "leading" })))
      .toEqual(["brainstorming", "BrainWave"]);
  });

  it("includes skills inline but still excludes command-input commands", () => {
    const inlineNames = names(filterSlashItems(items, { query: "", position: "inline" }));
    expect(inlineNames).toContain("brainstorming");
    expect(inlineNames).not.toContain("goal");
  });
});

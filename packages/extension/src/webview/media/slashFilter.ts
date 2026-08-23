import type { SlashMenuItem } from "@dsh-vscode/contract";
import type { SlashToken } from "./slashToken.js";

export interface SlashGroup {
  source: "command" | "skill";
  items: SlashMenuItem[];
}

type CommandTier = 0 | 1 | 2;

interface CommandRank {
  tier: CommandTier;
  firstIndex: number;
  gaps: number;
  index: number;
}

function isCommandInput(item: SlashMenuItem): boolean {
  return item.source === "command" && item.behavior === "command-input";
}

function fuzzyAlignment(
  nameLower: string,
  queryLower: string,
): { firstIndex: number; gaps: number } | undefined {
  if (queryLower === "") return { firstIndex: 0, gaps: 0 };
  let best: { firstIndex: number; gaps: number } | undefined;
  for (let start = 0; start < nameLower.length; start++) {
    if (nameLower.charAt(start) !== queryLower.charAt(0)) continue;
    let queryIndex = 1;
    let last = start;
    let gaps = 0;
    for (let nameIndex = start + 1; nameIndex < nameLower.length && queryIndex < queryLower.length; nameIndex++) {
      if (nameLower.charAt(nameIndex) !== queryLower.charAt(queryIndex)) continue;
      gaps += nameIndex - last - 1;
      last = nameIndex;
      queryIndex++;
    }
    if (queryIndex !== queryLower.length) continue;
    const alignment = { firstIndex: start, gaps };
    if (
      best === undefined
      || alignment.firstIndex < best.firstIndex
      || (alignment.firstIndex === best.firstIndex && alignment.gaps < best.gaps)
    ) {
      best = alignment;
    }
  }
  return best;
}

function commandRank(item: SlashMenuItem, query: string, index: number): CommandRank | undefined {
  const nameLower = item.name.toLocaleLowerCase();
  const queryLower = query.toLocaleLowerCase();
  if (queryLower === "") return { tier: 0, firstIndex: 0, gaps: 0, index };
  if (nameLower === queryLower) return { tier: 0, firstIndex: 0, gaps: 0, index };
  if (nameLower.startsWith(queryLower)) return { tier: 1, firstIndex: 0, gaps: 0, index };
  const alignment = fuzzyAlignment(nameLower, queryLower);
  if (alignment === undefined) return undefined;
  return { tier: 2, firstIndex: alignment.firstIndex, gaps: alignment.gaps, index };
}

function compareCommandRank(left: CommandRank, right: CommandRank): number {
  return left.tier - right.tier
    || left.firstIndex - right.firstIndex
    || left.gaps - right.gaps
    || left.index - right.index;
}

/** Filter and rank slash menu items for the active token query and position. */
export function filterSlashItems(
  items: readonly SlashMenuItem[],
  token: Pick<SlashToken, "query" | "position">,
): SlashGroup[] {
  const queryLower = token.query.toLocaleLowerCase();
  const rankedCommands: { item: SlashMenuItem; rank: CommandRank }[] = [];
  const skills: SlashMenuItem[] = [];

  items.forEach((item, index) => {
    if (item.source === "command") {
      if (token.position === "inline" && isCommandInput(item)) return;
      const rank = commandRank(item, token.query, index);
      if (rank !== undefined) rankedCommands.push({ item, rank });
      return;
    }
    if (item.name.toLocaleLowerCase().startsWith(queryLower)) skills.push(item);
  });

  rankedCommands.sort((left, right) => compareCommandRank(left.rank, right.rank));

  const groups: SlashGroup[] = [];
  if (rankedCommands.length > 0) {
    groups.push({ source: "command", items: rankedCommands.map(entry => entry.item) });
  }
  if (skills.length > 0) {
    groups.push({ source: "skill", items: skills });
  }
  return groups;
}

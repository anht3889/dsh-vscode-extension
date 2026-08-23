export interface SlashToken {
  query: string;
  position: "leading" | "inline";
  start: number;
  end: number;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const WHITESPACE = /\s/u;

function boundaryOk(draft: string, index: number): boolean {
  if (index === 0) return true;
  const prev = draft.charAt(index - 1);
  if (WHITESPACE.test(prev)) return true;
  if (WORD_CHAR.test(prev)) return false;
  if (prev === "@") return false;
  if (prev === "/") return false;
  if (prev === ":" && index >= 2 && !WHITESPACE.test(draft.charAt(index - 2))) return false;
  return true;
}

function commentOpener(draft: string, index: number, caret: number): boolean {
  return index + 1 < caret && draft.charAt(index + 1) === "/";
}

/**
 * Detect an active slash token at the caret. Scans backward from the caret,
 * rejects URL and word-adjacent slashes, and classifies leading vs inline
 * position from whitespace-only prefix before the slash.
 */
export function activeSlashToken(text: string, caret: number): SlashToken | undefined {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text.charAt(i);
    if (WHITESPACE.test(ch)) return undefined;
    if (ch !== "/") continue;
    if (!boundaryOk(text, i)) continue;
    if (commentOpener(text, i, caret)) continue;
    return {
      query: text.slice(i + 1, caret),
      position: text.slice(0, i).trim() === "" ? "leading" : "inline",
      start: i,
      end: caret,
    };
  }
  return undefined;
}

/** Replace a slash token span and return the new draft with caret after the replacement. */
export function replaceSlashToken(
  text: string,
  token: Pick<SlashToken, "start" | "end">,
  replacement: string,
): { text: string; caret: number } {
  const nextText = text.slice(0, token.start) + replacement + text.slice(token.end);
  return { text: nextText, caret: token.start + replacement.length };
}

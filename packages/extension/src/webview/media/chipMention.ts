/**
 * Terminal mention formatting for composer chips.
 *
 * The copied harness grammar in `fileMention.ts` leaves a quoted directory
 * mention open (`@"my folder/`) so inline completion can descend another level.
 * A chip mention is terminal: it is submitted verbatim, so an open quote would
 * reach the model as a malformed token. This wrapper closes that quote and
 * changes nothing else, keeping the copied grammar at parity with the harness.
 *
 * @module dsh-vscode/chipMention
 */

import type { FileReferenceItem } from "@dsh-vscode/contract";
import { formatFileMention } from "./fileMention.js";

/**
 * Format a picked path as the canonical mention stored on a chip.
 * @param candidate - selected file or directory.
 * @param preserveQuote - retain a quote the user opened at the trigger token.
 * @returns the submitted mention, or `undefined` for a path the grammar refuses.
 */
export function formatChipMention(
  candidate: FileReferenceItem,
  preserveQuote: boolean,
): string | undefined {
  const mention = formatFileMention(candidate, preserveQuote);
  if (mention === undefined) return undefined;
  // The grammar rejects `"` inside a path, so an unterminated quote can only be
  // the directory case the harness leaves open for further completion.
  return mention.startsWith('@"') && !mention.endsWith('"')
    ? `${mention}"`
    : mention;
}

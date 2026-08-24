import type {
  ToolCallView,
  ToolResultView,
} from "@dsh-vscode/contract";

const SUMMARY_KEYS = ["command", "path", "query", "pattern", "url"] as const;

/** Derive concise generic tool-row labels from presenter intent and raw input. */
export function toolSummary(input: {
  name: string;
  argsRaw: string;
  callView?: ToolCallView;
  resultView?: ToolResultView;
}): { title: string; summary: string } {
  let summary = "";
  if (
    input.callView?.card === "terminal" &&
    input.callView.description !== undefined
  ) {
    summary = input.callView.description;
  } else {
    try {
      const parsed: unknown = JSON.parse(input.argsRaw);
      if (typeof parsed === "object" && parsed !== null) {
        const args = parsed as Record<string, unknown>;
        for (const key of SUMMARY_KEYS) {
          if (typeof args[key] === "string") {
            summary = args[key];
            break;
          }
        }
      }
    } catch {
      // Partial and malformed streamed arguments have no generic summary.
    }
  }

  return {
    title: input.callView?.title ?? input.resultView?.title ?? input.name,
    summary,
  };
}

import React, { useState } from "react";
import type { ToolResultView } from "@dsh-vscode/contract";
import type { TimelineRow } from "../store.js";
import { toolSummary } from "../toolSummary.js";
import { DiffView } from "./DiffView.js";

type ToolTimelineRow = Extract<TimelineRow, { kind: "tool" }>;

interface ToolRowProps {
  row: ToolTimelineRow;
}

function resultPayload(view: ToolResultView | undefined): unknown {
  switch (view?.card) {
    case "terminal":
      return view.output;
    case "generic":
      return view.content;
    case "search":
      return view.shape === "matches" ? view.files : view.paths;
    case "read":
      return view.lines;
    case "web":
      return view.kind === "search"
        ? view.answer ?? view.sources
        : { url: view.url, statusCode: view.statusCode };
    case "diff":
    case undefined:
      return undefined;
  }
}

function displayPayload(payload: unknown): string | undefined {
  if (payload === undefined) return undefined;
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

/** Render one expandable tool call with presenter output and row-local diffs. */
export function ToolRow({ row }: ToolRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const { title, summary } = toolSummary(row);
  const result = displayPayload(resultPayload(row.resultView)) ?? row.resultText;

  return (
    <article className="dsh-tool-row" aria-label={title}>
      <button
        className="dsh-row-toggle"
        aria-label={title}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="dsh-row-heading">
          <span className="dsh-row-title">{title}</span>
          {summary === "" ? null : (
            <span className="dsh-row-summary">{summary}</span>
          )}
        </span>
        <span className={`dsh-row-status dsh-row-status-${row.status}`}>
          {row.status}
        </span>
        <span className="dsh-row-caret" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded ? (
        <div className="dsh-row-details">
          <pre className="dsh-row-raw">{row.argsRaw}</pre>
          {result === undefined ? null : (
            <pre className="dsh-row-result">{result}</pre>
          )}
          {row.diffs.map((diff, index) => (
            <DiffView key={`${diff.path}-${index}`} diff={diff} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

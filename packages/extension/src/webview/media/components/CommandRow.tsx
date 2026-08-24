import React, { useState } from "react";
import type { TimelineRow } from "../store.js";

type CommandTimelineRow = Extract<TimelineRow, { kind: "command" }>;

interface CommandRowProps {
  row: CommandTimelineRow;
}

/** Render one expandable slash-command invocation and its output. */
export function CommandRow({ row }: CommandRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const args = row.args?.trimStart() ?? "";
  const invocation = `/${row.name}${args === "" ? "" : ` ${args}`}`;

  return (
    <article className="dsh-command-row" aria-label="Command">
      <button
        className="dsh-row-toggle"
        aria-label="Command"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="dsh-row-title">{invocation}</span>
        <span className={`dsh-row-status dsh-row-status-${row.status}`}>
          {row.status}
        </span>
        <span className="dsh-row-caret" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && row.output !== undefined ? (
        <pre className="dsh-row-result">{row.output}</pre>
      ) : null}
    </article>
  );
}

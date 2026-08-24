import React, { useId, useState } from "react";
import type { TimelineRow } from "../store.js";

type CommandTimelineRow = Extract<TimelineRow, { kind: "command" }>;

interface CommandRowProps {
  row: CommandTimelineRow;
}

/** Render one expandable slash-command invocation and its output. */
export function CommandRow({ row }: CommandRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const outputId = useId();
  const args = row.args?.trimStart() ?? "";
  const invocation = `/${row.name}${args === "" ? "" : ` ${args}`}`;

  return (
    <article className="dsh-command-row" aria-label="Command">
      <button
        className="dsh-row-toggle"
        aria-expanded={expanded}
        aria-controls={outputId}
        onClick={() => setExpanded((value) => !value)}
      >
        {/* The whitespace between spans separates the words of the toggle's
            accessible name; flex layout drops whitespace-only text nodes. */}
        <span className="dsh-row-title">{invocation}</span>{" "}
        <span className={`dsh-row-status dsh-row-status-${row.status}`}>
          {row.status}
        </span>
        <span className="dsh-row-caret" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      <pre
        className="dsh-row-result"
        id={outputId}
        hidden={!expanded || row.output === undefined}
      >
        {expanded ? row.output : null}
      </pre>
    </article>
  );
}

import React, { useEffect, useRef, useState } from "react";

interface ThinkingRowProps {
  text: string;
  running: boolean;
}

/** Return the first non-empty line of text. */
export function firstLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
}

/** Return the latest non-empty line of text. */
export function latestLine(text: string): string {
  return [...text.split(/\r?\n/)]
    .reverse()
    .find((line) => line.trim() !== "") ?? "";
}

/** Render one expandable model-reasoning timeline row. */
export function ThinkingRow({ text, running }: ThinkingRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(running);
  const wasRunning = useRef(running);

  useEffect(() => {
    if (wasRunning.current && !running) setExpanded(false);
    wasRunning.current = running;
  }, [running]);

  const summary = running ? latestLine(text) : firstLine(text);

  return (
    <article className="dsh-think" aria-label="Think">
      <button
        className="dsh-row-toggle"
        aria-label="Think"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="dsh-row-title">Think</span>
        <span className="dsh-row-caret" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      <div className="dsh-row-summary">{expanded ? text : summary}</div>
    </article>
  );
}

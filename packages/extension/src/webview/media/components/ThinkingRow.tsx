import React, { useEffect, useId, useRef, useState } from "react";

interface ThinkingRowProps {
  text: string;
  active: boolean;
}

/** Render one expandable disclosure for a turn's combined reasoning. */
export function ThinkingRow({ text, active }: ThinkingRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(active);
  const textId = useId();
  const wasActive = useRef(active);
  const title = active ? "Thinking" : "Thought";

  useEffect(() => {
    if (wasActive.current && !active) setExpanded(false);
    wasActive.current = active;
  }, [active]);

  return (
    <article className="dsh-think" aria-label={title}>
      <button
        className="dsh-row-toggle"
        aria-expanded={expanded}
        aria-controls={textId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="dsh-row-title">{title}</span>
        <span className="dsh-row-caret" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      <div className="dsh-row-summary" id={textId} hidden={!expanded}>
        {expanded ? text : null}
      </div>
    </article>
  );
}

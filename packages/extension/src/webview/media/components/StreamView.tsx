import React, { useCallback, useEffect, useRef } from "react";
import type { ToolDiff } from "@dsh-vscode/contract";
import type { TimelineRow } from "../store.js";
import { Markdown } from "./Markdown.js";
import { ToolCard } from "./ToolCard.js";

interface StreamViewProps {
  timeline: TimelineRow[];
  diffs: ToolDiff[];
  onApply(): void;
}

/** Distance from the bottom, in px, that still counts as "following the tail". */
const STICK_THRESHOLD_PX = 24;

export function StreamView({
  timeline,
  diffs,
  onApply,
}: StreamViewProps): JSX.Element {
  const view = useRef<HTMLElement>(null);
  // Streamed deltas grow the timeline continuously; follow the tail only while
  // the reader is already at it, so scrolling back to re-read is not yanked away.
  const stick = useRef(true);

  useEffect(() => {
    const element = view.current;
    if (element === null || !stick.current) return;
    element.scrollTop = element.scrollHeight;
  });

  const onScroll = useCallback((): void => {
    const element = view.current;
    if (element === null) return;
    const remaining =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    stick.current = remaining < STICK_THRESHOLD_PX;
  }, []);

  return (
    <main className="dsh-stream" ref={view} onScroll={onScroll}>
      {timeline.map((row, i) => {
        if (row.kind !== "user" && row.kind !== "assistant") return null;
        return (
          <article
            className={`dsh-turn dsh-turn-${row.kind}`}
            key={`${row.kind}-${row.seq}-${i}`}
            aria-label={row.kind === "user" ? "You" : "DeepSeek Harness"}
          >
            {row.kind === "assistant" ? (
              <Markdown source={row.text} />
            ) : (
              <div className="dsh-turn-text">{row.text}</div>
            )}
          </article>
        );
      })}
      {diffs.map((diff, i) => (
        <ToolCard key={`d-${i}`} diff={diff} />
      ))}
      {diffs.length > 0 ? (
        <button className="dsh-apply" onClick={onApply} title="Apply all diffs to the editor">
          Apply all diffs
        </button>
      ) : null}
    </main>
  );
}

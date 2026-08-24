import React, { useCallback, useEffect, useRef } from "react";
import type { ToolDiff } from "@dsh-vscode/contract";
import type { TimelineRow } from "../store.js";
import { CommandRow } from "./CommandRow.js";
import { Markdown } from "./Markdown.js";
import { ThinkingRow } from "./ThinkingRow.js";
import { ToolRow } from "./ToolRow.js";

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
        const key = `${row.kind}-${row.seq}-${i}`;
        switch (row.kind) {
          case "user":
          case "assistant":
            return (
              <article
                className={`dsh-turn dsh-turn-${row.kind}`}
                key={key}
                aria-label={row.kind === "user" ? "You" : "DeepSeek Harness"}
              >
                {row.kind === "assistant" ? (
                  <Markdown source={row.text} />
                ) : (
                  <div className="dsh-turn-text">{row.text}</div>
                )}
              </article>
            );
          case "thinking":
            return (
              <ThinkingRow key={key} text={row.text} running={row.running} />
            );
          case "tool":
            return <ToolRow key={key} row={row} />;
          case "command":
            return <CommandRow key={key} row={row} />;
          default: {
            const exhaustive: never = row;
            return exhaustive;
          }
        }
      })}
      {diffs.length > 0 ? (
        <button className="dsh-apply" onClick={onApply} title="Apply all diffs to the editor">
          Apply all diffs
        </button>
      ) : null}
    </main>
  );
}

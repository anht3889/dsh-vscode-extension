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

type VisibleRow = Exclude<TimelineRow, { kind: "thinking" }>;

type ProjectedRow =
  | VisibleRow
  | { kind: "thinking-group"; key: string; text: string; active: boolean };

function turnIsActive(rows: TimelineRow[]): boolean {
  return rows.some((row) => (
    (row.kind === "thinking" && row.running)
    || (row.kind === "assistant" && row.streaming)
    || (row.kind === "tool" && row.status === "running")
    || (row.kind === "command" && row.status === "running")
  ));
}

function thinkingGroup(
  key: string,
  turn: TimelineRow[],
): ProjectedRow | undefined {
  const segments = turn.filter((row) => row.kind === "thinking");
  if (segments.length === 0) return undefined;
  return {
    kind: "thinking-group",
    key,
    text: segments.map((row) => row.text).join("\n\n"),
    active: turnIsActive(turn),
  };
}

function appendTurn(
  projected: ProjectedRow[],
  key: string,
  turn: TimelineRow[],
): void {
  const group = thinkingGroup(key, turn);
  if (group !== undefined) projected.push(group);
  for (const row of turn) {
    if (row.kind !== "thinking") projected.push(row);
  }
}

/** Lift each turn's thinking segments into one disclosure under that turn's user message. */
export function projectTimeline(timeline: TimelineRow[]): ProjectedRow[] {
  const projected: ProjectedRow[] = [];
  let i = 0;
  while (i < timeline.length) {
    const row = timeline[i]!;
    if (row.kind === "user") {
      i += 1;
      const turn: TimelineRow[] = [];
      while (i < timeline.length && timeline[i]!.kind !== "user") {
        turn.push(timeline[i]!);
        i += 1;
      }
      projected.push(row);
      appendTurn(projected, `thinking-${row.seq}`, turn);
      continue;
    }
    const lead: TimelineRow[] = [];
    while (i < timeline.length && timeline[i]!.kind !== "user") {
      lead.push(timeline[i]!);
      i += 1;
    }
    appendTurn(projected, "thinking-lead", lead);
  }
  return projected;
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
      {projectTimeline(timeline).map((entry, i) => {
        if (entry.kind === "thinking-group") {
          return (
            <ThinkingRow
              key={entry.key}
              text={entry.text}
              active={entry.active}
            />
          );
        }
        const key = `${entry.kind}-${entry.seq}-${i}`;
        switch (entry.kind) {
          case "user":
          case "assistant":
            return (
              <article
                className={`dsh-turn dsh-turn-${entry.kind}`}
                key={key}
                aria-label={entry.kind === "user" ? "You" : "DeepSeek Harness"}
              >
                {entry.kind === "assistant" ? (
                  <Markdown source={entry.text} />
                ) : (
                  <div className="dsh-turn-text">{entry.text}</div>
                )}
              </article>
            );
          case "tool":
            return <ToolRow key={key} row={entry} />;
          case "command":
            return <CommandRow key={key} row={entry} />;
          default: {
            const exhaustive: never = entry;
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

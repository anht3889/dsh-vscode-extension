import React from "react";
import type { ToolDiff } from "@dsh-vscode/contract";
import { ToolCard } from "./ToolCard.js";

interface StreamViewProps {
  stream: string[];
  diffs: ToolDiff[];
  onApply(): void;
}

export function StreamView({ stream, diffs, onApply }: StreamViewProps): JSX.Element {
  return (
    <main className="dsh-stream">
      {stream.map((text, i) => (
        <div className="dsh-bubble" key={`s-${i}`}>
          {text}
        </div>
      ))}
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

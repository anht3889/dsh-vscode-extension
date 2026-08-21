import React from "react";
import type { ToolDiff } from "@dsh-vscode/contract";
import { ToolCard } from "./ToolCard.js";

interface StreamViewProps {
  stream: string[];
  diffs: ToolDiff[];
}

export function StreamView({ stream, diffs }: StreamViewProps): JSX.Element {
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
    </main>
  );
}

import React, { useState } from "react";
import type { ToolDiff } from "@dsh-vscode/contract";
import { DiffView } from "./DiffView.js";

interface ToolCardProps {
  diff: ToolDiff;
}

export function ToolCard({ diff }: ToolCardProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="dsh-toolcard">
      <button className="dsh-toolcard-toggle" onClick={() => setOpen((v) => !v)}>
        <span className="dsh-toolcard-path">{diff.path}</span>
        <span className="dsh-toolcard-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open ? <DiffView diff={diff} /> : null}
    </div>
  );
}

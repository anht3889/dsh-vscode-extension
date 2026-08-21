import React from "react";
import type { ToolDiff } from "@dsh-vscode/contract";

interface DiffViewProps {
  diff: ToolDiff;
}

/** Minimal two-column (old / new) unified-diff rendering of a `ToolDiff`. */
export function DiffView({ diff }: DiffViewProps): JSX.Element {
  return (
    <table className="dsh-diff">
      <tbody>
        <tr className="dsh-diff-old">
          <td className="dsh-diff-sign">−</td>
          <td className="dsh-diff-cell">
            <pre>{diff.oldText}</pre>
          </td>
        </tr>
        <tr className="dsh-diff-new">
          <td className="dsh-diff-sign">+</td>
          <td className="dsh-diff-cell">
            <pre>{diff.newText}</pre>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

import React, { useCallback, useState } from "react";
import type { AskAnswerWire } from "@dsh-vscode/contract";
import type { ApprovalState } from "../store.js";

interface ApprovalBannerProps {
  approval: ApprovalState;
  onAnswer(askId: string, answered: AskAnswerWire): void;
}

export function ApprovalBanner({ approval, onAnswer }: ApprovalBannerProps): JSX.Element {
  const [custom, setCustom] = useState<Record<string, string>>({});

  const respond = useCallback(
    (selected: string[]): void => {
      const id = approval.questions[0]?.id;
      if (id === undefined) return;
      const answered: AskAnswerWire = {
        answers: [{ id, selected, custom: custom[id] }],
      };
      onAnswer(approval.askId, answered);
    },
    [approval, custom, onAnswer],
  );

  const question = approval.questions[0];

  return (
    <div className="dsh-approval">
      {question ? (
        <>
          <div className="dsh-approval-question">
            <strong>{question.header ?? "Approval required"}</strong>
            <p>{question.question}</p>
            {question.detail ? <p className="dsh-approval-detail">{question.detail}</p> : null}
          </div>
          <div className="dsh-approval-options">
            {question.options?.map((opt) => (
              <button
                key={opt.label}
                className="dsh-approval-option"
                title={opt.description}
                onClick={() => respond([opt.label])}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {question.options === undefined || question.options.length === 0 ? (
            <input
              className="dsh-approval-input"
              placeholder="Custom answer…"
              value={custom[question.id] ?? ""}
              onChange={(e) => setCustom((c) => ({ ...c, [question.id]: e.target.value }))}
            />
          ) : null}
          <div className="dsh-approval-actions">
            <button className="dsh-approval-approve" onClick={() => respond(["Approve"])}>
              Approve
            </button>
            <button className="dsh-approval-reject" onClick={() => respond(["Reject"])}>
              Reject
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

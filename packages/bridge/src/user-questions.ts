import { randomUUID } from "node:crypto";
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionRequest,
  UserQuestionProvider,
} from "@deepseek-ai/dsh-user-questions";
import type { AskQuestionWire } from "@dsh-vscode/contract";
import type { Io } from "./io.js";

/** A `UserQuestionProvider` that also lets the caller settle a pending ask by id. */
export interface ResolvableUserQuestionProvider extends UserQuestionProvider {
  /** Settle the pending `ask()` for `askId` (invoked by the command dispatcher on inbound `answer`). */
  resolve(askId: string, answered: AskUserQuestionAnswer): void;
}

interface Pending { resolve(answered: AskUserQuestionAnswer): void; }

function mapQuestions(questions: AskUserQuestionItem[]): AskQuestionWire[] {
  // `intent` is deliberately not propagated: AskQuestionWire has no representation for it, and it affects presentation only (never the answer protocol).
  return questions.map((q) => ({
    id: q.id,
    question: q.question,
    ...(q.detail !== undefined ? { detail: q.detail } : {}),
    ...(q.header !== undefined ? { header: q.header } : {}),
    ...(q.options !== undefined
      ? { options: q.options.map((o) => ({ label: o.label, ...(o.description !== undefined ? { description: o.description } : {}) })) }
      : {}),
    ...(q.multiSelect !== undefined ? { multiSelect: q.multiSelect } : {}),
  }));
}

export function createUserQuestionProvider(
  io: Io,
  onAnswer?: (askId: string, answered: AskUserQuestionAnswer) => void,
): ResolvableUserQuestionProvider {
  const pending = new Map<string, Pending>();

  return {
    ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
      const askId = randomUUID();
      const promise = new Promise<AskUserQuestionAnswer>((resolve) => {
        pending.set(askId, { resolve });
      });
      io.send({ kind: "ask", askId, questions: mapQuestions(request.questions) });
      return promise;
    },

    resolve(askId: string, answered: AskUserQuestionAnswer): void {
      const entry = pending.get(askId);
      if (!entry) return;
      pending.delete(askId);
      entry.resolve(answered);
      onAnswer?.(askId, answered);
    },
  };
}

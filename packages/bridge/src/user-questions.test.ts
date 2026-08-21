import { describe, it, expect, vi } from "vitest";
import type { AskUserQuestionAnswer } from "@deepseek-ai/dsh-user-questions";
import type { Io, OutboundMessage } from "./io.js";
import { createUserQuestionProvider } from "./user-questions.js";

function makeIo(): { io: Io; sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = [];
  const io: Io = {
    send(msg) {
      sent.push(msg);
    },
    onCommand() {},
    close() {},
  };
  return { io, sent };
}

describe("createUserQuestionProvider", () => {
  it("emits an ask message and settles the returned promise when resolve is called", async () => {
    const { io, sent } = makeIo();
    const onAnswer = vi.fn<(askId: string, answered: AskUserQuestionAnswer) => void>();
    const provider = createUserQuestionProvider(io, onAnswer);

    const ansPromise = provider.ask({
      questions: [
        {
          id: "q1",
          question: "Approve this change?",
          header: "Review",
          options: [{ label: "yes" }, { label: "no" }],
        },
      ],
    });

    // The ask request emits exactly one outbound "ask" message carrying the questions.
    expect(sent).toHaveLength(1);
    const askMsg = sent[0];
    expect(askMsg.kind).toBe("ask");
    if (askMsg.kind !== "ask") return; // narrow for TS
    expect(askMsg.questions).toHaveLength(1);
    expect(askMsg.questions[0].id).toBe("q1");
    expect(askMsg.questions[0].question).toBe("Approve this change?");
    expect(askMsg.questions[0].options).toEqual([{ label: "yes" }, { label: "no" }]);

    // Delivering the matching answer via resolve() settles the pending promise.
    const answered: AskUserQuestionAnswer = {
      answers: [{ id: "q1", selected: ["yes"] }],
    };
    provider.resolve(askMsg.askId, answered);

    await expect(ansPromise).resolves.toEqual(answered);
    expect(onAnswer).toHaveBeenCalledWith(askMsg.askId, answered);
  });

  it("allocates a unique askId per ask and resolves the right pending promise", async () => {
    const { io, sent } = makeIo();
    const provider = createUserQuestionProvider(io);

    const first = provider.ask({ questions: [{ id: "a", question: "A?" }] });
    const second = provider.ask({ questions: [{ id: "b", question: "B?" }] });

    const [m1, m2] = sent;
    expect(m1.kind).toBe("ask");
    expect(m2.kind).toBe("ask");
    if (m1.kind !== "ask" || m2.kind !== "ask") return;
    expect(m1.askId).not.toBe(m2.askId);

    const a2: AskUserQuestionAnswer = { answers: [{ id: "b", selected: ["x"] }] };
    const a1: AskUserQuestionAnswer = { answers: [{ id: "a", selected: ["y"] }] };

    // Resolve out of order: each askId maps to its own pending promise.
    provider.resolve(m2.askId, a2);
    provider.resolve(m1.askId, a1);

    await expect(first).resolves.toEqual(a1);
    await expect(second).resolves.toEqual(a2);
  });
});

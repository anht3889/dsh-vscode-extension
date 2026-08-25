// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamView } from "./StreamView.js";
import type { TimelineRow } from "../store.js";

function assistant(text: string, streaming = false): TimelineRow {
  return { kind: "assistant", seq: 0, text, streaming };
}

afterEach(cleanup);

describe("StreamView", () => {
  it("renders assistant markdown as real elements", () => {
    render(
      <StreamView
        timeline={[assistant("## Plan\n\n- step **one**\n\n`inline`")]}
        diffs={[]}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Plan");
    expect(screen.getByRole("listitem")).toBeVisible();
    expect(screen.getByText("one").tagName).toBe("STRONG");
    expect(screen.getByText("inline").tagName).toBe("CODE");
  });

  it("shows a user turn verbatim rather than as markdown", () => {
    render(
      <StreamView
        timeline={[{ kind: "user", seq: 0, text: "## not a heading" }]}
        diffs={[]}
        onApply={vi.fn()}
      />,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("## not a heading")).toBeVisible();
  });

  it("copies a fenced block's source to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(
      <StreamView
        timeline={[assistant('```ts\nconst a = "<b>";\n```')]}
        diffs={[]}
        onApply={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Copy code" });
    fireEvent.click(button);

    expect(writeText).toHaveBeenCalledWith('const a = "<b>";\n');
    await waitFor(() => expect(button).toHaveTextContent("Copied"));
  });

  it("reports a failed copy instead of claiming success", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });

    render(
      <StreamView timeline={[assistant("```\nx\n```")]} diffs={[]} onApply={vi.fn()} />,
    );
    const button = screen.getByRole("button", { name: "Copy code" });
    fireEvent.click(button);

    await waitFor(() => expect(button).toHaveTextContent("Copy failed"));
  });

  it("keeps the apply action for accumulated diffs", () => {
    const onApply = vi.fn();
    render(
      <StreamView
        timeline={[assistant("done", true)]}
        diffs={[{ path: "/x/a.ts", oldText: "a", newText: "b" }]}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply all diffs" }));
    expect(onApply).toHaveBeenCalled();
  });

  it("groups a turn's thinking under the user message as one disclosure", () => {
    render(
      <StreamView
        timeline={[
          { kind: "user", seq: 1, text: "please edit" },
          { kind: "thinking", seq: 2, text: "plan the edit", running: false },
          {
            kind: "tool",
            seq: 3,
            callId: "call-1",
            name: "read",
            argsRaw: "{\"path\":\"/a.ts\"}",
            status: "ok",
            diffs: [],
          },
          { kind: "thinking", seq: 4, text: "review the result", running: false },
          { kind: "assistant", seq: 5, text: "answer", streaming: false },
        ]}
        diffs={[]}
        onApply={vi.fn()}
      />,
    );
    const stream = screen.getByRole("main");
    const labels = Array.from(stream.children).map(
      (element) => element.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["You", "Thought", "read", "DeepSeek Harness"]);
    expect(screen.getByRole("button", { name: "Thought" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("plan the edit")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Thought" }));
    const reasoning = screen.getByText(/plan the edit/);
    expect(reasoning).toHaveTextContent("review the result");
  });

  it("keeps Thinking expanded until the current response finishes", () => {
    const timeline: TimelineRow[] = [
      { kind: "user", seq: 1, text: "hello" },
      { kind: "thinking", seq: 2, text: "drafting", running: false },
      { kind: "assistant", seq: 3, text: "answer", streaming: true },
    ];
    const { rerender } = render(
      <StreamView timeline={timeline} diffs={[]} onApply={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Thinking" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("drafting")).toBeVisible();

    rerender(
      <StreamView
        timeline={[
          timeline[0],
          timeline[1],
          { kind: "assistant", seq: 3, text: "answer", streaming: false },
        ]}
        diffs={[]}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Thought" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("drafting")).toBeNull();
  });

  it("does not show Apply all for row-local diffs alone", () => {
    render(
      <StreamView
        timeline={[
          {
            kind: "tool",
            seq: 1,
            callId: "call-1",
            name: "edit",
            argsRaw: "{}",
            status: "ok",
            diffs: [{ path: "/a.ts", oldText: "a", newText: "b" }],
          },
        ]}
        diffs={[]}
        onApply={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Apply all diffs" })).toBeNull();
  });
});

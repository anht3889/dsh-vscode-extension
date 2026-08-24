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

  it("does not render thinking rows yet", () => {
    render(
      <StreamView
        timeline={[
          { kind: "thinking", seq: 1, text: "private reasoning", running: true },
          assistant("visible answer"),
        ]}
        diffs={[]}
        onApply={vi.fn()}
      />,
    );
    expect(screen.queryByText("private reasoning")).toBeNull();
    expect(screen.getByText("visible answer")).toBeVisible();
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineRow } from "../store.js";
import { ToolRow } from "./ToolRow.js";

type ToolTimelineRow = Extract<TimelineRow, { kind: "tool" }>;

const baseRow: ToolTimelineRow = {
  kind: "tool",
  seq: 1,
  callId: "call-1",
  name: "read",
  argsRaw: "{\"path\":\"/src/a.ts\"}",
  status: "ok",
  resultText: "fallback result",
  diffs: [],
};

/** A result payload that records every read of its only field. */
function countingPayload(): { payload: unknown; reads: () => number } {
  let reads = 0;
  return {
    payload: {
      get detail(): string {
        reads += 1;
        return "payload detail";
      },
    },
    reads: () => reads,
  };
}

function toggle(name: RegExp | string): HTMLElement {
  return screen.getByRole("button", { name });
}

afterEach(cleanup);

describe("ToolRow", () => {
  it.each(["running", "ok", "error", "stopped"] as const)(
    "shows its title, summary, and %s status while collapsed",
    (status) => {
      render(<ToolRow row={{ ...baseRow, status }} />);

      expect(toggle(/read/)).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText("/src/a.ts")).toBeVisible();
      expect(screen.getByText(status)).toBeVisible();
      expect(screen.queryByText("fallback result")).toBeNull();
    },
  );

  it("names the toggle by what it shows and points it at the details region", () => {
    render(<ToolRow row={baseRow} />);

    const button = toggle("read /src/a.ts ok");
    const details = document.getElementById(
      button.getAttribute("aria-controls") ?? "",
    );
    expect(details).not.toBeNull();
    expect(details).not.toBeVisible();
    expect(screen.getByLabelText("read", { selector: "article" })).toContainElement(
      details,
    );

    fireEvent.click(button);
    expect(details).toBeVisible();
  });

  it("shows malformed raw arguments and falls back to result text when expanded", () => {
    render(<ToolRow row={{ ...baseRow, argsRaw: "{broken" }} />);
    fireEvent.click(toggle(/read/));

    expect(screen.getByText("{broken")).toBeVisible();
    expect(screen.getByText("fallback result")).toBeVisible();
  });

  it("prefers terminal presenter output to result text", () => {
    render(
      <ToolRow
        row={{
          ...baseRow,
          callView: {
            card: "terminal",
            title: "pnpm test",
            description: "Run tests",
          },
          resultView: {
            card: "terminal",
            output: "Tests passed\n",
            exitCode: 0,
          },
        }}
      />,
    );

    expect(screen.getByText("Run tests")).toBeVisible();
    fireEvent.click(toggle(/pnpm test/));
    expect(screen.getByText(/Tests passed/)).toBeVisible();
    expect(screen.queryByText("fallback result")).toBeNull();
  });

  it("renders generic presenter content when available", () => {
    render(
      <ToolRow
        row={{
          ...baseRow,
          resultView: {
            card: "generic",
            content: ["plain", { count: 2 }],
          },
        }}
      />,
    );
    fireEvent.click(toggle(/read/));

    expect(screen.getByText(/plain/)).toBeVisible();
    expect(screen.getByText(/"count": 2/)).toBeVisible();
    expect(screen.queryByText("fallback result")).toBeNull();
  });

  it("keeps row-local diffs hidden until expanded", () => {
    render(
      <ToolRow
        row={{
          ...baseRow,
          diffs: [{ path: "/src/a.ts", oldText: "old", newText: "new" }],
        }}
      />,
    );

    expect(screen.queryByText("old")).toBeNull();
    fireEvent.click(toggle(/read/));
    expect(screen.getByText("/src/a.ts")).toBeVisible();
    expect(screen.getByText("old")).toBeVisible();
    expect(screen.getByText("new")).toBeVisible();
  });

  it("leaves a collapsed result payload untouched and formats it once expanded", () => {
    const { payload, reads } = countingPayload();
    const row: ToolTimelineRow = {
      ...baseRow,
      resultView: { card: "generic", content: [payload] },
    };
    const { rerender } = render(<ToolRow row={row} />);

    expect(reads()).toBe(0);

    fireEvent.click(toggle(/read/));
    expect(screen.getByText(/payload detail/)).toBeVisible();
    const formatted = reads();
    expect(formatted).toBeGreaterThan(0);

    // A streamed delta elsewhere in the timeline rerenders every row with the
    // same row object; that must not reformat this payload.
    rerender(<ToolRow row={row} />);
    expect(reads()).toBe(formatted);
  });

  it("refreshes the summary, status, and result when the row changes", () => {
    const { rerender } = render(<ToolRow row={baseRow} />);
    fireEvent.click(toggle(/read/));

    rerender(
      <ToolRow
        row={{
          ...baseRow,
          argsRaw: "{\"path\":\"/src/b.ts\"}",
          status: "error",
          resultText: "later result",
        }}
      />,
    );

    expect(toggle(/read/)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("/src/b.ts")).toBeVisible();
    expect(screen.getByText("error")).toBeVisible();
    expect(screen.getByText("later result")).toBeVisible();
    expect(screen.queryByText("fallback result")).toBeNull();
  });
});

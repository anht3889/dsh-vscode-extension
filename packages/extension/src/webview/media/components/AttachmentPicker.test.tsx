// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachmentPicker } from "./AttachmentPicker.js";

function renderPicker(
  props: Partial<React.ComponentProps<typeof AttachmentPicker>> = {},
): ReturnType<typeof render> {
  return render(
    <AttachmentPicker
      query=""
      items={[{ path: "src", kind: "directory" }]}
      unavailable={false}
      onQuery={vi.fn()}
      onPick={vi.fn()}
      onAttachImage={vi.fn()}
      onDismiss={vi.fn()}
      {...props}
    />,
  );
}

afterEach(cleanup);

describe("AttachmentPicker", () => {
  it("offers the image action and closes on Escape", () => {
    const onDismiss = vi.fn();
    render(
      <AttachmentPicker
        query=""
        items={[{ path: "src", kind: "directory" }]}
        unavailable={false}
        onQuery={vi.fn()}
        onPick={vi.fn()}
        onAttachImage={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByRole("button", { name: "Attach image…" })).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalled();
  });

  it("keeps the image action and shows unavailable copy", () => {
    renderPicker({ items: [], unavailable: true });
    expect(screen.getByRole("button", { name: "Attach image…" })).toBeVisible();
    expect(screen.getByText("File search unavailable")).toBeVisible();
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("labels files and folders distinctly", () => {
    const onPick = vi.fn();
    renderPicker({
      items: [
        { path: "src/a.ts", kind: "file" },
        { path: "src", kind: "directory" },
      ],
      onPick,
    });
    expect(screen.getByRole("option", { name: "src/a.ts File" })).toBeVisible();
    expect(screen.getByRole("option", { name: "src Folder" })).toBeVisible();
    fireEvent.click(screen.getByRole("option", { name: "src/a.ts File" }));
    expect(onPick).toHaveBeenCalledWith({ path: "src/a.ts", kind: "file" });
  });

  it("dismisses on pointer-down outside the picker", () => {
    const onDismiss = vi.fn();
    render(
      <div>
        <div data-testid="outside">outside</div>
        <AttachmentPicker
          query=""
          items={[{ path: "src", kind: "directory" }]}
          unavailable={false}
        onQuery={vi.fn()}
        onPick={vi.fn()}
        onAttachImage={vi.fn()}
        onDismiss={onDismiss}
      />
    </div>,
    );
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("shows empty copy when search returns no items", () => {
    renderPicker({ items: [] });
    expect(screen.getByText("No matching files")).toBeVisible();
  });

  it("does not steal focus when autoFocus is false", () => {
    renderPicker({ autoFocus: false });
    expect(screen.getByLabelText("Search files and folders")).not.toHaveFocus();
  });

  it("focuses the search field when autoFocus is requested", () => {
    renderPicker({ autoFocus: true });
    expect(screen.getByLabelText("Search files and folders")).toHaveFocus();
  });
});

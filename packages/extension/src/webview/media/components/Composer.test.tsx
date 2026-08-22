// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DraftChip, PickerState } from "../store.js";
import { Composer } from "./Composer.js";

const imageChip: DraftChip = {
  id: "c1",
  kind: "image",
  image: { mediaType: "image/png", data: "AQ==", name: "shot.png" },
  label: "shot.png",
};

const openPicker: PickerState = {
  requestId: "r1",
  query: "",
  quoted: false,
  tokenStart: 5,
  tokenEnd: 6,
  items: [],
  unavailable: false,
};

function renderComposer(
  props: Partial<React.ComponentProps<typeof Composer>> = {},
): ReturnType<typeof render> {
  return render(
    <Composer
      ready
      models={undefined}
      permissions={undefined}
      context={undefined}
      status="idle"
      draft=""
      chips={[]}
      picker={undefined}
      submitPending={false}
      focusPickerSearch={false}
      onDraftChange={vi.fn()}
      onOpenPicker={vi.fn()}
      onPickerQuery={vi.fn()}
      onPickReference={vi.fn()}
      onDismissPicker={vi.fn()}
      onRemoveChip={vi.fn()}
      onBrowseFolder={vi.fn()}
      onAttachImage={vi.fn()}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
      onSelectModel={vi.fn()}
      onSelectPermission={vi.fn()}
      onRequestFullAccess={vi.fn()}
      {...props}
    />,
  );
}

afterEach(cleanup);

describe("Composer send gating", () => {
  it("enables Send for an image-only draft", () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: () => "blob:thumb",
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
    renderComposer({ chips: [imageChip] });
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  it("disables Send while submit is pending", () => {
    renderComposer({ draft: "hello", submitPending: true });
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("exposes enabled Stop while thinking and invokes cancel", () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    renderComposer({
      status: "thinking",
      draft: "hello",
      onCancel,
      onSubmit,
    });
    const stop = screen.getByRole("button", { name: "Stop response" });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("Composer picker focus", () => {
  it("keeps the search field unfocused for an inline @ open", () => {
    renderComposer({
      draft: "read @",
      picker: openPicker,
      focusPickerSearch: false,
    });
    expect(screen.getByLabelText("Search files and folders")).not.toHaveFocus();
  });

  it("focuses picker search for an explicit Plus open", () => {
    renderComposer({
      draft: "@",
      picker: openPicker,
      focusPickerSearch: true,
    });
    expect(screen.getByLabelText("Search files and folders")).toHaveFocus();
  });
});

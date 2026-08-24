// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SlashMenuItem } from "@dsh-vscode/contract";
import type { CommandClaim, DraftChip, PickerState } from "../store.js";
import { Composer } from "./Composer.js";

const imageChip: DraftChip = {
  id: "c1",
  kind: "image",
  image: { mediaType: "image/png", data: "AQ==", name: "shot.png" },
  label: "shot.png",
};

const openPicker: PickerState = {
  kind: "attachment",
  requestId: "r1",
  query: "",
  quoted: false,
  tokenStart: 5,
  tokenEnd: 6,
  items: [],
  unavailable: false,
};

const slashItem: SlashMenuItem = {
  source: "command",
  name: "help",
  description: "Show available commands",
  behavior: "execute",
};

const slashPicker: PickerState = {
  kind: "slash",
  token: { start: 0, end: 1, query: "", position: "leading" },
  requestId: "slash-1",
  catalog: [slashItem],
  groups: [{ source: "command", items: [slashItem] }],
  availability: { commands: true, skills: true },
  highlightedKey: "command:help",
};

const commandClaim: CommandClaim = {
  name: "review",
  token: "/review ",
  hint: "Describe what should be reviewed",
  acceptsImages: false,
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
      commandClaim={undefined}
      submitPending={false}
      busyEnter="queue"
      locale="en"
      focusPickerSearch={false}
      onDraftChange={vi.fn()}
      onCaretChange={vi.fn()}
      onOpenPicker={vi.fn()}
      onPickerQuery={vi.fn()}
      onPickReference={vi.fn()}
      onMoveSlashHighlight={vi.fn()}
      onPickSlashItem={vi.fn()}
      onDismissPicker={vi.fn()}
      onRemoveChip={vi.fn()}
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
  it("gives the message textarea a localized accessible name", () => {
    renderComposer();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeVisible();
    cleanup();
    renderComposer({ locale: "zh" });
    expect(screen.getByRole("textbox", { name: "消息" })).toBeVisible();
  });

  it("enables Send for an image-only draft", () => {
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

  it("maps idle and busy keyboard gestures to queue and steer", () => {
    const onSubmit = vi.fn();
    const { rerender } = renderComposer({ draft: "hello", onSubmit });
    const input = screen.getByPlaceholderText("Message DeepSeek Harness…");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenLastCalledWith("queue");

    rerender(
      <Composer
        ready
        models={undefined}
        permissions={undefined}
        context={undefined}
        status="thinking"
        draft="hello"
        chips={[]}
        picker={undefined}
        commandClaim={undefined}
        submitPending={false}
        busyEnter="steer"
        locale="en"
        focusPickerSearch={false}
        onDraftChange={vi.fn()}
        onCaretChange={vi.fn()}
        onOpenPicker={vi.fn()}
        onPickerQuery={vi.fn()}
        onPickReference={vi.fn()}
        onMoveSlashHighlight={vi.fn()}
        onPickSlashItem={vi.fn()}
        onDismissPicker={vi.fn()}
        onRemoveChip={vi.fn()}
        onAttachImage={vi.fn()}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        onSelectModel={vi.fn()}
        onSelectPermission={vi.fn()}
        onRequestFullAccess={vi.fn()}
      />,
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenLastCalledWith("steer");
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenLastCalledWith("queue");
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenLastCalledWith("queue");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(4);
  });
});

describe("Composer attach button", () => {
  it("opens the picker at the end of a never-focused draft", () => {
    const onOpenPicker = vi.fn();
    renderComposer({ draft: "review this", onOpenPicker });
    fireEvent.click(
      screen.getByRole("button", { name: "Attach files, folders, or images" }),
    );
    expect(onOpenPicker).toHaveBeenCalledWith("review this".length);
  });

  it("opens the picker at the caret the user placed", () => {
    const onOpenPicker = vi.fn();
    renderComposer({ draft: "review this", onOpenPicker });
    const input = screen.getByPlaceholderText("Message DeepSeek Harness…");
    (input as HTMLTextAreaElement).setSelectionRange(6, 6);
    fireEvent.select(input);
    fireEvent.click(
      screen.getByRole("button", { name: "Attach files, folders, or images" }),
    );
    expect(onOpenPicker).toHaveBeenCalledWith(6);
  });

  it("stays disabled before DSH is ready while the draft remains editable", () => {
    const onDraftChange = vi.fn();
    renderComposer({ ready: false, draft: "", onDraftChange });
    expect(
      screen.getByRole("button", { name: "Attach files, folders, or images" }),
    ).toBeDisabled();
    const input = screen.getByPlaceholderText("Message DeepSeek Harness…");
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: "draft before ready" } });
    expect(onDraftChange).toHaveBeenCalledWith("draft before ready", 18);
  });
});

describe("Composer picker focus", () => {
  it("does not render the attachment picker for slash state", () => {
    renderComposer({ draft: "/", picker: slashPicker });
    expect(
      screen.queryByLabelText("Search files and folders"),
    ).not.toBeInTheDocument();
  });

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

describe("Composer slash keyboard arbitration", () => {
  it("reports textarea caret selections to App arbitration", () => {
    const onCaretChange = vi.fn();
    renderComposer({ draft: "/help later", onCaretChange });
    const input = screen.getByPlaceholderText("Message DeepSeek Harness…") as HTMLTextAreaElement;
    input.setSelectionRange(2, 2);

    fireEvent.select(input);

    expect(onCaretChange).toHaveBeenCalledWith("/help later", 2);
  });

  it("dismisses the slash picker on pointer-down outside overlay and composer", () => {
    const onDismissPicker = vi.fn();
    render(
      <div>
        <div data-testid="outside">outside</div>
        <Composer
          ready
          models={undefined}
          permissions={undefined}
          context={undefined}
          status="idle"
          draft="/"
          chips={[]}
          picker={slashPicker}
          commandClaim={undefined}
          submitPending={false}
          busyEnter="queue"
          locale="en"
          focusPickerSearch={false}
          onDraftChange={vi.fn()}
          onCaretChange={vi.fn()}
          onOpenPicker={vi.fn()}
          onPickerQuery={vi.fn()}
          onPickReference={vi.fn()}
          onMoveSlashHighlight={vi.fn()}
          onPickSlashItem={vi.fn()}
          onDismissPicker={onDismissPicker}
          onRemoveChip={vi.fn()}
          onAttachImage={vi.fn()}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          onSelectModel={vi.fn()}
          onSelectPermission={vi.fn()}
          onRequestFullAccess={vi.fn()}
        />
      </div>,
    );

    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(onDismissPicker).toHaveBeenCalledOnce();
  });

  it("does not dismiss the slash picker on pointer-down inside overlay or composer", () => {
    const onDismissPicker = vi.fn();
    renderComposer({
      draft: "/",
      picker: slashPicker,
      onDismissPicker,
    });

    fireEvent.pointerDown(screen.getByRole("option", { name: /\/help/ }));
    fireEvent.pointerDown(screen.getByPlaceholderText("Message DeepSeek Harness…"));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Send message" }));
    expect(onDismissPicker).not.toHaveBeenCalled();
  });

  it("restores the textarea caret returned by a slash pick", async () => {
    renderComposer({
      draft: "/h trailing",
      picker: slashPicker,
      onPickSlashItem: () => 6,
    });
    const input = screen.getByPlaceholderText("Message DeepSeek Harness…") as HTMLTextAreaElement;

    fireEvent.mouseDown(screen.getByRole("option", { name: /\/help/ }));

    await waitFor(() => expect(input.selectionStart).toBe(6));
    expect(input.selectionEnd).toBe(6);
  });

  it.each([
    ["ArrowDown", 1],
    ["ArrowUp", -1],
  ] as const)("moves slash highlight for %s", (key, delta) => {
    const onMoveSlashHighlight = vi.fn();
    renderComposer({
      draft: "/",
      picker: slashPicker,
      onMoveSlashHighlight,
    });
    const input = screen.getByPlaceholderText("Message DeepSeek Harness…");

    expect(fireEvent.keyDown(input, { key })).toBe(false);
    expect(onMoveSlashHighlight).toHaveBeenCalledWith(delta);
  });

  it("picks the highlighted slash item instead of sending", () => {
    const onPickSlashItem = vi.fn();
    const onSubmit = vi.fn();
    renderComposer({
      draft: "/",
      picker: slashPicker,
      onPickSlashItem,
      onSubmit,
    });

    expect(
      fireEvent.keyDown(screen.getByPlaceholderText("Message DeepSeek Harness…"), {
        key: "Enter",
      }),
    ).toBe(false);
    expect(onPickSlashItem).toHaveBeenCalledWith(slashItem);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends normally when the slash picker has no highlight", () => {
    const onSubmit = vi.fn();
    const onPickSlashItem = vi.fn();
    renderComposer({
      draft: "/unknown",
      picker: { ...slashPicker, highlightedKey: undefined },
      onSubmit,
      onPickSlashItem,
    });

    fireEvent.keyDown(screen.getByPlaceholderText("Message DeepSeek Harness…"), {
      key: "Enter",
    });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onPickSlashItem).not.toHaveBeenCalled();
  });

  it("leaves Shift+Enter to the textarea", () => {
    const onSubmit = vi.fn();
    const onPickSlashItem = vi.fn();
    renderComposer({
      draft: "/",
      picker: slashPicker,
      onSubmit,
      onPickSlashItem,
    });

    expect(
      fireEvent.keyDown(screen.getByPlaceholderText("Message DeepSeek Harness…"), {
        key: "Enter",
        shiftKey: true,
      }),
    ).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onPickSlashItem).not.toHaveBeenCalled();
  });

  it("dismisses the slash picker on Escape", () => {
    const onDismissPicker = vi.fn();
    renderComposer({
      draft: "/",
      picker: slashPicker,
      onDismissPicker,
    });

    expect(
      fireEvent.keyDown(screen.getByPlaceholderText("Message DeepSeek Harness…"), {
        key: "Escape",
      }),
    ).toBe(false);
    expect(onDismissPicker).toHaveBeenCalledOnce();
  });

  it("passes composing keys through without slash or send actions", () => {
    const onMoveSlashHighlight = vi.fn();
    const onPickSlashItem = vi.fn();
    const onSubmit = vi.fn();
    renderComposer({
      draft: "/",
      picker: slashPicker,
      onMoveSlashHighlight,
      onPickSlashItem,
      onSubmit,
    });
    const input = screen.getByPlaceholderText("Message DeepSeek Harness…");
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });

    expect(input.dispatchEvent(event)).toBe(true);
    expect(onMoveSlashHighlight).not.toHaveBeenCalled();
    expect(onPickSlashItem).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps attachment-picker textarea keys on normal send behavior", () => {
    const onSubmit = vi.fn();
    const onMoveSlashHighlight = vi.fn();
    renderComposer({
      draft: "read @",
      picker: openPicker,
      onSubmit,
      onMoveSlashHighlight,
    });
    const input = screen.getByPlaceholderText("Message DeepSeek Harness…");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onMoveSlashHighlight).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe("Composer slash accessibility", () => {
  it("connects the textarea combobox to the highlighted slash option", () => {
    renderComposer({ draft: "/", picker: slashPicker });

    const input = screen.getByPlaceholderText("Message DeepSeek Harness…");
    expect(input).toHaveAttribute("role", "combobox");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", "dsh-slash-listbox");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "dsh-slash-option-command-help",
    );
    expect(document.activeElement).not.toBe(
      screen.getByRole("option", { name: /\/help/ }),
    );
  });

  it("does not expose combobox metadata for an attachment picker", () => {
    renderComposer({ draft: "read @", picker: openPicker });

    const input = screen.getByPlaceholderText("Message DeepSeek Harness…");
    expect(input).not.toHaveAttribute("role");
    expect(input).not.toHaveAttribute("aria-expanded");
    expect(input).not.toHaveAttribute("aria-controls");
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("renders the command claim hint without changing the draft", () => {
    renderComposer({
      draft: "/review src",
      commandClaim,
    });

    expect(screen.getByText("Describe what should be reviewed")).toBeVisible();
    expect(screen.getByPlaceholderText("Message DeepSeek Harness…")).toHaveValue(
      "/review src",
    );
  });
});

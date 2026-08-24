// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SettingsHostResultMessage,
  UiCommandCmd,
} from "../../../vscode.js";
import {
  ExtensionController,
} from "./ExtensionController.js";
import { ExtensionSection } from "./ExtensionSection.js";

afterEach(cleanup);

function setup() {
  const sent: UiCommandCmd[] = [];
  const restartRequired = vi.fn();
  let next = 0;
  const controller = new ExtensionController(
    (command) => sent.push(command),
    restartRequired,
    () => `request-${++next}`,
  );
  return { controller, sent, restartRequired };
}

function receive(
  controller: ExtensionController,
  message: SettingsHostResultMessage,
): void {
  act(() => controller.receive(message));
}

describe("ExtensionSection", () => {
  it("loads host settings, stages edits, and marks changed launch settings after save", () => {
    const { controller, sent, restartRequired } = setup();
    render(
      <ExtensionSection
        controller={controller}
        locale="en"
        restartDisabled={false}
      />,
    );
    expect(sent[0]).toEqual({
      kind: "getExtensionSettings",
      requestId: "request-1",
    });
    receive(controller, {
      kind: "settingsHostResult",
      requestId: "request-1",
      action: "read",
      result: {
        ok: true,
        settings: { binaryPath: "", handshakeTimeoutMs: 30_000 },
      },
    });

    fireEvent.change(screen.getByLabelText("DeepSeek Harness binary path"), {
      target: { value: "/opt/dsh" },
    });
    fireEvent.change(screen.getByLabelText("Handshake timeout (ms)"), {
      target: { value: "45000" },
    });
    expect(controller.snapshot().dirty).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(sent[1]).toEqual({
      kind: "updateExtensionSettings",
      requestId: "request-2",
      binaryPath: "/opt/dsh",
      handshakeTimeoutMs: 45_000,
    });

    receive(controller, {
      kind: "settingsHostResult",
      requestId: "request-2",
      action: "write",
      result: {
        ok: true,
        settings: {
          binaryPath: "/opt/dsh",
          handshakeTimeoutMs: 45_000,
        },
        restartRequired: true,
      },
    });
    expect(controller.snapshot().dirty).toBe(false);
    expect(restartRequired).toHaveBeenCalledWith(true);
  });

  it.each([
    ["999", "Enter a value from 1,000 to 300,000."],
    ["300001", "Enter a value from 1,000 to 300,000."],
    ["1.5", "Enter a whole number."],
  ])("validates timeout %s inline without sending", (value, detail) => {
    const { controller, sent } = setup();
    render(
      <ExtensionSection
        controller={controller}
        locale="en"
        restartDisabled={false}
      />,
    );
    receive(controller, {
      kind: "settingsHostResult",
      requestId: "request-1",
      action: "read",
      result: {
        ok: true,
        settings: { binaryPath: "", handshakeTimeoutMs: 30_000 },
      },
    });
    fireEvent.change(screen.getByLabelText("Handshake timeout (ms)"), {
      target: { value },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(detail);
    expect(sent).toHaveLength(1);
  });

  it("sends only known native action ids and gates restart from explicit state", () => {
    const { controller, sent } = setup();
    const { rerender } = render(
      <ExtensionSection
        controller={controller}
        locale="en"
        restartDisabled
      />,
    );
    receive(controller, {
      kind: "settingsHostResult",
      requestId: "request-1",
      action: "read",
      result: {
        ok: true,
        settings: { binaryPath: "", handshakeTimeoutMs: 30_000 },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Open VS Code Settings" }));
    expect(sent.slice(1)).toEqual([
      { kind: "openExtensionSettings", requestId: "request-2" },
    ]);
    expect(screen.getByTestId("extension-native-actions")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByText("Extension action in progress…")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Open DeepSeek Harness settings document" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reveal DeepSeek Harness home" })).toBeDisabled();
    receive(controller, {
      kind: "settingsHostResult",
      requestId: "request-2",
      action: "openExtensionSettings",
      result: { ok: true },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Open DeepSeek Harness settings document" }),
    );
    receive(controller, {
      kind: "settingsHostResult",
      requestId: "request-3",
      action: "openSettingsDocument",
      result: { ok: true },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reveal DeepSeek Harness home" }));
    expect(sent.slice(1)).toEqual([
      { kind: "openExtensionSettings", requestId: "request-2" },
      { kind: "openSettingsDocument", requestId: "request-3" },
      { kind: "revealDshHome", requestId: "request-4" },
    ]);
    receive(controller, {
      kind: "settingsHostResult",
      requestId: "request-4",
      action: "revealDshHome",
      result: { ok: true },
    });
    expect(screen.getByRole("button", { name: "Restart DeepSeek Harness" })).toBeDisabled();

    rerender(
      <ExtensionSection
        controller={controller}
        locale="en"
        restartDisabled={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Restart DeepSeek Harness" }));
    expect(sent.at(-1)).toEqual({
      kind: "restartDsh",
      requestId: "request-5",
    });
    expect(screen.getByRole("button", { name: "Restart DeepSeek Harness" })).toBeDisabled();
  });

  it("offers a correlated Retry after an Extension read error", () => {
    const { controller, sent } = setup();
    render(
      <ExtensionSection
        controller={controller}
        locale="en"
        restartDisabled={false}
      />,
    );
    receive(controller, {
      kind: "settingsHostResult",
      requestId: "request-1",
      action: "read",
      result: { ok: false, detail: "Invalid persisted timeout" },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid persisted timeout",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(sent.at(-1)).toEqual({
      kind: "getExtensionSettings",
      requestId: "request-2",
    });
  });

  it("uses actual reread settings after a compensated write cannot roll back", () => {
    const { controller } = setup();
    controller.load();
    receive(controller, {
      kind: "settingsHostResult",
      requestId: "request-1",
      action: "read",
      result: {
        ok: true,
        settings: { binaryPath: "", handshakeTimeoutMs: 30_000 },
      },
    });
    controller.setBinaryPath("/submitted/dsh");
    controller.setHandshakeTimeout("50000");
    controller.save();

    receive(controller, {
      kind: "settingsHostResult",
      requestId: "request-2",
      action: "write",
      result: {
        ok: false,
        detail: "Extension settings are partially written.",
        settings: {
          binaryPath: "/actual/dsh",
          handshakeTimeoutMs: 30_000,
        },
      },
    });

    expect(controller.snapshot()).toMatchObject({
      binaryPath: "/actual/dsh",
      handshakeTimeoutInput: "30000",
      dirty: false,
      error: "Extension settings are partially written.",
    });
  });

  it("ignores late results after disconnect and preserves the draft", () => {
    const { controller, sent } = setup();
    controller.load();
    receive(controller, {
      kind: "settingsHostResult",
      requestId: "request-1",
      action: "read",
      result: {
        ok: true,
        settings: { binaryPath: "", handshakeTimeoutMs: 30_000 },
      },
    });
    controller.setBinaryPath("/draft/dsh");
    controller.save();
    expect(sent.at(-1)).toMatchObject({ requestId: "request-2" });

    controller.invalidate();
    receive(controller, {
      kind: "settingsHostResult",
      requestId: "request-2",
      action: "write",
      result: {
        ok: true,
        settings: { binaryPath: "/late/dsh", handshakeTimeoutMs: 30_000 },
        restartRequired: true,
      },
    });

    expect(controller.snapshot().binaryPath).toBe("/draft/dsh");
    expect(controller.snapshot().dirty).toBe(true);
  });
});

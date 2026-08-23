import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  executeCommand,
  getConfiguration,
  inspect,
  openTextDocument,
  showTextDocument,
  update,
} = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  getConfiguration: vi.fn(),
  inspect: vi.fn(),
  openTextDocument: vi.fn(),
  showTextDocument: vi.fn(),
  update: vi.fn(),
}));

vi.mock("vscode", () => ({
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
  },
  Uri: {
    file: (fsPath: string) => ({ scheme: "file", fsPath }),
  },
  commands: { executeCommand },
  window: { showTextDocument },
  workspace: {
    getConfiguration,
    openTextDocument,
  },
}));

import { VsCodeSettingsHost } from "../src/settingsHost.js";

describe("VsCodeSettingsHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inspect.mockImplementation((key: string) =>
      key === "binaryPath"
        ? {
            defaultValue: "",
            globalValue: "/global/dsh",
            workspaceValue: "/workspace/dsh",
            workspaceFolderValue: "/folder/dsh",
          }
        : {
            defaultValue: 30_000,
            globalValue: 40_000,
          },
    );
    getConfiguration.mockReturnValue({
      inspect,
      get: (key: string) =>
        key === "binaryPath" ? "/folder/dsh" : 40_000,
      update,
    });
  });

  it("reads effective launch settings and preserves each supplying target", async () => {
    const host = new VsCodeSettingsHost();

    expect(host.read()).toEqual({
      binaryPath: "/folder/dsh",
      handshakeTimeoutMs: 40_000,
    });
    await host.write({
      binaryPath: "/next/dsh",
      handshakeTimeoutMs: 50_000,
    });

    expect(update).toHaveBeenNthCalledWith(1, "binaryPath", "/next/dsh", 3);
    expect(update).toHaveBeenNthCalledWith(
      2,
      "handshakeTimeoutMs",
      50_000,
      1,
    );
  });

  it("writes values supplied only by defaults to the global target", async () => {
    inspect.mockReturnValue({ defaultValue: "" });
    getConfiguration.mockReturnValue({
      inspect,
      get: (key: string) => key === "binaryPath" ? "" : 30_000,
      update,
    });

    await new VsCodeSettingsHost().write({
      binaryPath: "/new/dsh",
      handshakeTimeoutMs: 31_000,
    });

    expect(update).toHaveBeenNthCalledWith(1, "binaryPath", "/new/dsh", 1);
    expect(update).toHaveBeenNthCalledWith(
      2,
      "handshakeTimeoutMs",
      31_000,
      1,
    );
  });

  it("preserves a workspace value when no folder value supplies the setting", async () => {
    inspect.mockImplementation((key: string) =>
      key === "binaryPath"
        ? {
            defaultValue: "",
            globalValue: "/global/dsh",
            workspaceValue: "/workspace/dsh",
          }
        : { defaultValue: 30_000, workspaceValue: 60_000 },
    );

    await new VsCodeSettingsHost().write({
      binaryPath: "/next/dsh",
      handshakeTimeoutMs: 70_000,
    });

    expect(update).toHaveBeenNthCalledWith(1, "binaryPath", "/next/dsh", 2);
    expect(update).toHaveBeenNthCalledWith(
      2,
      "handshakeTimeoutMs",
      70_000,
      2,
    );
  });

  it("performs no updates when both effective values are unchanged", async () => {
    await new VsCodeSettingsHost().write({
      binaryPath: "/folder/dsh",
      handshakeTimeoutMs: 40_000,
    });

    expect(update).not.toHaveBeenCalled();
  });

  it("rolls back the first update when the second update fails", async () => {
    let binaryPath = "/folder/dsh";
    update.mockImplementation(
      async (key: string, value: string | number | undefined) => {
        if (key === "handshakeTimeoutMs") throw new Error("timeout denied");
        binaryPath = String(value);
      },
    );
    getConfiguration.mockReturnValue({
      inspect,
      get: (key: string) => key === "binaryPath" ? binaryPath : 40_000,
      update,
    });

    await expect(new VsCodeSettingsHost().write({
      binaryPath: "/next/dsh",
      handshakeTimeoutMs: 50_000,
    })).rejects.toThrow("timeout denied");

    expect(update.mock.calls).toEqual([
      ["binaryPath", "/next/dsh", 3],
      ["handshakeTimeoutMs", 50_000, 1],
      ["binaryPath", "/folder/dsh", 3],
    ]);
    expect(binaryPath).toBe("/folder/dsh");
  });

  it("reports the reread state when compensating a partial write fails", async () => {
    let binaryPath = "/folder/dsh";
    update.mockImplementation(
      async (key: string, value: string | number | undefined) => {
        if (key === "handshakeTimeoutMs") throw new Error("timeout denied");
        if (value === "/folder/dsh") throw new Error("rollback denied");
        binaryPath = String(value);
      },
    );
    getConfiguration.mockReturnValue({
      inspect,
      get: (key: string) => key === "binaryPath" ? binaryPath : 40_000,
      update,
    });

    const write = new VsCodeSettingsHost().write({
      binaryPath: "/next/dsh",
      handshakeTimeoutMs: 50_000,
    });
    await expect(write).rejects.toMatchObject({
      message:
        "Failed to update handshakeTimeoutMs: timeout denied; " +
        "rollback of binaryPath failed: rollback denied. " +
        "Extension settings are partially written.",
      actual: {
        binaryPath: "/next/dsh",
        handshakeTimeoutMs: 40_000,
      },
    });
  });

  it("rejects corrupt effective configuration on read", () => {
    getConfiguration.mockReturnValue({
      inspect,
      get: (key: string) => key === "binaryPath" ? "" : "invalid",
      update,
    });

    expect(() => new VsCodeSettingsHost().read()).toThrow(
      "whole number from 1000 to 300000",
    );
  });

  it.each([999, 300_001, 1_000.5, Number.NaN])(
    "rejects invalid timeout %s before writing",
    async (handshakeTimeoutMs) => {
      await expect(new VsCodeSettingsHost().write({
        binaryPath: "",
        handshakeTimeoutMs,
      })).rejects.toThrow("whole number from 1000 to 300000");
      expect(update).not.toHaveBeenCalled();
    },
  );

  it("rejects a non-string binary path before writing", async () => {
    await expect(new VsCodeSettingsHost().write({
      binaryPath: 42 as never,
      handshakeTimeoutMs: 30_000,
    })).rejects.toThrow("binary path must be a string");
    expect(update).not.toHaveBeenCalled();
  });

  it("opens VS Code Settings with the DSH extension filter", async () => {
    await new VsCodeSettingsHost().openExtensionSettings();

    expect(executeCommand).toHaveBeenCalledWith(
      "workbench.action.openSettings",
      "@ext:dsh.dsh",
    );
  });

  it("opens and reveals only absolute local paths", async () => {
    const document = {};
    openTextDocument.mockResolvedValue(document);
    const host = new VsCodeSettingsHost();

    await host.openTrustedPath("/tmp/settings.yaml", "open");
    expect(openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ scheme: "file", fsPath: "/tmp/settings.yaml" }),
    );
    expect(showTextDocument).toHaveBeenCalledWith(document);

    await host.openTrustedPath("/tmp/.dsh", "reveal");
    expect(executeCommand).toHaveBeenCalledWith(
      "revealFileInOS",
      expect.objectContaining({ scheme: "file", fsPath: "/tmp/.dsh" }),
    );

    await expect(
      host.openTrustedPath("relative/settings.yaml", "open"),
    ).rejects.toThrow("absolute local path");
  });
});

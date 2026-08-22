import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveDownloadedExecutable } from "./e2eExecutable.js";

describe("resolveDownloadedExecutable", () => {
  it("uses the Code binary when a macOS archive omits Electron", () => {
    const electron = path.join(
      "/tmp",
      "Visual Studio Code.app",
      "Contents",
      "MacOS",
      "Electron"
    );
    const code = path.join(path.dirname(electron), "Code");

    expect(
      resolveDownloadedExecutable(
        electron,
        "darwin",
        (candidate) => candidate === code
      )
    ).toBe(code);
  });

  it("preserves an existing downloaded executable", () => {
    const executable = "/tmp/Visual Studio Code.app/Contents/MacOS/Electron";

    expect(
      resolveDownloadedExecutable(executable, "darwin", () => true)
    ).toBe(executable);
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DraftChip } from "../store.js";
import { ChipRail } from "./ChipRail.js";

const fileChip: DraftChip = {
  id: "c1",
  kind: "file",
  path: "src/a.ts",
  mention: "@src/a.ts",
  label: "a.ts",
};

const folderChip: DraftChip = {
  id: "c2",
  kind: "folder",
  path: "src/lib",
  mention: "@src/lib/",
  label: "lib",
};

const imageChip: DraftChip = {
  id: "c3",
  kind: "image",
  image: { mediaType: "image/png", data: "AQ==", name: "shot.png" },
  label: "shot.png",
};

afterEach(cleanup);

describe("ChipRail", () => {
  it("shows basename labels, mention tooltips, and remove callbacks", () => {
    const onRemove = vi.fn();
    render(<ChipRail chips={[fileChip, folderChip]} onRemove={onRemove} />);
    expect(screen.getByText("a.ts")).toBeVisible();
    expect(screen.getByText("lib")).toBeVisible();
    expect(screen.getByTitle("@src/a.ts")).toBeVisible();
    expect(screen.getByTitle("@src/lib/")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Remove a.ts" }));
    expect(onRemove).toHaveBeenCalledWith("c1");
  });

  it("creates and revokes an image thumbnail URL", () => {
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
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:thumb");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const { unmount } = render(
      <ChipRail chips={[imageChip]} onRemove={vi.fn()} />,
    );
    expect(screen.getByRole("img", { name: "shot.png" })).toHaveAttribute(
      "src",
      "blob:thumb",
    );
    expect(screen.getByRole("img", { name: "shot.png" })).not.toHaveAttribute(
      "title",
      expect.stringContaining("/"),
    );
    unmount();
    expect(revoke).toHaveBeenCalled();
    create.mockRestore();
    revoke.mockRestore();
  });
});

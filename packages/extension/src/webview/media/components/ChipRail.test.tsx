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

  it("exposes the rail as a labelled list of chips", () => {
    render(<ChipRail chips={[fileChip, imageChip]} onRemove={vi.fn()} />);
    expect(screen.getByRole("list", { name: "Attachments" })).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders an image thumbnail as a CSP-allowed data URI", () => {
    render(<ChipRail chips={[imageChip]} onRemove={vi.fn()} />);
    const thumb = screen.getByRole("img", { name: "shot.png" });
    expect(thumb).toHaveAttribute("src", "data:image/png;base64,AQ==");
    expect(thumb.getAttribute("src")).not.toMatch(/^blob:/);
  });

  it("titles an image chip with its base name only", () => {
    render(
      <ChipRail
        chips={[{ ...imageChip, label: "shot.png" }]}
        onRemove={vi.fn()}
      />,
    );
    const chip = screen.getByRole("listitem");
    expect(chip).toHaveAttribute("title", "shot.png");
  });
});

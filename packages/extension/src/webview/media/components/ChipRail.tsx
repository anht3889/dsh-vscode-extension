import type { EncodedImageAttachment } from "@dsh-vscode/contract";
import React from "react";
import type { DraftChip } from "../store.js";

export interface ChipRailProps {
  chips: DraftChip[];
  onRemove(id: string): void;
}

/**
 * Thumbnails render as `data:` URIs because the panel CSP allows `img-src`
 * only from the webview resource origin and `data:`; a `blob:` object URL is
 * blocked there and the chip would show a broken image.
 */
function dataUri(image: EncodedImageAttachment): string {
  return `data:${image.mediaType};base64,${image.data}`;
}

function FileGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M4 2.5h5l3 3V13.5H4z" />
      <path d="M9 2.5v3h3" />
    </svg>
  );
}

function FolderGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M2.5 4.5h4l1.2 1.3H13.5v7H2.5z" />
    </svg>
  );
}

function ImageGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
      <circle cx="6" cy="7" r="1" />
      <path d="M3.5 11.2 7 8.2l2.2 2 2.3-2.4 1 1.1" />
    </svg>
  );
}

export function ChipRail({ chips, onRemove }: ChipRailProps): JSX.Element {
  return (
    <div className="dsh-chip-rail" role="list" aria-label="Attachments">
      {chips.map((chip) => {
        const title = chip.kind === "image" ? chip.label : chip.mention;
        return (
          <div
            className="dsh-chip"
            role="listitem"
            key={chip.id}
            title={title}
          >
            {chip.kind === "file" ? <FileGlyph /> : null}
            {chip.kind === "folder" ? <FolderGlyph /> : null}
            {chip.kind === "image" ? (
              <>
                <ImageGlyph />
                <img
                  className="dsh-chip-thumbnail"
                  src={dataUri(chip.image)}
                  alt={chip.label}
                />
              </>
            ) : null}
            <span className="dsh-chip-label">{chip.label}</span>
            <button
              className="dsh-chip-remove"
              type="button"
              aria-label={`Remove ${chip.label}`}
              onClick={() => onRemove(chip.id)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

import type { EncodedImageAttachment } from "@dsh-vscode/contract";
import React, { useEffect, useState } from "react";
import type { DraftChip } from "../store.js";

export interface ChipRailProps {
  chips: DraftChip[];
  onRemove(id: string): void;
}

function blobFromBase64(data: string, mediaType: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mediaType });
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

function ImageThumb({
  image,
  label,
}: {
  image: EncodedImageAttachment;
  label: string;
}): JSX.Element | null {
  const [url, setUrl] = useState<string | undefined>();

  useEffect(() => {
    const next = URL.createObjectURL(blobFromBase64(image.data, image.mediaType));
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
    };
  }, [image.data, image.mediaType]);

  if (url === undefined) return null;
  return <img className="dsh-chip-thumbnail" src={url} alt={label} />;
}

export function ChipRail({ chips, onRemove }: ChipRailProps): JSX.Element {
  return (
    <div className="dsh-chip-rail" aria-label="Attachments">
      {chips.map((chip) => {
        const title = chip.kind === "image" ? chip.label : chip.mention;
        return (
          <div className="dsh-chip" key={chip.id} title={title}>
            {chip.kind === "file" ? <FileGlyph /> : null}
            {chip.kind === "folder" ? <FolderGlyph /> : null}
            {chip.kind === "image" ? (
              <>
                <ImageGlyph />
                <ImageThumb image={chip.image} label={chip.label} />
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

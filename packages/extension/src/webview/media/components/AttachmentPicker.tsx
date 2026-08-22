import type { FileReferenceItem } from "@dsh-vscode/contract";
import React, { useEffect, useRef } from "react";

export interface AttachmentPickerProps {
  query: string;
  items: FileReferenceItem[];
  unavailable: boolean;
  onQuery(query: string): void;
  onPick(item: FileReferenceItem): void;
  onBrowseFolder(): void;
  onAttachImage(): void;
  onDismiss(): void;
  autoFocus?: boolean;
}

export function AttachmentPicker({
  query,
  items,
  unavailable,
  onQuery,
  onPick,
  onBrowseFolder,
  onAttachImage,
  onDismiss,
  autoFocus = false,
}: AttachmentPickerProps): JSX.Element {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        root.current?.contains(event.target) === false
      ) {
        onDismiss();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [onDismiss]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <div
      ref={root}
      className="dsh-attachment-picker"
      role="dialog"
      aria-label="Attach files, folders, or images"
    >
      <input
        className="dsh-attachment-search"
        type="search"
        value={query}
        placeholder="Search files and folders"
        aria-label="Search files and folders"
        autoFocus={autoFocus}
        onChange={(event) => onQuery(event.target.value)}
      />
      <div className="dsh-attachment-actions">
        <button
          className="dsh-attachment-row"
          type="button"
          onClick={onBrowseFolder}
        >
          Browse folders…
        </button>
        <button
          className="dsh-attachment-row"
          type="button"
          onClick={onAttachImage}
        >
          Attach image…
        </button>
      </div>
      <div className="dsh-attachment-list" role="listbox" aria-label="Workspace files">
        {unavailable ? (
          <div className="dsh-empty-state">File search unavailable.</div>
        ) : null}
        {!unavailable && items.length === 0 ? (
          <div className="dsh-empty-state">No matching files</div>
        ) : null}
        {!unavailable
          ? items.map((item) => (
              <button
                className="dsh-attachment-row"
                type="button"
                role="option"
                aria-selected={false}
                key={`${item.kind}:${item.path}`}
                aria-label={`${item.path} ${item.kind === "directory" ? "Folder" : "File"}`}
                onClick={() => onPick(item)}
              >
                <span className="dsh-attachment-path">{item.path}</span>
                <span className="dsh-attachment-kind">
                  {item.kind === "directory" ? "Folder" : "File"}
                </span>
              </button>
            ))
          : null}
      </div>
    </div>
  );
}

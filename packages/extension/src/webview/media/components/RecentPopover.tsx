import React, { useEffect, useMemo, useState } from "react";
import type { SessionListItem } from "@dsh-vscode/contract";
import { filterSessions } from "../store.js";

interface RecentPopoverProps {
  items: SessionListItem[];
  unavailable: boolean;
  onClose(): void;
  onPick(sessionId: string): void;
}

export function RecentPopover({
  items,
  unavailable,
  onClose,
  onPick,
}: RecentPopoverProps): JSX.Element {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => filterSessions(items, query),
    [items, query],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <section className="dsh-recent-popover" aria-label="Recent chats">
      <input
        className="dsh-recent-search"
        type="search"
        value={query}
        placeholder="Search recent chats"
        aria-label="Search recent chats"
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="dsh-recent-list">
        {unavailable ? (
          <div className="dsh-empty-state">Session history unavailable</div>
        ) : filtered.length === 0 ? (
          <div className="dsh-empty-state">No recent chats</div>
        ) : (
          filtered.map((item) => (
            <button
              className="dsh-recent-row"
              type="button"
              key={item.sessionId}
              onClick={() => onPick(item.sessionId)}
            >
              <span className="dsh-recent-title">{item.title}</span>
              <time dateTime={new Date(item.updatedAt).toISOString()}>
                {new Date(item.updatedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </time>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

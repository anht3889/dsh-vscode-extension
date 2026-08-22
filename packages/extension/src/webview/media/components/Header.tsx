import React, { useEffect, useRef } from "react";

interface HeaderProps {
  busy: boolean;
  recentOpen: boolean;
  onRecent(): void;
  onCloseRecent(): void;
  onNewChat(): void;
  children?: React.ReactNode;
}

function Icon({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function Header({
  busy,
  recentOpen,
  onRecent,
  onCloseRecent,
  onNewChat,
  children,
}: HeaderProps): JSX.Element {
  const recentRoot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!recentOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        recentRoot.current?.contains(event.target) === false
      ) {
        onCloseRecent();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [recentOpen, onCloseRecent]);

  return (
    <header className="dsh-header">
      <div className="dsh-title">
        <span>DSH: Chat</span>
        {busy ? <span className="dsh-spinner" role="status" aria-label="DSH is working" /> : null}
      </div>
      <div className="dsh-header-actions">
        <div className="dsh-recent-owner" ref={recentRoot}>
          <button
            className="dsh-icon-button"
            type="button"
            title="Recent chats"
            aria-label="Recent chats"
            aria-expanded={recentOpen}
            onClick={onRecent}
          >
            <Icon>
              <path d="M3.2 4.2H1.5V2.5" />
              <path d="M2 4a6 6 0 1 1-.1 7.8" />
              <path d="M8 4.5V8l2.4 1.4" />
            </Icon>
          </button>
          {children}
        </div>
        <button
          className="dsh-icon-button"
          type="button"
          title="Coming soon"
          aria-label="Settings (coming soon)"
          disabled
        >
          <Icon>
            <circle cx="8" cy="8" r="2.2" />
            <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M12.6 3.4l-.9.9M4.3 11.7l-.9.9" />
          </Icon>
        </button>
        <button
          className="dsh-icon-button"
          type="button"
          title="New chat"
          aria-label="New chat"
          onClick={onNewChat}
        >
          <Icon>
            <path d="M8 3v10M3 8h10" />
          </Icon>
        </button>
      </div>
    </header>
  );
}

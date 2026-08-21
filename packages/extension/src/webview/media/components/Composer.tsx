import React, { useCallback, useState } from "react";

interface ComposerProps {
  onSubmit(text: string): void;
}

export function Composer({ onSubmit }: ComposerProps): JSX.Element {
  const [text, setText] = useState("");

  const send = useCallback((): void => {
    const t = text.trim();
    if (t.length === 0) return;
    onSubmit(t);
    setText("");
  }, [text, onSubmit]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  return (
    <footer className="dsh-composer">
      <textarea
        className="dsh-composer-input"
        rows={3}
        value={text}
        placeholder="Message DSH…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button className="dsh-composer-send" onClick={send} disabled={text.trim().length === 0}>
        Send
      </button>
    </footer>
  );
}

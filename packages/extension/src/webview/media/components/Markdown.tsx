import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { COPY_BUTTON_CLASS, renderMarkdown } from "../markdown.js";

interface MarkdownProps {
  source: string;
}

/** How long a copy button reports its outcome before returning to "Copy". */
const COPY_FEEDBACK_MS = 1200;

/**
 * Render assistant markdown.
 *
 * The rendered HTML comes from {@link renderMarkdown}, which escapes model text
 * and never emits raw HTML, so React owns the container and markdown-it owns its
 * contents. Copy clicks are delegated from the container because the buttons
 * live inside that injected HTML, beyond React's reach.
 */
export function Markdown({ source }: MarkdownProps): JSX.Element {
  const html = useMemo(() => renderMarkdown(source), [source]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => (): void => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );

  const onClick = useCallback((event: React.MouseEvent<HTMLDivElement>): void => {
    const origin = event.target;
    if (!(origin instanceof HTMLElement)) return;
    const button = origin.closest(`button.${COPY_BUTTON_CLASS}`);
    if (!(button instanceof HTMLButtonElement)) return;

    const report = (outcome: string): void => {
      button.textContent = outcome;
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        button.textContent = "Copy";
      }, COPY_FEEDBACK_MS);
    };

    // textContent reverses the renderer's escaping, so the clipboard receives
    // the code the model actually wrote.
    const code = button.closest(".dsh-code")?.querySelector("code")?.textContent;
    if (navigator.clipboard === undefined || code === undefined || code === null) {
      report("Copy failed");
      return;
    }
    void navigator.clipboard.writeText(code).then(
      () => report("Copied"),
      () => report("Copy failed"),
    );
  }, []);

  return (
    <div
      className="dsh-md"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

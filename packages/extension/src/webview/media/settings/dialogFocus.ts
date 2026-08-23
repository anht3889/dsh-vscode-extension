import { useEffect } from "react";
import type { RefObject } from "react";

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function visible(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current !== null) {
    if (
      current.hidden ||
      current.getAttribute("aria-hidden") === "true" ||
      current.getAttribute("aria-disabled") === "true"
    ) return false;
    current = current.parentElement;
  }
  return true;
}

/**
 * Own keyboard focus while a dialog is nested inside the Settings modal.
 * Capture-phase handling prevents the outer modal from consuming Escape first.
 */
export function useNestedDialogFocus(
  active: boolean,
  dialogRef: RefObject<HTMLElement>,
  initialRef: RefObject<HTMLElement>,
  saving: boolean,
  onEscape: () => void,
): void {
  useEffect(() => {
    if (!active) return;
    initialRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!saving) onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        FOCUSABLE,
      ) ?? [])].filter(visible);
      const first = controls[0];
      const last = controls.at(-1);
      if (first === undefined || last === undefined) return;
      const current = document.activeElement;
      if (
        controls.length === 1 ||
        (event.shiftKey && (current === first || !controls.includes(current as HTMLElement))) ||
        (!event.shiftKey && (current === last || !controls.includes(current as HTMLElement)))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, dialogRef, initialRef, onEscape, saving]);
}

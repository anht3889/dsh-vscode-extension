import React, { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useNestedDialogFocus } from "./dialogFocus.js";

interface SettingsNestedDialogProps {
  labelledBy: string;
  initialRef: RefObject<HTMLElement>;
  active?: boolean;
  saving?: boolean;
  onEscape: () => void;
  children: React.ReactNode;
}

/** Focus-trapped dialog displayed above the Settings modal. */
export function SettingsNestedDialog({
  labelledBy,
  initialRef,
  active = true,
  saving = false,
  onEscape,
  children,
}: SettingsNestedDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  useNestedDialogFocus(
    active,
    dialogRef,
    initialRef,
    saving,
    onEscape,
    !focused.current,
  );
  useEffect(() => {
    if (active) focused.current = true;
  }, [active]);
  return (
    <>
      <div className="dsh-settings-nested-scrim" aria-hidden="true" />
      <div
        ref={dialogRef}
        className="dsh-settings-nested-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </>
  );
}

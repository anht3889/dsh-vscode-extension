import React, { useRef } from "react";
import type { RefObject } from "react";
import { useNestedDialogFocus } from "./dialogFocus.js";

interface SettingsConfirmationProps {
  labelledBy: string;
  initialRef: RefObject<HTMLElement>;
  saving?: boolean;
  onEscape: () => void;
  children: React.ReactNode;
}

/** Labelled settings confirmation with a pointer-blocking scrim and focus trap. */
export function SettingsConfirmation({
  labelledBy,
  initialRef,
  saving = false,
  onEscape,
  children,
}: SettingsConfirmationProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  useNestedDialogFocus(true, dialogRef, initialRef, saving, onEscape);
  return (
    <>
      <div
        className="dsh-settings-confirmation-scrim"
        data-testid="settings-confirmation-scrim"
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        className="dsh-settings-confirmation"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </>
  );
}

"use client";

import ui from "./primitives.module.css";

import styles from "./dialog.module.css";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  title: string;
  /** A small line above the title. */
  eyebrow?: string;
  closeLabel?: string;
  /** Called when the person dismisses the dialog; the opener then stops rendering it. */
  onClose: () => void;
  children: ReactNode;
};

/**
 * A modal dialog that is open while it is mounted. It opens with showModal, restores focus to the element focused before it when it unmounts and closes
 * on its close button, Escape and a press that starts and ends on the backdrop. It renders into the document body, so a dialog opened from inside a
 * form or another dialog does not nest its form in theirs.
 */
export function Dialog({
  title,
  eyebrow,
  closeLabel = "Close dialog",
  onClose,
  children
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const pressStartedOnBackdrop = useRef(false);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;

    // Escape closes the native dialog first; the opener learns about it through the close event. The event is queued, so one left over from a
    // remount, as in development's strict mode, arrives while the dialog is open again and is ignored.
    function closedByBrowser() {
      if (!dialog?.open) {
        onCloseRef.current();
      }
    }

    dialog?.showModal();
    dialog?.addEventListener("close", closedByBrowser);

    return () => {
      dialog?.removeEventListener("close", closedByBrowser);

      if (dialog?.open) {
        dialog.close();
      }

      previous?.focus();
    };
  }, []);

  return createPortal((
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className={styles["modal"]}
      // React events bubble through portals; a submit inside must not reach a form around the opener.
      onSubmit={event => event.stopPropagation()}
      onPointerDown={event => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={event => {
        // A text selection dragged out of a field ends on the backdrop too; only a press that also started there dismisses.
        if (pressStartedOnBackdrop.current && event.target === event.currentTarget) {
          onClose();
        }

        pressStartedOnBackdrop.current = false;
      }}
    >
      <div className={styles["modal-content"]}>
        <div className={styles["modal-heading"]}>
          <div>
            {eyebrow && <span className={styles["eyebrow"]}>{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            className={ui["icon-button"]}
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  ), document.body);
}

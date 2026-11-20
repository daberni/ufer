"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { useDismiss } from "@/components/ui/use-dismiss";

type Options = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives focus when the panel opens, such as the selected option. */
  initialFocus: () => HTMLElement | null | undefined;
};

/**
 * Open state handling of an inline picker panel below its trigger: the panel focuses its selected option on opening, and Escape or a press outside the
 * field closes it. Escape is handled on the field itself because the surrounding modal dialog would otherwise close.
 */
export function usePickerPanel({
  open,
  onOpenChange,
  initialFocus
}: Options) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const initialFocusRef = useRef(initialFocus);

  useEffect(() => {
    initialFocusRef.current = initialFocus;
  });

  useEffect(() => {
    if (open) {
      initialFocusRef.current()?.focus();
    }
  }, [open]);

  useDismiss({
    active: open,
    inside: [fieldRef],
    onDismiss: () => onOpenChange(false)
  });

  function close() {
    onOpenChange(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !open || event.defaultPrevented) {
      return;
    }

    event.preventDefault();
    close();
  }

  return {
    fieldRef,
    triggerRef,
    close,
    handleKeyDown
  };
}

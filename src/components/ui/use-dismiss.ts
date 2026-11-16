"use client";

import { useEffect, useRef, type RefObject } from "react";

export type Dismissal = {
  reason: "escape" | "outside";
  /** Focus was inside the dismissed content, so the caller should move it back to the trigger. */
  focusInside: boolean;
};

type Options = {
  /** Whether the content is shown; nothing is observed otherwise. */
  active: boolean;
  /** A press outside these elements dismisses; without them, only Escape does. Include the trigger, so pressing it can toggle. */
  inside?: readonly RefObject<HTMLElement | null>[];
  onDismiss: (dismissal: Dismissal) => void;
};

function modalDialogOpen() {
  return document.querySelector("dialog[open]") !== null;
}

/**
 * Dismisses non-modal content, such as a popover or a details card, on Escape and on a press outside it. An open modal dialog owns Escape, and an Escape
 * that a control inside already handled is left alone.
 */
export function useDismiss({
  active,
  inside,
  onDismiss
}: Options) {
  const onDismissRef = useRef(onDismiss);
  const insideRef = useRef(inside);

  useEffect(() => {
    onDismissRef.current = onDismiss;
    insideRef.current = inside;
  });

  useEffect(() => {
    if (!active) {
      return;
    }

    function contains(node: Node | null) {
      return insideRef.current?.some(ref => node !== null && ref.current?.contains(node)) ?? false;
    }

    function dismissOnOutsidePress(event: PointerEvent) {
      if (!insideRef.current || contains(event.target as Node | null)) {
        return;
      }

      onDismissRef.current({
        reason: "outside",
        focusInside: false
      });
    }

    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || modalDialogOpen()) {
        return;
      }

      onDismissRef.current({
        reason: "escape",
        focusInside: contains(document.activeElement)
      });
    }

    document.addEventListener("pointerdown", dismissOnOutsidePress);
    document.addEventListener("keydown", dismissOnEscape);

    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePress);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [active]);
}

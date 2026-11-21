"use client";

import { useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { useDismiss } from "@/components/ui/use-dismiss";

/**
 * Whether the net-worth curve shows its changes: while the mouse is over it, while it has keyboard focus, or after a tap until the next tap, Escape or a press outside.
 * A mouse click focuses the curve without activating it, so the changes never outlast the hover.
 */
export function useCurveActivation() {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tapped, setTapped] = useState(false);
  const curveRef = useRef<HTMLButtonElement>(null);
  const pointerType = useRef<string | null>(null);
  const active = hovered || focused || tapped;

  useDismiss({
    active: tapped || focused,
    inside: [curveRef],
    onDismiss() {
      setTapped(false);
      setFocused(false);
    }
  });

  const curveProps = {
    ref: curveRef,
    onPointerEnter(event: PointerEvent) {
      if (event.pointerType === "mouse") {
        setHovered(true);
      }
    },
    onPointerLeave(event: PointerEvent) {
      if (event.pointerType === "mouse") {
        setHovered(false);
      }
    },
    onPointerDown(event: PointerEvent) {
      pointerType.current = event.pointerType;
    },
    // Enter or Space follow a key press; a mouse press released outside, which never clicked, must not claim that click.
    onKeyDown() {
      pointerType.current = null;
    },
    onFocus(event: FocusEvent<HTMLElement>) {
      const mousePress = pointerType.current === "mouse";

      if (!mousePress && event.currentTarget.matches(":focus-visible")) {
        setFocused(true);
      }
    },
    // A mouse press released elsewhere never clicks; its pointer type must not outlive the focus.
    onBlur() {
      pointerType.current = null;
      setFocused(false);
      setTapped(false);
    },
    onClick() {
      const input = pointerType.current;

      pointerType.current = null;

      // Enter or Space on the focused curve shows the changes again after Escape hid them.
      if (input === null) {
        setFocused(true);
      } else if (input !== "mouse") {
        setTapped(current => !current);
      }
    }
  };

  return {
    active,
    curveProps
  };
}

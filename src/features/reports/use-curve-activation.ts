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
    onFocus(event: FocusEvent<HTMLElement>) {
      const mousePress = pointerType.current === "mouse";

      if (!mousePress && event.currentTarget.matches(":focus-visible")) {
        setFocused(true);
      }
    },
    onBlur() {
      setFocused(false);
      setTapped(false);
    },
    onClick() {
      const touch = pointerType.current !== null && pointerType.current !== "mouse";

      pointerType.current = null;

      if (touch) {
        setTapped(current => !current);
      }
    }
  };

  return {
    active,
    curveProps
  };
}

"use client";

import { useEffect, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent } from "react";
import { useDismiss } from "@/components/ui/use-dismiss";

/**
 * Which element of the report shows its details: the one under the mouse, otherwise the focused or last tapped one. Mouse hover is transient and ends when the pointer leaves that element. A keyboard or touch selection lives in the shared report region of the chart and its category panel, so moving between them preserves it; keyboard focus leaving the region, Escape and an outside press clear it.
 */
export function useChartDetails() {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const inputMethod = useRef<"keyboard" | "mouse" | "touch">("keyboard");
  const activeKey = hoveredKey ?? selectedKey;
  const active = activeKey !== null;

  function clear() {
    setHoveredKey(null);
    setSelectedKey(null);
  }

  useDismiss({
    active,
    inside: [regionRef],
    onDismiss: clear
  });

  // A touch can leave focus on body; the next Tab then starts outside this region and emits no region blur.
  useEffect(() => {
    if (!active) {
      return;
    }

    function dismissOnKeyboardReturn(event: KeyboardEvent) {
      if (event.key !== "Tab" || event.defaultPrevented) {
        return;
      }

      if (!regionRef.current?.contains(document.activeElement)) {
        clear();
      }
    }

    document.addEventListener("keydown", dismissOnKeyboardReturn);

    return () => document.removeEventListener("keydown", dismissOnKeyboardReturn);
  }, [active]);

  const regionProps = {
    ref: regionRef,
    onPointerDown(event: PointerEvent) {
      inputMethod.current = event.pointerType === "mouse" ? "mouse" : "touch";
    },
    onKeyDown() {
      inputMethod.current = "keyboard";
    },
    onPointerLeave(event: PointerEvent) {
      if (event.pointerType === "mouse") {
        setHoveredKey(null);
      }
    },
    // A tap on a non-focusable category row may blur the bar while the pointer remains inside the report.
    onBlur(event: FocusEvent) {
      const focusStaysInReport = event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget);

      if (!focusStaysInReport && inputMethod.current === "keyboard") {
        setSelectedKey(null);
      }
    }
  };

  function targetProps(key: string) {
    return {
      onPointerEnter(event: PointerEvent) {
        if (event.pointerType === "mouse") {
          setHoveredKey(key);
        }
      },
      onPointerLeave(event: PointerEvent) {
        if (event.pointerType === "mouse") {
          setHoveredKey(null);
        }
      },
      // A mouse press also focuses the bar; that focus does not select, so a click never outlasts the hover.
      onFocus(event: FocusEvent<HTMLElement>) {
        if (event.currentTarget.matches(":focus-visible")) {
          inputMethod.current = "keyboard";
        }

        if (inputMethod.current !== "mouse") {
          setSelectedKey(key);
        }
      },
      onClick(event: MouseEvent) {
        const mouseClick = "pointerType" in event.nativeEvent && event.nativeEvent.pointerType === "mouse";

        if (!mouseClick) {
          setSelectedKey(key);
        }
      }
    };
  }

  return {
    activeKey,
    regionProps,
    targetProps
  };
}

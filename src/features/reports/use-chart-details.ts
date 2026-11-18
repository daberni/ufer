"use client";

import { useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { useDismiss } from "@/components/ui/use-dismiss";

/**
 * Which element of the report shows its details: the one under the mouse, the focused one or the last tapped one. The shared report region includes the chart and its category panel, so moving between them preserves the selection; mouse exit, keyboard focus leaving the region, Escape and an outside press clear it.
 */
export function useChartDetails() {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const inputMethod = useRef<"keyboard" | "pointer">("keyboard");

  useDismiss({
    active: activeKey !== null,
    inside: [regionRef],
    onDismiss: () => setActiveKey(null)
  });

  const regionProps = {
    ref: regionRef,
    onPointerDown() {
      inputMethod.current = "pointer";
    },
    onKeyDown() {
      inputMethod.current = "keyboard";
    },
    onPointerLeave(event: PointerEvent) {
      if (event.pointerType === "mouse") {
        setActiveKey(null);
      }
    },
    // A tap on a non-focusable category row may blur the bar while the pointer remains inside the report.
    onBlur(event: FocusEvent) {
      const focusStaysInReport = event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget);

      if (!focusStaysInReport && inputMethod.current === "keyboard") {
        setActiveKey(null);
      }
    }
  };

  function targetProps(key: string) {
    return {
      onPointerEnter(event: PointerEvent) {
        if (event.pointerType === "mouse") {
          inputMethod.current = "pointer";
          setActiveKey(key);
        }
      },
      onFocus(event: FocusEvent<HTMLElement>) {
        if (event.currentTarget.matches(":focus-visible")) {
          inputMethod.current = "keyboard";
        }

        setActiveKey(key);
      },
      onClick() {
        setActiveKey(key);
      }
    };
  }

  return {
    activeKey,
    regionProps,
    targetProps
  };
}

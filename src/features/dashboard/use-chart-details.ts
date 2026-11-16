"use client";

import { useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { useDismiss } from "@/components/ui/use-dismiss";

/**
 * Which element of a chart, such as one bar, shows its details: the one under the mouse, the focused one or the last tapped one. Moving the mouse or focus out of the chart, Escape and a tap outside hide them again.
 */
export function useChartDetails() {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  useDismiss({
    active: activeKey !== null,
    inside: [chartRef],
    onDismiss: () => setActiveKey(null)
  });

  const chartProps = {
    ref: chartRef,
    onPointerLeave(event: PointerEvent) {
      if (event.pointerType === "mouse") {
        setActiveKey(null);
      }
    },
    onBlur(event: FocusEvent) {
      const focusStaysInChart = event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget);

      if (!focusStaysInChart) {
        setActiveKey(null);
      }
    }
  };

  function targetProps(key: string) {
    return {
      onPointerEnter(event: PointerEvent) {
        if (event.pointerType === "mouse") {
          setActiveKey(key);
        }
      },
      onFocus() {
        setActiveKey(key);
      },
      onClick() {
        setActiveKey(key);
      }
    };
  }

  return {
    activeKey,
    chartProps,
    targetProps
  };
}

"use client";

import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";

/**
 * Which month of a chart shows its details: the month under the mouse, the focused month or the last tapped month. Moving the mouse or focus out of the chart, Escape and a tap outside hide them again.
 */
export function useMonthDetails() {
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeMonth === null) {
      return;
    }

    function dismissOutside(event: globalThis.PointerEvent) {
      const inChart = event.target instanceof Node && chartRef.current?.contains(event.target);

      if (!inChart) {
        setActiveMonth(null);
      }
    }

    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveMonth(null);
      }
    }

    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);

    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [activeMonth]);

  const chartProps = {
    ref: chartRef,
    onPointerLeave(event: PointerEvent) {
      if (event.pointerType === "mouse") {
        setActiveMonth(null);
      }
    },
    onBlur(event: FocusEvent) {
      const focusStaysInChart = event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget);

      if (!focusStaysInChart) {
        setActiveMonth(null);
      }
    }
  };

  function monthProps(month: string) {
    return {
      onPointerEnter(event: PointerEvent) {
        if (event.pointerType === "mouse") {
          setActiveMonth(month);
        }
      },
      onFocus() {
        setActiveMonth(month);
      },
      onClick() {
        setActiveMonth(month);
      }
    };
  }

  return {
    activeMonth,
    chartProps,
    monthProps
  };
}

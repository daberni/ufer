"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useDismiss } from "@/components/ui/use-dismiss";

/** Selects the step effective under the pointer, without giving every day a separate focus target. */
export function useBalanceChart(positions: number[], enabled: boolean) {
  const [selected, setSelected] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const lastIndex = positions.length - 1;
  const activeIndex = enabled && selected !== null ? Math.min(selected, lastIndex) : null;

  useDismiss({
    active: activeIndex !== null,
    inside: [plotRef],
    onDismiss: () => setSelected(null)
  });

  function selectAtPointer(event: PointerEvent<HTMLDivElement>) {
    if (!enabled) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();

    if (bounds.width <= 0) {
      return;
    }

    const position = Math.min(100, Math.max(0, (event.clientX - bounds.left) / bounds.width * 100));
    let first = 0;
    let end = positions.length;

    // The next observation takes effect at its date, not halfway across the preceding horizontal step.
    while (first < end) {
      const middle = Math.floor((first + end) / 2);

      if (positions[middle] <= position) {
        first = middle + 1;
      } else {
        end = middle;
      }
    }

    setSelected(Math.max(0, first - 1));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!enabled || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const current = activeIndex ?? lastIndex;
    const keys: Record<string, number> = {
      ArrowLeft: Math.max(0, current - 1),
      ArrowDown: Math.max(0, current - 1),
      ArrowRight: Math.min(lastIndex, current + 1),
      ArrowUp: Math.min(lastIndex, current + 1),
      Home: 0,
      End: lastIndex
    };

    if (Object.hasOwn(keys, event.key)) {
      event.preventDefault();
      setSelected(keys[event.key]);
    }
  }

  return {
    activeIndex,
    plotProps: {
      ref: plotRef,
      onKeyDown,
      onFocus() {
        if (enabled) {
          setSelected(current => current ?? lastIndex);
        }
      },
      onBlur() {
        setSelected(null);
      },
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button === 0) {
          selectAtPointer(event);
        }
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        if (event.pointerType === "mouse" || event.buttons > 0) {
          selectAtPointer(event);
        }
      },
      onPointerLeave(event: PointerEvent<HTMLDivElement>) {
        if (event.pointerType === "mouse") {
          setSelected(null);
        }
      },
      onPointerCancel() {
        setSelected(null);
      }
    }
  };
}

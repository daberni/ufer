"use client";

import ui from "../../../components/ui/primitives.module.css";

import styles from "./month-picker.module.css";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useDismiss } from "@/components/ui/use-dismiss";
import type { KeyboardEvent } from "react";
import { Temporal } from "temporal-polyfill";
import { currentMonth } from "@/features/dashboard/period";
import { describeMonth } from "@/lib/date-format";

type Props = {
  label: string;
  selected: Temporal.PlainYearMonth | null;
  onSelect: (month: Temporal.PlainYearMonth) => void;
};

const monthsPerRow = 3;
const monthCount = 12;

/** A button showing the selected period that opens a popover with a year header and a grid of months. */
export function MonthPicker({
  label,
  selected,
  onSelect
}: Props) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(0);
  const [focusedMonth, setFocusedMonth] = useState(1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();
  const now = currentMonth();

  useDismiss({
    active: open,
    inside: [rootRef],
    onDismiss: dismissal => {
      setOpen(false);

      if (dismissal.focusInside) {
        triggerRef.current?.focus();
      }
    }
  });

  useEffect(() => {
    if (open) {
      gridRef.current?.querySelector<HTMLButtonElement>("button[tabindex='0']")?.focus();
    }
  }, [open]);

  function openPicker() {
    const anchor = selected ?? now;

    setYear(anchor.year);
    setFocusedMonth(anchor.month);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function choose(month: number) {
    onSelect(Temporal.PlainYearMonth.from({
      year,
      month
    }));
    close();
  }

  function moveFocus(month: number) {
    setFocusedMonth(month);
    gridRef.current?.querySelector<HTMLButtonElement>(`button[data-month='${month}']`)?.focus();
  }

  function handleGridKeyDown(event: KeyboardEvent) {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -monthsPerRow,
      ArrowDown: monthsPerRow
    };
    const offset = offsets[event.key];

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      moveFocus(event.key === "Home" ? 1 : monthCount);

      return;
    }

    if (offset === undefined) {
      return;
    }

    event.preventDefault();

    const target = focusedMonth + offset;

    if (target >= 1 && target <= monthCount) {
      moveFocus(target);
    }
  }

  return (
    <div className={styles["root"]} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles["trigger"]}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={`Select month, ${label}`}
        onClick={() => open ? close() : openPicker()}
      >
        {label}
      </button>
      {open && (
        <div
          id={dialogId}
          className={styles["popover"]}
          role="dialog"
          aria-label="Choose a month"
        >
          <div className={styles["year-bar"]}>
            <button
              type="button"
              className={ui["icon-button"]}
              aria-label="Previous year"
              onClick={() => setYear(year - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <span className={styles["year"]} aria-live="polite">{year}</span>
            <button
              type="button"
              className={ui["icon-button"]}
              aria-label="Next year"
              onClick={() => setYear(year + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
          <div
            className={styles["grid"]}
            ref={gridRef}
            role="group"
            aria-label={`Months of ${year}`}
            onKeyDown={handleGridKeyDown}
          >
            {Array.from({
              length: monthCount
            }, (_, index) => {
              const month = index + 1;
              const isSelected = selected?.year === year && selected.month === month;
              const isCurrent = now.year === year && now.month === month;
              const display = describeMonth(Temporal.PlainYearMonth.from({
                year,
                month
              }));

              return (
                <button
                  key={month}
                  type="button"
                  data-month={month}
                  tabIndex={month === focusedMonth ? 0 : -1}
                  className={clsx(styles["month"], isSelected && styles["selected"], isCurrent && styles["current"])}
                  aria-pressed={isSelected}
                  aria-current={isCurrent ? "date" : undefined}
                  onClick={() => choose(month)}
                >
                  {display.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

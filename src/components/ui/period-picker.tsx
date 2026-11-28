"use client";

import ui from "./primitives.module.css";

import styles from "./period-picker.module.css";
import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useAnchoredPopover } from "@/components/ui/use-anchored-popover";
import { useDismiss } from "@/components/ui/use-dismiss";
import type { KeyboardEvent } from "react";
import { Temporal } from "temporal-polyfill";
import { today } from "@/lib/time";
import { describeMonth, formatYear } from "@/lib/date-format";
import { useLocale } from "@/client/locale-provider";
import { useTranslations } from "next-intl";

/** The calendar unit a picker offers: months and quarters page by year, years by blocks of twelve. */
export type PickerUnit = "month" | "quarter" | "year";

type Props = {
  unit: PickerUnit;
  label: string;
  /** Any day of the selected period, or null when none of the unit's periods is selected. */
  selected: Temporal.PlainDate | null;
  /** Receives the first day of the chosen period. */
  onSelect: (start: Temporal.PlainDate) => void;
};

type Layout = {
  count: number;
  columns: number;
  page: (date: Temporal.PlainDate) => number;
  index: (date: Temporal.PlainDate) => number;
  start: (page: number, index: number) => Temporal.PlainDate;
  cellLabel: (start: Temporal.PlainDate, locale: string) => string;
  pageLabel: (page: number, locale: string) => string;
};

const yearsPerPage = 12;

const layouts: Record<PickerUnit, Layout> = {
  month: {
    count: 12,
    columns: 3,
    page: date => date.year,
    index: date => date.month - 1,
    start: (year, index) => Temporal.PlainDate.from({
      year,
      month: index + 1,
      day: 1
    }),
    cellLabel: (start, locale) => describeMonth(start.toPlainYearMonth(), locale).label,
    pageLabel: formatYear
  },
  quarter: {
    count: 4,
    columns: 2,
    page: date => date.year,
    index: date => Math.floor((date.month - 1) / 3),
    start: (year, index) => Temporal.PlainDate.from({
      year,
      month: index * 3 + 1,
      day: 1
    }),
    cellLabel: start => `Q${Math.floor((start.month - 1) / 3) + 1}`,
    pageLabel: formatYear
  },
  year: {
    count: yearsPerPage,
    columns: 3,
    page: date => Math.floor(date.year / yearsPerPage),
    index: date => date.year % yearsPerPage,
    start: (page, index) => Temporal.PlainDate.from({
      year: page * yearsPerPage + index,
      month: 1,
      day: 1
    }),
    cellLabel: (start, locale) => formatYear(start.year, locale),
    pageLabel: (page, locale) => `${formatYear(page * yearsPerPage, locale)} – ${formatYear(page * yearsPerPage + yearsPerPage - 1, locale)}`
  }
};

/** A button showing the selected period that opens a popover with a page header and a grid of the unit's periods. */
export function PeriodPicker({
  unit,
  label,
  selected,
  onSelect
}: Props) {
  const t = useTranslations("common.periodPicker");
  const locale = useLocale();
  const layout = layouts[unit];
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();
  const pageId = useId();
  const now = today();

  useDismiss({
    active: open,
    inside: [rootRef, popupRef],
    onDismiss: dismissal => {
      setOpen(false);

      if (dismissal.focusInside) {
        triggerRef.current?.focus();
      }
    }
  });

  // The popover joins the top layer like the other popups, so a scrolling header or a dialog cannot clip it.
  useAnchoredPopover({
    open,
    anchorRef: triggerRef,
    popupRef
  });

  useEffect(() => {
    if (open) {
      gridRef.current?.querySelector<HTMLButtonElement>("button[tabindex='0']")?.focus();
    }
  }, [open]);

  function openPicker() {
    const anchor = selected ?? now;

    setPage(layout.page(anchor));
    setFocusedIndex(layout.index(anchor));
    setOpen(true);
  }

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function choose(index: number) {
    onSelect(layout.start(page, index));
    close();
  }

  function moveFocus(index: number) {
    setFocusedIndex(index);
    gridRef.current?.querySelector<HTMLButtonElement>(`button[data-index='${index}']`)?.focus();
  }

  function handleGridKeyDown(event: KeyboardEvent) {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -layout.columns,
      ArrowDown: layout.columns
    };
    const offset = offsets[event.key];

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      moveFocus(event.key === "Home" ? 0 : layout.count - 1);

      return;
    }

    if (offset === undefined) {
      return;
    }

    event.preventDefault();

    const target = focusedIndex + offset;

    if (target >= 0 && target < layout.count) {
      moveFocus(target);
    }
  }

  const selectedIndex = selected && layout.page(selected) === page ? layout.index(selected) : null;
  const currentIndex = layout.page(now) === page ? layout.index(now) : null;

  return (
    <div className={styles["root"]} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles["trigger"]}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={t("trigger", {
          label
        })}
        onClick={() => open ? close() : openPicker()}
      >
        {label}
      </button>
      <div
        ref={popupRef}
        id={dialogId}
        className={styles["popover"]}
        popover="manual"
        role="dialog"
        aria-label={t("dialog", {
          unit
        })}
      >
        {open && (
          <>
            <div className={styles["page-bar"]}>
              <button
                type="button"
                className={ui["icon-button"]}
                aria-label={t("previousPage", {
                  unit
                })}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft size={17} />
              </button>
              {/* The only announcement of a page change; the cells are labelled by it instead of repeating the year. */}
              <span id={pageId} className={styles["page"]} aria-live="polite">{layout.pageLabel(page, locale)}</span>
              <button
                type="button"
                className={ui["icon-button"]}
                aria-label={t("nextPage", {
                  unit
                })}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={17} />
              </button>
            </div>
            <div
              className={clsx(styles["grid"], layout.columns === 2 && styles["two-columns"])}
              ref={gridRef}
              role="group"
              aria-labelledby={pageId}
              onKeyDown={handleGridKeyDown}
            >
              {Array.from({
                length: layout.count
              }, (_, index) => {
                const isSelected = index === selectedIndex;
                const isCurrent = index === currentIndex;

                return (
                  <button
                    key={index}
                    type="button"
                    data-index={index}
                    tabIndex={index === focusedIndex ? 0 : -1}
                    className={clsx(styles["cell"], isSelected && styles["selected"], isCurrent && styles["current"])}
                    aria-pressed={isSelected}
                    aria-current={isCurrent ? "date" : undefined}
                    onClick={() => choose(index)}
                  >
                    {layout.cellLabel(layout.start(page, index), locale)}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

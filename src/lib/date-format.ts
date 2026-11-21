import { Temporal } from "temporal-polyfill";
import type { Period } from "./period";
import { today } from "./time";

// Ufer's data and navigation use ISO dates, so every date is shown in the Gregorian calendar; the locale still decides month names, numerals, order and hour cycle.

export type DateDisplay = {
  dateTime: string;
  label: string;
  title: string;
};

// A plain date has no time or zone to show; a zoned timestamp names its zone in the title
// because the same instant reads differently elsewhere.
export function describeDate(value: Temporal.PlainDate | Temporal.ZonedDateTime, locale: string, now = Temporal.Now.instant()): DateDisplay {
  // Calendar dates follow the product year; timestamps compare years in the same zone used to display them.
  const currentYear = value instanceof Temporal.PlainDate ? today(now).year : now.toZonedDateTimeISO(value.timeZoneId).year;
  const label = value.toLocaleString(locale, {
    calendar: "gregory",
    day: "numeric",
    month: "short",
    year: value.year === currentYear ? undefined : "numeric"
  });

  if (value instanceof Temporal.PlainDate) {
    return {
      dateTime: value.toString(),
      label,
      title: value.toLocaleString(locale, {
        calendar: "gregory",
        dateStyle: "full"
      })
    };
  }

  return {
    dateTime: value.toInstant().toString(),
    label,
    title: value.toLocaleString(locale, {
      calendar: "gregory",
      dateStyle: "long",
      timeStyle: "long"
    })
  };
}

/** A timestamp labelled with its day and minute, so several events on one day stay distinguishable. */
export function describeDateTime(value: Temporal.ZonedDateTime, locale: string, now = Temporal.Now.instant()): DateDisplay {
  const display = describeDate(value, locale, now);
  const currentYear = now.toZonedDateTimeISO(value.timeZoneId).year;

  // One locale-aware call keeps the locale's own order and punctuation between date and time.
  return {
    ...display,
    label: value.toLocaleString(locale, {
      calendar: "gregory",
      day: "numeric",
      month: "short",
      year: value.year === currentYear ? undefined : "numeric",
      hour: "numeric",
      minute: "2-digit"
    })
  };
}

/** A calendar day with its year, for values that may lie in another year, such as a balance history. */
export function dateWithYear(value: Temporal.PlainDate, locale: string) {
  return value.toLocaleString(locale, {
    calendar: "gregory",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

// A month has no day or zone, so its names cannot shift with the viewer's zone.
export function describeMonth(month: Temporal.PlainYearMonth, locale: string) {
  const firstDay = month.toPlainDate({
    day: 1
  });

  return {
    label: firstDay.toLocaleString(locale, {
      calendar: "gregory",
      month: "short"
    }),
    title: firstDay.toLocaleString(locale, {
      calendar: "gregory",
      month: "long",
      year: "numeric"
    })
  };
}

export function periodLabel(period: Period, locale: string) {
  return period.kind === "all" ? "All months" : describeMonth(period.month, locale).title;
}

// Month and year are formatted together, so the locale decides their order, spacing and numerals.
function monthFormat(locale: string) {
  return new Intl.DateTimeFormat(locale, {
    calendar: "gregory",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });
}

// Date.UTC maps years 0–99 to 1900–1999, so the year is set separately.
function utcDate(year: number, monthIndex: number, day: number) {
  const date = new Date(0);

  date.setUTCFullYear(year, monthIndex, day);

  return date;
}

function monthStart(month: Temporal.PlainYearMonth) {
  return utcDate(month.year, month.month - 1, 1);
}

/** A calendar year in the locale's numerals and style, e.g. "2026" in English or "2026年" in Japanese. */
export function formatYear(year: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    calendar: "gregory",
    year: "numeric",
    timeZone: "UTC"
  }).format(utcDate(year, 0, 1));
}

/** A short month with its year, e.g. "Dec 2025" in English. */
export function shortMonthWithYear(month: Temporal.PlainYearMonth, locale: string) {
  return monthFormat(locale).format(monthStart(month));
}

/** Labels a month range such as the cash-flow trend window, e.g. "Jun – Nov 2026" or "Dec 2025 – May 2026" in English; the locale collapses a shared year. */
export function monthRangeLabel(months: Temporal.PlainYearMonth[], locale: string) {
  if (!months.length) {
    return "";
  }

  return monthFormat(locale).formatRange(monthStart(months[0]), monthStart(months[months.length - 1]));
}

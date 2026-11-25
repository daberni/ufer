import { Temporal } from "temporal-polyfill";
import { describeMonth, formatYear, monthRangeLabel } from "@/lib/date-format";
import type { DateSpan, PeriodRange } from "@/lib/period-range";

// Plain dates have no zone; formatting them as UTC midnight keeps their day in every viewer's zone.
function utcDate(date: Temporal.PlainDate) {
  const value = new Date(0);

  value.setUTCFullYear(date.year, date.month - 1, date.day);

  return value;
}

function dayFormat(locale: string, withYear: boolean) {
  return new Intl.DateTimeFormat(locale, {
    calendar: "gregory",
    day: "numeric",
    month: "short",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC"
  });
}

function twoDigitYear(year: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    calendar: "gregory",
    year: "2-digit",
    timeZone: "UTC"
  }).format(utcDate(Temporal.PlainDate.from({
    year,
    month: 1,
    day: 1
  })));
}

function quarterOf(date: Temporal.PlainDate) {
  return Math.ceil(date.month / 3);
}

/** A span of days such as "Oct 1 – 25, 2026"; the locale collapses the shared month and year. */
export function daySpanLabel(span: DateSpan, locale: string) {
  const parts = dayFormat(locale, true).formatRangeToParts(utcDate(Temporal.PlainDate.from(span.start)), utcDate(Temporal.PlainDate.from(span.end)));

  return parts.map(part => part.source === "shared" ? withPlainDashSpacing(part.value) : part.value).join("");
}

// ICU versions disagree on the spaces around the range dash (Node uses thin spaces, browsers plain ones), so server and browser renders would not hydrate identically.
function withPlainDashSpacing(separator: string) {
  return separator.replace(/[\u00A0\u2009\u202F](?=[\u2013\u2014-])|(?<=[\u2013\u2014-])[\u00A0\u2009\u202F]/g, " ");
}

/** The full name of a range: "November 2026", "Q4 2026", "2026" or the custom days. */
export function rangeTitle(range: PeriodRange, locale: string) {
  if (range.interval === "month") {
    return describeMonth(range.start.toPlainYearMonth(), locale).title;
  }

  if (range.interval === "quarter") {
    return `Q${quarterOf(range.start)} ${formatYear(range.start.year, locale)}`;
  }

  if (range.interval === "year") {
    return formatYear(range.start.year, locale);
  }

  return daySpanLabel({
    start: range.start.toString(),
    end: range.end.toString()
  }, locale);
}

/** A chart column's short label: "Nov", "Q4 26", "2026" or a custom range's first day. */
export function rangeLabel(range: PeriodRange, locale: string) {
  if (range.interval === "month") {
    return describeMonth(range.start.toPlainYearMonth(), locale).label;
  }

  if (range.interval === "quarter") {
    return `Q${quarterOf(range.start)} ${twoDigitYear(range.start.year, locale)}`;
  }

  if (range.interval === "year") {
    return formatYear(range.start.year, locale);
  }

  return dayFormat(locale, false).format(utcDate(range.start));
}

/** The span the chart's columns cover, from the first column's start to the last one's end. */
export function columnsLabel(columns: PeriodRange[], locale: string) {
  const first = columns[0];
  const last = columns[columns.length - 1];

  if (!first || !last) {
    return "";
  }

  if (first.interval === "month") {
    return monthRangeLabel(columns.map(column => column.start.toPlainYearMonth()), locale);
  }

  if (first.interval === "custom") {
    return daySpanLabel({
      start: first.start.toString(),
      end: last.end.toString()
    }, locale);
  }

  return `${rangeTitle(first, locale)} – ${rangeTitle(last, locale)}`;
}

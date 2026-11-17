import { Temporal } from "temporal-polyfill";
import type { Period } from "./period";

// Central place for date display so a locale can be introduced in one spot.
const displayLocale = "en-GB";

export type DateDisplay = {
  dateTime: string;
  label: string;
  title: string;
};

// A plain date has no time or zone to show; a zoned timestamp names its zone in the title
// because the same instant reads differently elsewhere.
export function describeDate(value: Temporal.PlainDate | Temporal.ZonedDateTime): DateDisplay {
  if (value instanceof Temporal.PlainDate) {
    return {
      dateTime: value.toString(),
      label: value.toLocaleString(displayLocale, {
        day: "numeric",
        month: "short"
      }),
      title: value.toLocaleString(displayLocale, {
        dateStyle: "full"
      })
    };
  }

  return {
    dateTime: value.toInstant().toString(),
    label: value.toLocaleString(displayLocale, {
      day: "numeric",
      month: "short"
    }),
    title: value.toLocaleString(displayLocale, {
      dateStyle: "long",
      timeStyle: "long"
    })
  };
}

// A month has no day or zone, so its names cannot shift with the viewer's zone.
export function describeMonth(month: Temporal.PlainYearMonth) {
  const firstDay = month.toPlainDate({
    day: 1
  });

  return {
    label: firstDay.toLocaleString(displayLocale, {
      month: "short"
    }),
    title: firstDay.toLocaleString(displayLocale, {
      month: "long",
      year: "numeric"
    })
  };
}

export function periodLabel(period: Period) {
  return period.kind === "all" ? "All months" : describeMonth(period.month).title;
}

/** Labels a month range such as the cash-flow trend window, e.g. "Jun – Nov 2026" or "Dec 2025 – May 2026". */
export function monthRangeLabel(months: Temporal.PlainYearMonth[]) {
  if (!months.length) {
    return "";
  }

  const first = months[0];
  const last = months[months.length - 1];
  const start = first.year === last.year ? describeMonth(first).label : `${describeMonth(first).label} ${first.year}`;

  return `${start} – ${describeMonth(last).label} ${last.year}`;
}

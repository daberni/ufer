import { Temporal } from "temporal-polyfill";
import type { Period } from "./period";
import { today } from "./time";

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
    day: "numeric",
    month: "short",
    year: value.year === currentYear ? undefined : "numeric"
  });

  if (value instanceof Temporal.PlainDate) {
    return {
      dateTime: value.toString(),
      label,
      title: value.toLocaleString(locale, {
        dateStyle: "full"
      })
    };
  }

  return {
    dateTime: value.toInstant().toString(),
    label,
    title: value.toLocaleString(locale, {
      dateStyle: "long",
      timeStyle: "long"
    })
  };
}

/** A calendar day with its year, for values that may lie in another year, such as a balance history. */
export function dateWithYear(value: Temporal.PlainDate, locale: string) {
  return value.toLocaleString(locale, {
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
      month: "short"
    }),
    title: firstDay.toLocaleString(locale, {
      month: "long",
      year: "numeric"
    })
  };
}

export function periodLabel(period: Period, locale: string) {
  return period.kind === "all" ? "All months" : describeMonth(period.month, locale).title;
}

/** Labels a month range such as the cash-flow trend window, e.g. "Jun – Nov 2026" or "Dec 2025 – May 2026". */
export function monthRangeLabel(months: Temporal.PlainYearMonth[], locale: string) {
  if (!months.length) {
    return "";
  }

  const first = months[0];
  const last = months[months.length - 1];
  const start = first.year === last.year ? describeMonth(first, locale).label : `${describeMonth(first, locale).label} ${first.year}`;

  return `${start} – ${describeMonth(last, locale).label} ${last.year}`;
}

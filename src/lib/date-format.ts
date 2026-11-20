import { Temporal } from "temporal-polyfill";
import type { Period } from "./period";
import { appLocale } from "./locale";
import { today } from "./time";

export type DateDisplay = {
  dateTime: string;
  label: string;
  title: string;
};

// A plain date has no time or zone to show; a zoned timestamp names its zone in the title
// because the same instant reads differently elsewhere.
export function describeDate(value: Temporal.PlainDate | Temporal.ZonedDateTime, now = Temporal.Now.instant()): DateDisplay {
  // Calendar dates follow the product year; timestamps compare years in the same zone used to display them.
  const currentYear = value instanceof Temporal.PlainDate ? today(now).year : now.toZonedDateTimeISO(value.timeZoneId).year;
  const label = value.toLocaleString(appLocale, {
    day: "numeric",
    month: "short",
    year: value.year === currentYear ? undefined : "numeric"
  });

  if (value instanceof Temporal.PlainDate) {
    return {
      dateTime: value.toString(),
      label,
      title: value.toLocaleString(appLocale, {
        dateStyle: "full"
      })
    };
  }

  return {
    dateTime: value.toInstant().toString(),
    label,
    title: value.toLocaleString(appLocale, {
      dateStyle: "long",
      timeStyle: "long"
    })
  };
}

/** A calendar day with its year, for values that may lie in another year, such as a balance history. */
export function dateWithYear(value: Temporal.PlainDate) {
  return value.toLocaleString(appLocale, {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

// A month has no day or zone, so its names cannot shift with the viewer's zone.
export function describeMonth(month: Temporal.PlainYearMonth) {
  const firstDay = month.toPlainDate({
    day: 1
  });

  return {
    label: firstDay.toLocaleString(appLocale, {
      month: "short"
    }),
    title: firstDay.toLocaleString(appLocale, {
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

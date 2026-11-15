import { Temporal } from "temporal-polyfill";

// Central place for date display so a locale can be introduced in one spot.
const displayLocale = "en-GB";
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export type DateDisplay = {
  dateTime: string;
  label: string;
  title: string;
};

export function isDateOnly(value: string) {
  return dateOnlyPattern.test(value);
}

// Date-only values (booking and balance dates) are plain calendar days: the day never shifts with
// the viewer's timezone, and the title carries no time or zone.
// Timestamps (sync runs, authorization expiry) render in the viewer's timezone unless one is given,
// and the title names that zone because the same instant reads differently elsewhere.
export function describeDate(value: string, locale = displayLocale, timeZone?: string): DateDisplay {
  if (isDateOnly(value)) {
    const day = Temporal.PlainDate.from(value);

    return {
      dateTime: day.toString(),
      label: day.toLocaleString(locale, {
        day: "numeric",
        month: "short"
      }),
      title: day.toLocaleString(locale, {
        dateStyle: "full"
      })
    };
  }

  const instant = Temporal.Instant.from(value);
  const moment = instant.toZonedDateTimeISO(timeZone ?? Temporal.Now.timeZoneId());

  return {
    dateTime: instant.toString(),
    label: moment.toLocaleString(locale, {
      day: "numeric",
      month: "short"
    }),
    title: moment.toLocaleString(locale, {
      dateStyle: "long",
      timeStyle: "long"
    })
  };
}

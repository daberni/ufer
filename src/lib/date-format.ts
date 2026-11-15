import { Temporal } from "temporal-polyfill";

// Central place for date display so a locale can be introduced in one spot.
const displayLocale = "en-GB";

// Zone for the server render and first client render, so hydration is deterministic.
// Matches the product zone of viennaMonth; clients then switch to their own zone after mount.
export const defaultTimeZone = "Europe/Vienna";
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export type DateDisplay = {
  dateTime: string;
  label: string;
  title: string;
};

// Parses an API value once at the boundary: date-only strings (booking and balance dates) become
// plain calendar days that never shift with a timezone; timestamps (sync runs, authorization expiry)
// become instants placed in the given zone.
export function parseDisplayDate(value: string, timeZone: string): Temporal.PlainDate | Temporal.ZonedDateTime {
  if (dateOnlyPattern.test(value)) {
    return Temporal.PlainDate.from(value);
  }

  return Temporal.Instant.from(value).toZonedDateTimeISO(timeZone);
}

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

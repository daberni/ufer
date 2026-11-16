import { Temporal } from "temporal-polyfill";

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

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

// Date-only values (booking and balance dates) are calendar days: they are rendered in UTC so the
// day never shifts with the viewer's timezone, and the title deliberately carries no time or zone.
// Timestamps (sync runs, authorization expiry) are rendered in the viewer's timezone, and the title
// names that zone because the same instant reads differently elsewhere.
export function describeDate(value: string, locale = displayLocale): DateDisplay {
  if (isDateOnly(value)) {
    const day = new Date(`${value}T12:00:00Z`);

    return {
      dateTime: value,
      label: new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        timeZone: "UTC"
      }).format(day),
      title: new Intl.DateTimeFormat(locale, {
        dateStyle: "full",
        timeZone: "UTC"
      }).format(day)
    };
  }

  const instant = new Date(value);

  return {
    dateTime: instant.toISOString(),
    label: new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short"
    }).format(instant),
    title: new Intl.DateTimeFormat(locale, {
      dateStyle: "long",
      timeStyle: "long"
    }).format(instant)
  };
}

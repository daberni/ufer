"use client";

import { Temporal } from "temporal-polyfill";
import { describeDate } from "@/lib/date-format";
import { useDisplayTimeZone } from "./use-display-time-zone";
import { useLocale } from "@/client/locale-provider";

type DisplayProps = {
  value: string | null;
  fallback?: string;
};

// A calendar day such as a booking or balance date (YYYY-MM-DD): independent of any timezone.
export function DateValue({
  value,
  fallback = "—"
}: DisplayProps) {
  const locale = useLocale();

  if (!value) {
    return <>{fallback}</>;
  }

  const display = describeDate(Temporal.PlainDate.from(value), locale);

  return <time dateTime={display.dateTime} title={display.title}>{display.label}</time>;
}

// A calendar day written out in full, for example a document's last update, in the request's format locale.
export function FullDateValue({ value }: {
  value: string
}) {
  const locale = useLocale();
  const display = describeDate(Temporal.PlainDate.from(value), locale);

  return <time dateTime={display.dateTime}>{display.title}</time>;
}

// An instant such as a sync run or authorization expiry: shown in the viewer's timezone.
export function TimestampValue({
  value,
  fallback = "—"
}: DisplayProps) {
  const timeZone = useDisplayTimeZone();
  const locale = useLocale();

  if (!value) {
    return <>{fallback}</>;
  }

  const display = describeDate(Temporal.Instant.from(value).toZonedDateTimeISO(timeZone), locale);

  return <time dateTime={display.dateTime} title={display.title}>{display.label}</time>;
}

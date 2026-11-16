"use client";

import { Temporal } from "temporal-polyfill";
import { describeDate } from "@/lib/date-format";
import { storedInstant } from "@/lib/time";
import { useDisplayTimeZone } from "./use-display-time-zone";

type DisplayProps = {
  value: string | null;
  fallback?: string;
};

// A calendar day such as a booking or balance date (YYYY-MM-DD): independent of any timezone.
export function DateValue({
  value,
  fallback = "—"
}: DisplayProps) {
  if (!value) {
    return <>{fallback}</>;
  }

  const display = describeDate(Temporal.PlainDate.from(value));

  return <time dateTime={display.dateTime} title={display.title}>{display.label}</time>;
}

// An instant such as a sync run or authorization expiry: shown in the viewer's timezone.
export function TimestampValue({
  value,
  fallback = "—"
}: DisplayProps) {
  const timeZone = useDisplayTimeZone();

  if (!value) {
    return <>{fallback}</>;
  }

  const display = describeDate(storedInstant(value).toZonedDateTimeISO(timeZone));

  return <time dateTime={display.dateTime} title={display.title}>{display.label}</time>;
}

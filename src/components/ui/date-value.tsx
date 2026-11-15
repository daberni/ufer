"use client";

import { describeDate } from "@/lib/date-format";
import { useDisplayTimeZone } from "./use-display-time-zone";

export function DateValue({
  value,
  fallback = "—"
}: {
  value: string | null;
  fallback?: string
}) {
  const timeZone = useDisplayTimeZone();

  if (!value) {
    return <>{fallback}</>;
  }

  const display = describeDate(value, undefined, timeZone);

  return <time dateTime={display.dateTime} title={display.title}>{display.label}</time>;
}

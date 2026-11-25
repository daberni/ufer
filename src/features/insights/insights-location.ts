"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { parseRange, rangeContaining, serializeRange, type PeriodRange } from "@/lib/period-range";
import { today } from "@/lib/time";

const rangeKey = "range";

/** The insights' range from the URL; the current month when absent or invalid. */
export function insightsRange(value: string | null, current = today()) {
  return (value ? parseRange(value) : null) ?? rangeContaining("month", current);
}

export function useInsightsRange() {
  const value = useSearchParams().get(rangeKey);

  return useMemo(() => insightsRange(value), [value]);
}

/** Selects a range as a new history entry; the current month is the default and leaves the URL plain. */
export function selectRange(range: PeriodRange) {
  const params = new URLSearchParams(window.location.search);
  const isDefault = serializeRange(range) === serializeRange(rangeContaining("month", today()));

  if (isDefault) {
    params.delete(rangeKey);
  } else {
    params.set(rangeKey, serializeRange(range));
  }

  const query = params.toString();
  const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;

  if (next !== `${window.location.pathname}${window.location.search}`) {
    window.history.pushState(null, "", next);
  }
}

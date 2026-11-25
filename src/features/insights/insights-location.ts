"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { parseRange, rangeContaining, serializeRange, type PeriodRange } from "@/lib/period-range";
import { today } from "@/lib/time";
import type { HistoryFlow } from "@/features/insights/category-history";

const rangeKey = "range";
const categoryKey = "category";
const flowKey = "type";

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

/** The category whose history the insights show, with its flow (expenses unless the URL names income); null without a category. */
export function useInsightsCategory() {
  const params = useSearchParams();
  const category = params.get(categoryKey);
  const flow: HistoryFlow = params.get(flowKey) === "income" ? "income" : "expense";

  return useMemo(() => category ? {
    category,
    flow
  } : null, [category, flow]);
}

/** Returns from a category's history to the whole insights, keeping the range. */
export function clearCategory() {
  const params = new URLSearchParams(window.location.search);

  params.delete(categoryKey);
  params.delete(flowKey);

  const query = params.toString();

  window.history.pushState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
}

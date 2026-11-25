"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet } from "@/client/api";
import { queryKeys } from "@/client/query-keys";
import { serializeRange, type PeriodRange } from "@/lib/period-range";
import type { Insights, NetWorthChangeComparison } from "./types";

export function useInsights(range: PeriodRange, currency: string) {
  const filters = {
    range: serializeRange(range),
    currency
  };

  return useQuery({
    queryKey: queryKeys.reports.insightsFor(filters),
    queryFn: ({ signal }) => apiGet<Insights>("reports/insights", filters, signal),
    placeholderData: keepPreviousData
  });
}

export function useNetWorthChange(range: PeriodRange, currency: string) {
  const filters = {
    range: serializeRange(range),
    currency
  };

  return useQuery({
    queryKey: queryKeys.reports.netWorthChangeFor(filters),
    queryFn: ({ signal }) => apiGet<NetWorthChangeComparison>("reports/net-worth/change", filters, signal),
    placeholderData: keepPreviousData
  });
}

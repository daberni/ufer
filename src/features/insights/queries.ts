"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet, apiQuery } from "@/client/api";
import { queryKeys } from "@/client/query-keys";
import { serializeRange, type PeriodRange } from "@/lib/period-range";
import type { Insights, NetWorthChangeComparison } from "./types";
import type { HistoryFlow } from "./category-history";
import type { TransactionPage } from "@/features/transactions/types";

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

/** One page of the transactions behind a category's history: the category's income or expense bookings in the range and currency. */
export function useCategoryTransactions(range: PeriodRange, currency: string, category: string, flow: HistoryFlow, page: number) {
  const filters = {
    period: "",
    range: serializeRange(range),
    currency,
    search: "",
    account: "",
    category,
    type: flow,
    syncRun: "",
    page
  };

  return useQuery({
    queryKey: queryKeys.transactions.list(filters),
    queryFn: ({ signal }) => apiQuery<TransactionPage>("transactions/query", filters, signal),
    placeholderData: keepPreviousData
  });
}

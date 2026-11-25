"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiGet } from "@/client/api";
import { queryKeys } from "@/client/query-keys";
import { serializePeriod, type Period } from "@/lib/period";
import type { AccountCashFlow, CashFlow, CashFlowHistory } from "./types";
import type { NetWorthHistory } from "./net-worth-series";

export function useCashFlow(period: Period, currency: string) {
  const filters = {
    period: serializePeriod(period),
    currency
  };

  return useQuery({
    queryKey: queryKeys.reports.cashFlowFor(filters),
    queryFn: ({ signal }) => apiGet<CashFlow>("reports/cash-flow", filters, signal),
    placeholderData: keepPreviousData
  });
}

/** Earlier trend months in batches, each before the oldest month loaded so far, starting before `firstMonth`; nothing loads until `enabled`, and further batches load through `fetchNextPage`. */
export function useCashFlowHistory(firstMonth: string, currency: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.reports.cashFlowHistoryFor({
      before: firstMonth,
      currency
    }),
    queryFn: ({
      pageParam,
      signal
    }) => apiGet<CashFlowHistory>("reports/cash-flow/history", {
      before: pageParam,
      currency
    }, signal),
    initialPageParam: firstMonth,
    getNextPageParam: page => page.hasEarlier ? page.trend[0]?.month : undefined,
    enabled
  });
}

export function useAccountCashFlow(accountId: string, period: Period) {
  const filters = {
    account: accountId,
    period: serializePeriod(period)
  };

  return useQuery({
    queryKey: queryKeys.reports.accountCashFlowFor(filters),
    queryFn: ({ signal }) => apiGet<AccountCashFlow>(`accounts/${encodeURIComponent(accountId)}/cash-flow`, {
      period: filters.period
    }, signal),
    placeholderData: keepPreviousData
  });
}

export function useNetWorthHistory(currency: string) {
  return useQuery({
    queryKey: queryKeys.reports.netWorthHistoryIn(currency),
    queryFn: ({ signal }) => apiGet<NetWorthHistory>("reports/net-worth/history", {
      currency
    }, signal),
    placeholderData: keepPreviousData
  });
}

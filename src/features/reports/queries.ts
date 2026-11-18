"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet } from "@/client/api";
import { queryKeys } from "@/client/query-keys";
import { serializePeriod, type Period } from "@/lib/period";
import type { AccountCashFlow, CashFlow } from "./types";

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

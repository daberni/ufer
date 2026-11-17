"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet } from "@/client/api";
import { queryKeys } from "@/client/query-keys";
import { serializePeriod, type Period } from "@/lib/period";
import type { CashFlow } from "./types";

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

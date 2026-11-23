"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/client/api";
import { queryKeys } from "@/client/query-keys";
import type { BrokeragePerformance, BrokerageTrades, SecurityList } from "./types";

export function useBrokerageTrades(accountId: string) {
  return useQuery({
    queryKey: queryKeys.securities.brokerage(accountId),
    queryFn: ({ signal }) => apiGet<BrokerageTrades>(`brokerage-accounts/${encodeURIComponent(accountId)}/trades`, undefined, signal)
  });
}

export function useBrokeragePerformance(accountId: string) {
  return useQuery({
    queryKey: queryKeys.securities.performance(accountId),
    queryFn: ({ signal }) => apiGet<BrokeragePerformance>(`brokerage-accounts/${encodeURIComponent(accountId)}/performance`, undefined, signal)
  });
}

export function useSecurities() {
  return useQuery({
    queryKey: queryKeys.securities.all(),
    queryFn: ({ signal }) => apiGet<SecurityList>("securities", undefined, signal)
  });
}


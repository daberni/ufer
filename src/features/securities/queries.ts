"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/client/api";
import { queryKeys } from "@/client/query-keys";
import type { BrokerageTrades, Listing, SecurityList } from "./types";

export function useBrokerageTrades(accountId: string) {
  return useQuery({
    queryKey: queryKeys.securities.brokerage(accountId),
    queryFn: ({ signal }) => apiGet<BrokerageTrades>(`brokerage-accounts/${encodeURIComponent(accountId)}/trades`, undefined, signal)
  });
}

export function useSecurities() {
  return useQuery({
    queryKey: queryKeys.securities.all(),
    queryFn: ({ signal }) => apiGet<SecurityList>("securities", undefined, signal)
  });
}

/** The provider's listings for an ISIN, for changing a security's price listing; only fetched while that edit is open. */
export function useListings(isin: string | null) {
  return useQuery({
    queryKey: [...queryKeys.securities.all(), "listings", isin],
    queryFn: ({ signal }) => apiGet<Listing[]>("securities/listings", {
      isin: isin ?? ""
    }, signal),
    enabled: isin !== null,
    retry: false
  });
}

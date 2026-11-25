"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/client/api";
import { queryKeys } from "@/client/query-keys";
import type { Bank, Connection, SyncRun } from "@/features/banking/types";
import { directoryBanks } from "./bank-selection";

export function useConnections() {
  return useQuery({
    queryKey: queryKeys.banking.connections(),
    queryFn: ({ signal }) => apiGet<Connection[]>("banking/connections", undefined, signal)
  });
}

export function useSyncRuns() {
  return useQuery({
    queryKey: queryKeys.banking.syncRuns(),
    queryFn: ({ signal }) => apiGet<SyncRun[]>("sync/runs", undefined, signal)
  });
}

function offeredBanks(response: {
  banks: Bank[];
}) {
  return directoryBanks(response.banks);
}

/** The countries the provider offers personal banks in; requested by the connection dialog while it is open. */
export function useBankCountries() {
  return useQuery({
    queryKey: queryKeys.banking.countries(),
    queryFn: async ({ signal }) => (await apiGet<{
      countries: string[];
    }>("banks/countries", undefined, signal)).countries,
    staleTime: 30 * 60_000
  });
}

/** The provider's bank directory for a country as offered for choice; requested by the connection dialog once a country is known. */
export function useBanks(country: string | null) {
  return useQuery({
    queryKey: queryKeys.banking.banks(country ?? ""),
    queryFn: ({ signal }) => apiGet<{
      banks: Bank[];
    }>("banks", {
      country: country ?? ""
    }, signal),
    select: offeredBanks,
    enabled: country !== null,
    staleTime: 5 * 60_000
  });
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/client/api";
import { queryKeys } from "@/client/query-keys";
import type { Bank, Connection, SyncRun } from "@/features/dashboard/types";

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

/** The provider's bank directory for a country; requested by the connection dialog while it is open. */
export function useBanks(country: string) {
  return useQuery({
    queryKey: queryKeys.banking.banks(country),
    queryFn: ({ signal }) => apiGet<{
      banks: Bank[];
    }>("banks", {
      country
    }, signal),
    staleTime: 5 * 60_000
  });
}

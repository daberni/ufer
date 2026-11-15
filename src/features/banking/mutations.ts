"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";
import type { ConnectionRemoval } from "@/features/dashboard/types";

export type SyncOutcome = {
  inserted: number;
  failures: string[];
};

export const syncMutationKey = ["banking", "sync"] as const;

// A sync can change balances, transactions, connection state and its own history.
const syncedKeys = [queryKeys.accounts(), queryKeys.reports.netWorth(), queryKeys.transactions.all(), queryKeys.reports.cashFlow(), queryKeys.banking.connections(), queryKeys.banking.syncRuns()];

export function useSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: syncMutationKey,
    mutationFn: () => api<SyncOutcome>("sync", {}),
    onSettled: () => invalidate(queryClient, syncedKeys)
  });
}

export function useConnectBank() {
  return useMutation({
    mutationFn: (bank: {
      bank: string;
      country: string;
    }) => api<{
      url: string;
    }>("banking/connect", bank),
    // The bank's consent page replaces the dashboard. The mutation stays pending until then, so the form cannot start a second authorization.
    onSuccess: result => {
      window.location.assign(result.url);

      return new Promise<void>(() => {});
    }
  });
}

export function useRemoveConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (connectionId: string) => api<ConnectionRemoval>(`banking/connections/${encodeURIComponent(connectionId)}`, undefined, "DELETE"),
    onSettled: () => invalidate(queryClient, [queryKeys.banking.connections(), queryKeys.accounts()])
  });
}

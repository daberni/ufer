"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";
import { sessionEpoch } from "@/client/session-epoch";
import type { ConnectionRemoval } from "@/features/banking/types";

export type SyncFailure = {
  account: string;
  message: string;
  reconnect: boolean;
};

export type SyncOutcome = {
  inserted: number;
  failures: SyncFailure[];
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
    onMutate: () => ({
      epoch: sessionEpoch()
    }),
    onSuccess: (result, _bank, context) => {
      // A response that arrives after sign-out or a lock must not take the user from the sign-in form to the bank.
      if (context?.epoch !== sessionEpoch()) {
        return;
      }

      // The bank's consent page replaces the dashboard. The mutation stays pending until then, so the form cannot start a second authorization.
      window.location.assign(result.url);

      return new Promise<void>(() => {});
    }
  });
}

export function useRemoveConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (removal: {
      connectionId: string;
      archiveAccounts: boolean;
    }) => api<ConnectionRemoval>(`banking/connections/${encodeURIComponent(removal.connectionId)}?accounts=${removal.archiveAccounts ? "archive" : "keep"}`, undefined, "DELETE"),
    onSettled: () => invalidate(queryClient, [queryKeys.banking.connections(), queryKeys.accounts()])
  });
}

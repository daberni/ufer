"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";

// Balances feed the account list and the net worth in every currency.
const balanceKeys = [queryKeys.accounts(), queryKeys.reports.netWorth()];

export function useCreateAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Record<string, FormDataEntryValue>) => api("accounts", body),
    onSettled: () => invalidate(queryClient, balanceKeys)
  });
}

export function useSaveValuation(accountId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Record<string, FormDataEntryValue>) => api(`accounts/${encodeURIComponent(accountId)}/balance`, body),
    onSettled: () => invalidate(queryClient, balanceKeys)
  });
}

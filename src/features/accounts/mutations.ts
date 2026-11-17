"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";

// A manual account's balance is booked as transactions, which feed the account list, the net worth in every currency and the transaction lists.
const balanceKeys = [queryKeys.accounts(), queryKeys.reports.netWorth(), queryKeys.transactions.all()];

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

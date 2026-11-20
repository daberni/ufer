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


export function useRenameAccount(accountId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Record<string, FormDataEntryValue>) => api(`accounts/${encodeURIComponent(accountId)}`, body, "PATCH"),
    onSettled: () => invalidate(queryClient, [queryKeys.accounts(), queryKeys.transactions.all()])
  });
}

export type ArchiveRequest = {
  closing?: {
    date: string;
    balance_minor: number;
    transfer_account_id: string | null;
  };
};

// Closing an account books its remaining balance, which feeds the same views as a balance update and the cash-flow reports.
const archiveKeys = [...balanceKeys, queryKeys.reports.cashFlow()];

export function useArchiveAccount(accountId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ArchiveRequest) => api(`accounts/${encodeURIComponent(accountId)}/archive`, body, "PUT"),
    onSettled: () => invalidate(queryClient, archiveKeys)
  });
}

export function useRestoreAccount(accountId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api(`accounts/${encodeURIComponent(accountId)}/archive`, undefined, "DELETE"),
    // Listed transactions carry whether their account is archived.
    onSettled: () => invalidate(queryClient, [queryKeys.accounts(), queryKeys.transactions.all()])
  });
}

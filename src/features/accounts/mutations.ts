"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";

// Balances are booked as transactions, which feed the account list, the net worth in every currency and the transaction lists.
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


// Listed transactions carry their account's name; the type decides how an account counts toward net worth and cash flow.
// Rule summaries show a transfer rule's account name.
const editKeys = [queryKeys.accounts(), queryKeys.transactions.all(), queryKeys.reports.netWorth(), queryKeys.reports.cashFlow(), queryKeys.rules()];

export function useEditAccount(accountId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Record<string, FormDataEntryValue>) => api(`accounts/${encodeURIComponent(accountId)}`, body, "PATCH"),
    onSettled: () => invalidate(queryClient, editKeys)
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

// The conversion changes how the account is listed and which actions its bookings offer.
export function useConvertToManualAccount(accountId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api(`accounts/${encodeURIComponent(accountId)}/manual`, undefined, "PUT"),
    onSettled: () => invalidate(queryClient, archiveKeys)
  });
}

/** `onDeleted` runs before the refresh, which would otherwise unmount the deleted account's view and its dialog first. */
export function useDeleteAccount(accountId: string, onDeleted: () => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      name: string
    }) => api(`accounts/${encodeURIComponent(accountId)}`, body, "DELETE"),
    onSuccess: onDeleted,
    // Deleting removes bookings from every list and report, unlinks transfers on other accounts and clears rules' transfer targets.
    onSettled: () => invalidate(queryClient, editKeys)
  });
}

export function useReconcileBalance(accountId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api(`accounts/${encodeURIComponent(accountId)}/reconcile`, {}),
    onSettled: () => invalidate(queryClient, balanceKeys)
  });
}

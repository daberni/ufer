"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";
import type { TransactionType } from "@/features/transactions/transaction-types";

/** Where a transfer goes: an existing booking, a manual account on which its counterpart is created, or null for no counterpart. */
export type TransferTarget = {
  counterpart_id: string;
} | {
  account_id: string;
} | null;

/** The fields the edit dialog saves; `transfer` is sent for transfers only, and an imported booking's payee and description only when they changed. */
export type TransactionEdit = {
  type: TransactionType;
  transfer?: TransferTarget;
  /** Removes the booking's split in the same write as the details. */
  remove_split?: true;
  /** Replaces the booking's parts in the same write as the details; they must add up to the saved amount. */
  split?: {
    parts: SplitPartEdit[];
  };
  counterparty?: string;
  description?: string;
};

/** The date, amount, payee and description of a booking entered in Ufer, saved together with its type. */
export type EntryEdit = TransactionEdit & {
  booking_date: string;
  amount: string;
  counterparty: string;
  description: string;
};

export type NewEntry = EntryEdit & {
  /** Omitted applies rules; null deliberately leaves the booking uncategorized. */
  category_id?: string | null;
};

// A change can touch both bookings of a transfer and the balance of every manual account involved, so every list, the cash flow and the balances are refreshed.
const editKeys = [queryKeys.transactions.all(), queryKeys.reports.cashFlow(), queryKeys.accounts(), queryKeys.reports.netWorth()];

/** Saves a booking's type and transfer target, or for a booking entered in Ufer also its date, amount, payee and description. */
export function useSaveTransaction(id: string) {
  const queryClient = useQueryClient();
  const path = `transactions/${encodeURIComponent(id)}`;

  return useMutation({
    mutationFn: (edit: TransactionEdit | EntryEdit) => "booking_date" in edit ? api(path, edit, "PUT") : api(`${path}/details`, edit, "PUT"),
    onSettled: () => invalidate(queryClient, editKeys)
  });
}

export function useDeleteTransaction(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api(`transactions/${encodeURIComponent(id)}`, undefined, "DELETE"),
    onSettled: () => invalidate(queryClient, editKeys)
  });
}

/** Hides an imported booking from balances and reports, or shows it again. */
export function useHideTransaction(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (hidden: boolean) => api(`transactions/${encodeURIComponent(id)}/hidden`, undefined, hidden ? "PUT" : "DELETE"),
    onSettled: () => invalidate(queryClient, editKeys)
  });
}

export function useEnterTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ accountId, entry }: {
      accountId: string;
      entry: NewEntry;
    }) => api(`accounts/${encodeURIComponent(accountId)}/transactions`, entry),
    onSettled: () => invalidate(queryClient, editKeys)
  });
}

/** One part of a split as the split form saves it: a signed decimal amount in the booking's currency. */
export type SplitPartEdit = {
  amount: string;
  category_id: string | null;
  note: string;
};

/** Splits a booking into category parts, replacing an earlier split. */


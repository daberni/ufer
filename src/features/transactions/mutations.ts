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

/** The fields the edit dialog saves; `transfer` is sent for transfers only. */
export type TransactionEdit = {
  type: TransactionType;
  transfer?: TransferTarget;
};

// A type or link change can touch both bookings of a transfer, so every list and the cash flow are refreshed.
const editKeys = [queryKeys.transactions.all(), queryKeys.reports.cashFlow()];

export function useSaveTransaction(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (edit: TransactionEdit) => api(`transactions/${encodeURIComponent(id)}/type`, edit, "PUT"),
    onSettled: () => invalidate(queryClient, editKeys)
  });
}

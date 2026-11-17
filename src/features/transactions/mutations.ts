"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";
import type { TransactionType } from "@/features/transactions/transaction-types";

// A type or link change can touch both bookings of a transfer, so every list and the cash flow are refreshed.
const typeKeys = [queryKeys.transactions.all(), queryKeys.reports.cashFlow()];

function transactionPath(id: string, resource: "type" | "transfer") {
  return `transactions/${encodeURIComponent(id)}/${resource}`;
}

export function useSetTransactionType(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (type: TransactionType) => api(transactionPath(id, "type"), {
      type
    }, "PUT"),
    onSettled: () => invalidate(queryClient, typeKeys)
  });
}

/** Links the booking with another booking, or with a manual account on which its counterpart is created. */
export type TransferTarget = {
  counterpart_id: string;
} | {
  account_id: string;
};

export function useLinkTransfer(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (target: TransferTarget) => api(transactionPath(id, "transfer"), target, "PUT"),
    onSettled: () => invalidate(queryClient, typeKeys)
  });
}

export function useUnlinkTransfer(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api(transactionPath(id, "transfer"), undefined, "DELETE"),
    onSettled: () => invalidate(queryClient, typeKeys)
  });
}

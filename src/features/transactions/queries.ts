"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet } from "@/client/api";
import { queryKeys, type TransactionListFilters } from "@/client/query-keys";
import { serializePeriod } from "@/lib/period";
import type { ViewQuery } from "@/client/app-location";
import type { TransactionPage, TransferOptions } from "@/features/transactions/types";

export function transactionListFilters(query: ViewQuery): TransactionListFilters {
  return {
    period: serializePeriod(query.period),
    currency: query.currency,
    search: query.search,
    account: query.account,
    category: query.category,
    syncRun: query.syncRun,
    page: query.page
  };
}

export function useTransactionList(query: ViewQuery) {
  const filters = transactionListFilters(query);

  return useQuery({
    queryKey: queryKeys.transactions.list(filters),
    queryFn: ({ signal }) => apiGet<TransactionPage>("transactions", {
      ...filters,
      page: String(filters.page)
    }, signal),
    placeholderData: keepPreviousData
  });
}

/** A booking's transfer link and what it can be linked with, loaded while its type dialog is open. */
export function useTransferOptions(id: string) {
  return useQuery({
    queryKey: queryKeys.transactions.transfer(id),
    queryFn: ({ signal }) => apiGet<TransferOptions>(`transactions/${encodeURIComponent(id)}/transfer`, undefined, signal)
  });
}

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet, apiQuery } from "@/client/api";
import { queryKeys, type TransactionListFilters } from "@/client/query-keys";
import { serializePeriod } from "@/lib/period";
import type { ViewQuery } from "@/client/app-location";
import type { DuplicateCandidates, PayeeSuggestions, TransactionPage, TransferOptions } from "@/features/transactions/types";

export function transactionListFilters(query: ViewQuery): TransactionListFilters {
  return {
    period: serializePeriod(query.period),
    currency: query.currency,
    search: query.search,
    account: query.account,
    category: query.category,
    type: query.type,
    syncRun: query.syncRun,
    page: query.page
  };
}

export function useTransactionList(query: ViewQuery) {
  const filters = transactionListFilters(query);

  return useQuery({
    queryKey: queryKeys.transactions.list(filters),
    queryFn: ({ signal }) => apiQuery<TransactionPage>("transactions/query", filters, signal),
    placeholderData: keepPreviousData
  });
}

/** A booking's transfer link and what it can be linked with, loaded while its edit dialog shows the transfer type. */
export function useTransferOptions(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.transactions.transfer(id),
    queryFn: ({ signal }) => apiGet<TransferOptions>(`transactions/${encodeURIComponent(id)}/transfer`, undefined, signal),
    enabled
  });
}

/** The bookings a person can name this one a duplicate of. */
export function useDuplicateCandidates(id: string) {
  return useQuery({
    queryKey: queryKeys.transactions.duplicates(id),
    queryFn: ({ signal }) => apiGet<DuplicateCandidates>(`transactions/${encodeURIComponent(id)}/duplicate`, undefined, signal)
  });
}

/** Existing payees matching the typed text; an empty text loads nothing. */
export function usePayeeSuggestions(query: string) {
  const text = query.trim();

  return useQuery({
    queryKey: queryKeys.transactions.payees(text),
    queryFn: ({ signal }) => apiQuery<PayeeSuggestions>("transactions/payees", {
      query: text
    }, signal),
    enabled: text !== ""
  });
}

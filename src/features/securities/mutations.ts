"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";
import type { TradeSide } from "./trade-sides";

// A trade changes the brokerage value, the settlement account's bookings and balance, and net worth; securities may be created.
// A linked bank booking changes between income or expense and buy or sell, so cash-flow totals change too.
const tradeKeys = [queryKeys.accounts(), queryKeys.transactions.all(), queryKeys.reports.netWorth(), queryKeys.reports.cashFlow(), queryKeys.securities.all()];

export function useCreateBrokerageAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Record<string, FormDataEntryValue>) => api<{
      id: string
    }>("brokerage-accounts", body),
    onSettled: () => invalidate(queryClient, [queryKeys.accounts(), queryKeys.reports.netWorth()])
  });
}

export type TradeRequest = {
  accountId: string;
  isin: string;
  name?: string;
  currency: string;
  date: string;
  side: TradeSide;
  quantity: string;
  price: string;
  gross?: string;
  fee: string;
  tax: string;
  settlement: {
    account_id: string
  } | {
    transaction_id: string
  };
};

/** Records the trade with its cash side; the security for a new ISIN is created with it. */
export function useRecordTrade() {
  const queryClient = useQueryClient();

  return useMutation({
    // The trade names its security by ISIN; the server finds or creates it in the trade's own transaction.
    mutationFn: (request: TradeRequest) => api<{
      id: string
    }>(`brokerage-accounts/${encodeURIComponent(request.accountId)}/trades`, {
      security: {
        isin: request.isin,
        name: request.name
      },
      date: request.date,
      side: request.side,
      quantity: request.quantity,
      price: request.price,
      gross: request.gross,
      fee: request.fee,
      tax: request.tax,
      settlement: request.settlement
    }),
    onSettled: () => invalidate(queryClient, tradeKeys)
  });
}

export function useDeleteTrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tradeId: string) => api(`trades/${encodeURIComponent(tradeId)}`, undefined, "DELETE"),
    onSettled: () => invalidate(queryClient, tradeKeys)
  });
}

export type TradeCorrection = {
  tradeId: string;
  date: string;
  quantity: string;
  price: string;
  /** The traded amount, kept when it differs from shares × price through broker rounding. */
  gross?: string;
  fee: string;
  tax: string;
};

export function useCorrectTrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      tradeId,
      ...correction
    }: TradeCorrection) => api(`trades/${encodeURIComponent(tradeId)}`, correction, "PATCH"),
    onSettled: () => invalidate(queryClient, tradeKeys)
  });
}

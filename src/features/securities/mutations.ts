"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";
import type { TradeSide } from "./trade-sides";

// A trade changes the brokerage value, the settlement account's bookings and balance, and net worth; securities may be created.
const tradeKeys = [queryKeys.accounts(), queryKeys.transactions.all(), queryKeys.reports.netWorth(), queryKeys.securities.all()];

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

/** Finds or creates the security for the ISIN, then records the trade with its cash side. */
export function useRecordTrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: TradeRequest) => {
      const security = await api<{
        id: string
      }>("securities/resolve", {
        isin: request.isin,
        currency: request.currency,
        name: request.name
      });

      return api<{
        id: string
      }>(`brokerage-accounts/${encodeURIComponent(request.accountId)}/trades`, {
        security_id: security.id,
        date: request.date,
        side: request.side,
        quantity: request.quantity,
        price: request.price,
        gross: request.gross,
        fee: request.fee,
        tax: request.tax,
        settlement: request.settlement
      });
    },
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

export function useSaveListing(securityId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (providerSymbol: string | null) => api(`securities/${encodeURIComponent(securityId)}`, {
      provider_symbol: providerSymbol
    }, "PATCH"),
    onSettled: () => invalidate(queryClient, [queryKeys.securities.all(), queryKeys.accounts()])
  });
}

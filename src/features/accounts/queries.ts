"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet } from "@/client/api";
import { queryKeys } from "@/client/query-keys";
import type { Account, NetWorth } from "@/features/dashboard/types";

const expiryWarning = 7 * 86400_000;

export function useAccounts() {
  return useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: ({ signal }) => apiGet<Account[]>("accounts", undefined, signal)
  });
}

export function useNetWorth(currency: string) {
  return useQuery({
    queryKey: queryKeys.reports.netWorthIn(currency),
    queryFn: ({ signal }) => apiGet<NetWorth>("reports/net-worth", {
      currency
    }, signal),
    placeholderData: keepPreviousData
  });
}

/** The account groupings the dashboard shows for a display currency. */
export function accountGroups(accounts: Account[], currency: string) {
  const bankAccounts = accounts.filter(account => account.provider === "enable_banking");

  return {
    currencies: [...new Set(["EUR", ...accounts.map(account => account.currency)])],
    currencyAccounts: accounts.filter(account => account.currency === currency),
    manualAccounts: accounts.filter(account => account.provider === "manual"),
    bankAccounts,
    expiring: bankAccounts.filter(account => account.valid_until && Date.parse(account.valid_until) - Date.now() < expiryWarning)
  };
}

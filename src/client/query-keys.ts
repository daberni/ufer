/**
 * Query keys for server state. Each key starts with its resource, followed by the filters that select the result, so a write can invalidate everything below a prefix.
 */
export type TransactionListFilters = {
  period: string;
  currency: string;
  search: string;
  account: string;
  category: string;
  type: string;
  syncRun: string;
  page: number;
};

export type CashFlowFilters = {
  period: string;
  currency: string;
};

export type AccountCashFlowFilters = {
  account: string;
  period: string;
};

export const queryKeys = {
  accounts: () => ["accounts"] as const,
  // Below the accounts prefix, so every balance write also refreshes the history.
  balanceHistory: (account: string) => ["accounts", "balance-history", account] as const,
  categories: () => ["categories"] as const,
  rules: () => ["rules"] as const,
  rulePreview: (draft: {
    pattern: string;
    priority: number;
  } | null) => ["rules", "preview", draft] as const,
  transactions: {
    all: () => ["transactions"] as const,
    list: (filters: TransactionListFilters) => ["transactions", "list", filters] as const,
    transfer: (id: string) => ["transactions", "transfer", id] as const
  },
  reports: {
    netWorth: () => ["reports", "net-worth"] as const,
    netWorthIn: (currency: string) => ["reports", "net-worth", {
      currency
    }] as const,
    cashFlow: () => ["reports", "cash-flow"] as const,
    cashFlowFor: (filters: CashFlowFilters) => ["reports", "cash-flow", filters] as const,
    // Below the cash-flow prefix, so transaction and category writes also refresh an account's flows.
    accountCashFlowFor: (filters: AccountCashFlowFilters) => ["reports", "cash-flow", "account", filters] as const
  },
  banking: {
    banks: (country: string) => ["banking", "banks", country] as const,
    connections: () => ["banking", "connections"] as const,
    syncRuns: () => ["banking", "sync-runs"] as const
  }
};

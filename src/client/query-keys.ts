/**
 * Query keys for server state. Each key starts with its resource, followed by the filters that select the result, so a write can invalidate everything below a prefix.
 */
export type TransactionListFilters = {
  period: string;
  currency: string;
  search: string;
  account: string;
  category: string;
  syncRun: string;
  page: number;
};

export type CashFlowFilters = {
  period: string;
  currency: string;
};

export const queryKeys = {
  accounts: () => ["accounts"] as const,
  categories: () => ["categories"] as const,
  rules: () => ["rules"] as const,
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
    cashFlowFor: (filters: CashFlowFilters) => ["reports", "cash-flow", filters] as const
  },
  banking: {
    banks: (country: string) => ["banking", "banks", country] as const,
    connections: () => ["banking", "connections"] as const,
    syncRuns: () => ["banking", "sync-runs"] as const
  }
};

import type { PeriodJson } from "./period";

export type Account = {
  id: string;
  name: string;
  institution: string;
  kind: string;
  currency: string;
  balance_minor: number | null;
  balance_date: string | null;
  provider: string;
  requisition_id: string | null;
  last_synced_at: string | null;
  valid_until: string | null;
  sync_error: string | null;
};

export type Category = {
  id: string;
  name: string;
  color: string;
  is_transfer: number;
  icon: string | null;
};

export type Transaction = {
  id: string;
  booking_date: string;
  amount_minor: number;
  currency: string;
  counterparty: string;
  description: string;
  account_name: string;
  category_id: string | null;
  category_source: string;
};

export type Rule = {
  id: string;
  name: string;
  pattern: string;
  mode: string;
  category_name: string;
  priority: number;
  enabled: number;
  category_color: string;
  category_icon: string | null;
};

export type Connection = {
  id: string;
  bank_name: string;
  bank_country: string;
  status: string;
  valid_until: string | null;
  error: string | null;
};

export type ConnectionRemoval = {
  retainedAccounts: number;
  providerRevocation: "revoked" | "not_revoked" | "no_session";
};

export type SyncRun = {
  id: string;
  started_at: string;
  status: string;
  inserted_count: number;
  error: string | null;
};

export type BankingStatus = {
  environment: string;
  configured: boolean;
};

/** Latest known balances in one currency; independent of the selected period. */
export type NetWorth = {
  currency: string;
  netWorth: number;
  liquidity: number;
  investments: number;
  property: number;
  liabilities: number;
  unvalued: number;
};

/** Income or spending in one category; `categoryId` is null for uncategorized transactions. */
export type CategoryAmount = {
  categoryId: string | null;
  name: string;
  color: string;
  icon: string | null;
  amount: number;
};

export type CashFlow = {
  /** The period the figures were computed for. */
  period: PeriodJson;
  currency: string;
  income: number;
  expenses: number;
  /** Spending by category in the period, largest first. */
  breakdown: CategoryAmount[];
  trend: {
    month: string;
    income: number;
    expenses: number;
    /** Income by category in this month, largest first; it sums to `income`. */
    incomeBreakdown: CategoryAmount[];
    /** Spending by category in this month, largest first; it sums to `expenses`. */
    expenseBreakdown: CategoryAmount[];
  }[];
};

export type TransactionPage = {
  period: PeriodJson;
  page: number;
  /** Matches across all pages. */
  transactionCount: number;
  transactions: Transaction[];
};

export type Bank = {
  name: string;
  country: string;
  beta?: boolean;
};

export type View = "overview" | "transactions" | "accounts" | "rules" | "connections";

export type Modal = "account" | "bank" | "removeConnection" | "rule" | "import" | "balance" | "category" | "editCategory" | null;

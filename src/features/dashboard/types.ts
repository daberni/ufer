import type { Period } from "./period";

export type Account = {
  id: string;
  name: string;
  institution: string;
  kind: string;
  currency: string;
  balance_minor: number | null;
  balance_date: string | null;
  provider: string;
  last_synced_at: string | null;
  valid_until: string | null;
  sync_error: string | null;
};

export type Category = {
  id: string;
  name: string;
  color: string;
  is_transfer: number;
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
};

export type Connection = {
  id: string;
  bank_name: string;
  bank_country: string;
  status: string;
  valid_until: string | null;
  error: string | null;
};

export type State = {
  environment: string;
  bankingConfigured: boolean;
  currency: string;
  /** The period the financial results in this response were computed for. */
  period: Period;
  page: number;
  accounts: Account[];
  transactions: Transaction[];
  transactionCount: number;
  categories: Category[];
  rules: Rule[];
  connections: Connection[];
  runs: {
    id: string;
    started_at: string;
    status: string;
    inserted_count: number;
    error: string | null;
  }[];
  summary: {
    netWorth: number;
    liquidity: number;
    investments: number;
    property: number;
    liabilities: number;
    unvalued: number;
    income: number;
    expenses: number;
  };
  breakdown: {
    name: string;
    color: string;
    amount: number;
  }[];
  trend: {
    month: string;
    income: number;
    expenses: number;
  }[];
};

export type Bank = {
  name: string;
  country: string;
  beta?: boolean;
};

export type View = "overview" | "transactions" | "accounts" | "rules" | "connections";

export type Modal = "account" | "bank" | "rule" | "import" | "balance" | "category" | null;

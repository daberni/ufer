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

/** A daily closing balance, recorded by an operator/provider or calculated from booked transactions. */
export type BalancePoint = {
  date: string;
  amount_minor: number;
  source: "sync" | "manual" | "csv" | "transactions";
};

/** An account's closing balances, oldest first. */
export type BalanceHistory = {
  currency: string;
  balances: BalancePoint[];
};

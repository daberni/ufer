export type Account = {
  id: string;
  name: string;
  provider_name: string | null;
  institution: string;
  kind: string;
  currency: string;
  balance_minor: number | null;
  balance_date: string | null;
  /** The newest visible booking date; null without transactions. */
  last_booking_date: string | null;
  provider: string;
  requisition_id: string | null;
  last_synced_at: string | null;
  valid_until: string | null;
  sync_error: string | null;
  /** When the account was archived; archived accounts are hidden from lists and pickers but keep counting in reports. */
  archived_at: string | null;
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

/** A dated balance, recorded by an operator/provider or estimated from booked transactions. */
export type BalancePoint = {
  date: string;
  amount_minor: number;
  source: "sync" | "manual" | "csv" | "transactions";
  bank_balance_type: string | null;
};

/** An account's dated balances, oldest first. */
export type BalanceHistory = {
  currency: string;
  balances: BalancePoint[];
};

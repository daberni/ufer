import type { PeriodJson } from "@/lib/period";

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

/**
 * Net worth in one currency at the end of a month, or today in the current month, from each account's latest recorded balance on or before that day. Balances are carried forward, never interpolated.
 */
export type NetWorthPoint = {
  /** `YYYY-MM` */
  month: string;
  /** The day the balances hold for. */
  date: string;
  netWorth: number;
  liquidity: number;
  investments: number;
  property: number;
  liabilities: number;
  /** How many accounts' balances come from each source. */
  synced: number;
  manual: number;
  imported: number;
  /** Accounts whose latest balance was recorded before this month. */
  carried: number;
  /** Accounts in this currency without a balance on or before this day. */
  unvalued: number;
};

/** Monthly net worth in one currency, oldest first; it starts with the first month that has a balance. */
export type NetWorthHistory = {
  period: PeriodJson;
  currency: string;
  points: NetWorthPoint[];
};

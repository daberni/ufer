export type Account = {
  id: string;
  name: string;
  provider_name: string | null;
  institution: string | null;
  kind: string;
  currency: string;
  balance_minor: number | null;
  balance_date: string | null;
  /** The newest visible booking date; null without transactions. */
  last_booking_date: string | null;
  /** The newest balance a bank reported for this account and its date; null for manual accounts and before the first sync. */
  reported_balance_minor: number | null;
  reported_balance_date: string | null;
  /** Reported minus calculated balance at the end of the reported date; null when the newest report is not a booked balance. */
  reported_difference_minor: number | null;
  provider: string;
  requisition_id: string | null;
  last_synced_at: string | null;
  valid_until: string | null;
  sync_error: string | null;
  /** When the account was archived; archived accounts are hidden from lists and pickers but keep counting in reports. */
  archived_at: string | null;
  /** For a brokerage account with trades, how many holdings have no price on or before today or only an old one; null for every other account. */
  valuation: {
    missing: number;
    stale: number;
  } | null;
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
  /** Brokerage accounts whose value leaves out a holding without a price or uses an old price. */
  incompleteValuations: number;
};

/** A dated balance, recorded by an operator/provider or estimated from booked transactions. */
export type BalancePoint = {
  date: string;
  amount_minor: number;
  source: "sync" | "manual" | "csv" | "transactions" | "valuation";
  bank_balance_type: string | null;
};

/** A booked balance the bank reported for one day, compared with the balance calculated from bookings through that day. */
export type ReportedBalance = {
  date: string;
  amount_minor: number;
  bank_balance_type: string | null;
  calculated_minor: number;
  /** Reported minus calculated balance. */
  difference_minor: number;
  /** True on the first report of a new difference: the date an adjustment belongs to. */
  difference_started: boolean;
};

/** An account's dated balances and, for a bank-linked account, its reported booked balances, both oldest first. */
export type BalanceHistory = {
  currency: string;
  balances: BalancePoint[];
  reported: ReportedBalance[];
};

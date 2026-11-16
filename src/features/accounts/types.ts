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

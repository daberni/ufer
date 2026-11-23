import type { PerformancePoint } from "./performance";
import type { TradeSide } from "./trade-sides";

export type PricePoint = {
  date: string;
  close_micros: number;
};

/** A holding today as the trades endpoint reports it; a holding without any price counts at its cost basis. */
export type Holding = {
  security_id: string;
  security_name: string;
  quantity_micros: number;
  cost_minor: number;
  realized_minor: number;
  status: "current" | "stale" | "missing";
  value_minor: number;
  price: PricePoint | null;
};

export type Trade = {
  id: string;
  security_id: string;
  security_name: string;
  currency: string;
  date: string;
  side: TradeSide;
  sequence: number;
  quantity_micros: number;
  price_micros: number;
  gross_minor: number;
  fee_minor: number;
  tax_minor: number;
  settlement_transaction_id: string | null;
  settlement_account_id: string | null;
  settlement_account_name: string | null;
  settlement_counterparty: string | null;
  settlement_description: string | null;
  /** The gain a sale realized against the moving-average cost; null for a buy. */
  realized_minor: number | null;
};

/** Total and previous-trading-day change; see `changeSummary`. A null ratio or day means there is no honest figure. */
export type ChangeSummary = {
  total: {
    gain_minor: number;
    ratio: number | null;
    unpriced: number;
  };
  day: {
    change_minor: number;
    ratio: number;
    date: string;
    /** The earlier price date the change is measured from; weekends and holidays put it more than a day back. */
    previous_date: string;
    excluded: number;
  } | null;
  excluded: number;
};

export type BrokerageTrades = {
  account_id: string;
  currency: string;
  trades: Trade[];
  valuation: {
    value_minor: number;
    missing: number;
    stale: number;
    holdings: Holding[];
  };
  summary: ChangeSummary;
};

export type BrokeragePerformance = {
  account_id: string;
  currency: string;
  /** Holdings without any price, counted at cost and so without performance. */
  missing: number;
  points: PerformancePoint[];
};

/** All active brokerage accounts' performance, one series per currency. */
export type CombinedBrokeragePerformance = {
  currencies: (Omit<BrokeragePerformance, "account_id"> & {
    account_ids: string[];
    summary: ChangeSummary;
  })[];
};

export type Security = {
  id: string;
  isin: string | null;
  name: string;
  currency: string;
  provider: string | null;
  provider_symbol: string | null;
  venue: string | null;
  price_checked_at: string | null;
  price_error: string | null;
};

export type SecurityList = {
  price_source: {
    configured: boolean;
    provider: string | null;
    message: string | null;
  };
  securities: Security[];
};

export type Listing = {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  isin: string | null;
};

export type SettlementCandidate = {
  id: string;
  account_id: string;
  account_name: string;
  date: string;
  amount_minor: number;
  currency: string;
  counterparty: string;
  description: string;
};

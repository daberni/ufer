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
};

export type BrokeragePerformance = {
  account_id: string;
  currency: string;
  /** Holdings without any price, counted at cost and so without performance. */
  missing: number;
  points: PerformancePoint[];
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

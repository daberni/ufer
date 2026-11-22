/** A listing a provider found for an ISIN; its symbol is what daily prices are requested with. */
export type ProviderListing = {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  isin: string | null;
};

/** A daily close as the provider reported it, before conversion to micro-units. */
export type ProviderClose = {
  date: string;
  close: number;
};

export type ProviderSplit = {
  date: string;
  numerator: number;
  denominator: number;
};

/** A replaceable end-of-day price source (ADR 012); each instance brings its own key. */
export type MarketDataProvider = {
  name: string;
  searchByIsin: (isin: string) => Promise<ProviderListing[]>;
  dailyCloses: (symbol: string, from: string, to: string) => Promise<ProviderClose[]>;
  splits: (symbol: string, from: string, to: string) => Promise<ProviderSplit[]>;
};

/** A failed or rejected provider request. Its message never contains the key or the request URL. */
export class MarketDataError extends Error {}

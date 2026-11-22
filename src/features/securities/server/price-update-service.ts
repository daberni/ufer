import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { HttpError, ValidationError } from "@/lib/errors";
import { timestamp, today } from "@/lib/time";
import { withLease } from "@/server/jobs/lease";
import { configuredProvider } from "./market-data/eodhd-provider";
import { MarketDataError, type MarketDataProvider } from "./market-data/market-data-provider";
import { listPricedSecurities, savePriceCheck, savePrices, saveSplits } from "./price-repository";

/** Serializes price updates; they write only prices and splits, so they never wait for or block a bank sync. */
export const marketDataLease = "market-data";

/** A new security without trades gets the last week, enough for a current price; the free plan's history reaches one year back. */
const initialDays = 7;

const historyDays = 365;

/** Splits cost a request each, so they are checked once a week to stay within the free plan's 20 requests per day. */
const splitCheckWeekday = 1;

export const noPriceSource = "No price source configured.";

/** Converts a provider close to micro-units through its decimal text, so no floating-point product is stored. */
export function closeMicros(close: number) {
  if (!Number.isFinite(close) || close <= 0 || close >= 1e9) {
    throw new MarketDataError("The price provider reported an invalid price.");
  }

  const [whole, fraction] = close.toFixed(6).split(".");

  return Number(whole) * 1_000_000 + Number(fraction);
}

function firstDate(security: {
  newest_price: string | null;
  first_trade: string | null
}, date: Temporal.PlainDate) {
  const earliest = date.subtract({
    days: historyDays
  });

  if (security.newest_price) {
    return Temporal.PlainDate.from(security.newest_price).add({
      days: 1
    });
  }

  const start = security.first_trade ? Temporal.PlainDate.from(security.first_trade) : date.subtract({
    days: initialDays
  });

  return Temporal.PlainDate.compare(start, earliest) < 0 ? earliest : start;
}

export type PriceUpdateResult = {
  status: "not_configured" | "updated" | "running";
  securities: number;
  failed: number;
};

/**
 * Fetches the daily closes each security with a provider symbol is missing, from the day after its newest stored price through today; on the weekly check day also its splits since its first trade.
 * A failure is stored on its security and does not stop the others. Without a key it does nothing.
 */
export async function updatePrices(now = Temporal.Now.instant(), provider: MarketDataProvider | null = configuredProvider()): Promise<PriceUpdateResult> {
  if (!provider) {
    return {
      status: "not_configured",
      securities: 0,
      failed: 0
    };
  }

  try {
    return await withLease(marketDataLease, "A price update is already running.", async () => {
      const date = today(now);
      const checkedAt = timestamp(now);
      let failed = 0;
      const priced = (await listPricedSecurities()).filter(security => security.provider === provider.name);

      for (const security of priced) {
        const symbol = security.provider_symbol!;

        try {
          const from = firstDate(security, date);

          if (Temporal.PlainDate.compare(from, date) <= 0) {
            const closes = await provider.dailyCloses(symbol, from.toString(), date.toString());

            await savePrices(security.id, closes.filter(close => close.date >= from.toString() && close.date <= date.toString()).map(close => ({
              date: close.date,
              close_micros: closeMicros(close.close)
            })), provider.name, checkedAt);
          }

          if (date.dayOfWeek === splitCheckWeekday && security.first_trade) {
            await saveSplits(security.id, await provider.splits(symbol, security.first_trade, date.toString()));
          }

          await savePriceCheck(security.id, checkedAt, null);
        } catch (error) {
          if (!(error instanceof MarketDataError)) {
            throw error;
          }

          failed += 1;
          await savePriceCheck(security.id, checkedAt, error.message);
        }
      }

      return {
        status: "updated" as const,
        securities: priced.length,
        failed
      };
    }, randomUUID());
  } catch (error) {
    // A scheduled run that finds another update in progress leaves it to that one.
    if (error instanceof HttpError && error.status === 409) {
      return {
        status: "running",
        securities: 0,
        failed: 0
      };
    }

    throw error;
  }
}

/** Listings the configured provider finds for an ISIN, for choosing the symbol a new security is priced with. */
export async function searchListings(query: URLSearchParams, provider: MarketDataProvider | null = configuredProvider()) {
  const isin = (query.get("isin") ?? "").trim().toUpperCase();

  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
    throw new ValidationError("Enter a 12-character ISIN.");
  }

  if (!provider) {
    throw new HttpError(409, noPriceSource);
  }

  try {
    return await provider.searchByIsin(isin);
  } catch (error) {
    if (error instanceof MarketDataError) {
      throw new HttpError(502, error.message);
    }

    throw error;
  }
}

/** Whether a price source is configured, shown with the securities so a missing price is explained. */
export function priceSourceStatus(provider: MarketDataProvider | null = configuredProvider()) {
  return {
    configured: provider !== null,
    provider: provider?.name ?? null,
    message: provider ? null : noPriceSource
  };
}

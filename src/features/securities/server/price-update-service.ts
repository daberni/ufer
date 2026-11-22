import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { HttpError, ValidationError } from "@/lib/errors";
import { timestamp, today } from "@/lib/time";
import { syncLease, withLease } from "@/server/jobs/lease";
import { renewLease } from "@/server/jobs/lease-repository";
import { configuredProvider } from "./market-data/eodhd-provider";
import { MarketDataError, type MarketDataProvider } from "./market-data/market-data-provider";
import { assignListing, listPricedSecurities, savePriceCheck, savePrices, saveSplitsIfConsistent } from "./price-repository";
import { chooseListing } from "../listing-choice";
import { positionOn } from "../holdings";

/** Serializes price updates; they write only prices and splits, so they never wait for or block a bank sync. */
export const marketDataLease = "market-data";

/** A new security without trades gets the last week, enough for a current price; the free plan's history reaches one year back. */
const initialDays = 7;

const historyDays = 365;

/** Recently stored closes are fetched again, since the provider may still correct them; the upsert replaces a changed close. */
const correctionDays = 3;

/** A failed split check is stored with this prefix, so the next run checks the splits again instead of clearing the error. */
const splitErrorPrefix = "Splits: ";

/**
 * Splits cost a request each, so each security checks them once a week, on a weekday derived from its ID: the checks spread over the week and stay within the free plan's 20 requests per day.
 * A security checks on its first update and, after a failed split check, again on the next run.
 */
export function checksSplits(security: {
  id: string;
  price_checked_at: string | null;
  price_error: string | null
}, date: Temporal.PlainDate) {
  // A security's first update checks its splits at once, as does one whose last split check failed.
  if (security.price_checked_at === null || security.price_error?.startsWith(splitErrorPrefix)) {
    return true;
  }

  let hash = 0;

  for (const character of security.id) {
    hash = (hash * 31 + character.charCodeAt(0)) % 7;
  }

  return date.dayOfWeek === hash + 1;
}

export const noPriceSource = "No price source configured.";

/**
 * Looks up the listing of a security recorded by ISIN when it is first updated: one search, then the listing in its currency on the most liquid venue (ADR 012 amendment). Saving a trade never searches.
 * Returns the chosen symbol, or null without a suitable listing or when another security already uses it.
 */
async function resolveListing(security: {
  id: string;
  isin: string | null;
  currency: string
}, provider: MarketDataProvider) {
  const listing = chooseListing(await provider.searchByIsin(security.isin!), security.currency);

  if (!listing || !(await assignListing(security.id, {
    provider: provider.name,
    provider_symbol: listing.symbol,
    venue: listing.exchange,
    name: listing.name
  }))) {
    return null;
  }

  return listing.symbol;
}

/** Whether every account's sales still fit its holdings under a split history; a reported split that would make a recorded sale exceed the holding is not stored. */
export function splitsFitTrades(tradesByAccount: Parameters<typeof positionOn>[0][], splits: Parameters<typeof positionOn>[1]) {
  try {
    for (const trades of tradesByAccount) {
      positionOn(trades, splits, "9999-12-31");
    }

    return true;
  } catch (error) {
    if (error instanceof ValidationError) {
      return false;
    }

    throw error;
  }
}

/** Days a security's first stored close may follow its first trade, for weekends and holidays, without leaving a gap in its checked split history. */
const coverageToleranceDays = 7;

/**
 * Whether splits before the provider's history may be missing. A security's first update fetches closes and checks splits from the same start, so its oldest stored close marks how far back its splits were checked;
 * only a first trade before both that point and the provider's history leaves a gap. Tracking a security since its first trade therefore stays complete after a year.
 * Known limitations: a security's first trade recorded while an update processes it with no check yet is not distinguished from that state, so its splits wait for the weekly check; the seven-day tolerance can reach across the history boundary for a first trade just before it, and if the first split check keeps failing for a year, a later success covers only the recent year and this proxy no longer flags the gap; the split error shows throughout those failures.
 */
export function splitsUncovered(security: {
  first_trade: string | null;
  oldest_price: string | null
}, historyStart: string) {
  if (security.first_trade === null || security.first_trade >= historyStart) {
    return false;
  }

  if (security.oldest_price === null) {
    return true;
  }

  const coveredFrom = Temporal.PlainDate.from(security.oldest_price).subtract({
    days: coverageToleranceDays
  }).toString();

  return security.first_trade < coveredFrom;
}

/** Converts a provider close to micro-units through its decimal text, so no floating-point product is stored. */
export function closeMicros(close: number) {
  if (!Number.isFinite(close) || close <= 0 || close >= 1e9) {
    throw new MarketDataError("The price provider reported an invalid price.");
  }

  const [whole, fraction] = close.toFixed(6).split(".");
  const micros = Number(whole) * 1_000_000 + Number(fraction);

  // A close below half a micro-unit rounds to zero, which no stored price may be.
  if (micros <= 0) {
    throw new MarketDataError("The price provider reported an invalid price.");
  }

  return micros;
}

function firstDate(security: {
  newest_price: string | null;
  first_trade: string | null
}, date: Temporal.PlainDate) {
  const earliest = date.subtract({
    days: historyDays
  });

  if (security.newest_price) {
    return Temporal.PlainDate.from(security.newest_price).subtract({
      days: correctionDays
    });
  }

  const start = security.first_trade ? Temporal.PlainDate.from(security.first_trade) : date.subtract({
    days: initialDays
  });

  return Temporal.PlainDate.compare(start, earliest) < 0 ? earliest : start;
}

export type PriceUpdateResult = {
  /** "interrupted": the deadline passed or another run took over the lease; the remaining securities lead the next run. */
  status: "not_configured" | "updated" | "running" | "interrupted";
  securities: number;
  failed: number;
  /** Securities first traded before the provider's split history reaches back, whose earlier splits could not be checked. */
  incomplete: number;
};

/**
 * Fetches the daily closes each security with a provider symbol is missing, from the day after its newest stored price through today; on the weekly check day also its splits since its first trade.
 * Recent closes are fetched again so corrections replace them. A failure is stored on its security and does not stop the others. Without a key it does nothing.
 */
export async function updatePrices(now = Temporal.Now.instant(), provider: MarketDataProvider | null = configuredProvider(), deadline?: Temporal.Instant): Promise<PriceUpdateResult> {
  if (!provider) {
    return {
      status: "not_configured",
      securities: 0,
      failed: 0,
      incomplete: 0
    };
  }

  try {
    return await withLease(marketDataLease, "A price update is already running.", async owner => {
      const date = today(now);
      const checkedAt = timestamp(now);
      let failed = 0;
      let incomplete = 0;
      let interrupted = false;
      const historyStart = date.subtract({
        days: historyDays
      }).toString();
      const priced = (await listPricedSecurities()).filter(security => security.provider === provider.name || security.provider_symbol === null);

      for (const security of priced) {
        // A long update renews its lease before each security and stops once another run has taken it over.
        // Past the caller's deadline no new security is started, so the run ends inside its time budget and the rest leads the next run.
        if (deadline && Temporal.Instant.compare(Temporal.Now.instant(), deadline) >= 0) {
          interrupted = true;
          break;
        }

        if (!(await renewLease(marketDataLease, owner))) {
          interrupted = true;
          break;
        }

        try {
          const symbol = security.provider_symbol ?? await resolveListing(security, provider);

          // No listing in the security's currency: it stays valid without a price, and the update does not search again.
          if (symbol === null) {
            await savePriceCheck(security.id, checkedAt, `No price listing in ${security.currency} was found for this ISIN; choose one under Price listing.`, security.price_checked_at);
            continue;
          }

          const from = firstDate(security, date);

          if (Temporal.PlainDate.compare(from, date) <= 0) {
            const closes = await provider.dailyCloses(symbol, from.toString(), date.toString());

            await savePrices(security.id, closes.filter(close => close.date >= from.toString() && close.date <= date.toString()).map(close => ({
              date: close.date,
              close_micros: closeMicros(close.close)
            })), provider.name, checkedAt);
          }

          if (checksSplits(security, date) && security.first_trade) {
            const splitsFrom = security.first_trade < historyStart ? historyStart : security.first_trade;
            const reported = await provider.splits(symbol, splitsFrom, date.toString()).catch((error: unknown) => {
              throw error instanceof MarketDataError ? new MarketDataError(`${splitErrorPrefix}${error.message}`) : error;
            });
            // Only splits inside the requested interval replace stored ones; others outside it could collide with stored rows the check would count twice.
            const splits = reported.filter(split => split.date >= splitsFrom && split.date <= date.toString());

            // Trades validate sales against the stored splits under the sync lease, so splits are written under it too.
            const stored = await withLease(syncLease, "busy", () => saveSplitsIfConsistent(security.id, {
              from: splitsFrom,
              to: date.toString()
            }, splits, splitsFitTrades)).catch((error: unknown) => {
              throw error instanceof HttpError && error.status === 409 ? new MarketDataError(`${splitErrorPrefix}a sync or trade was running; they are checked again on the next run.`) : error;
            });

            if (!stored) {
              throw new MarketDataError(`${splitErrorPrefix}the provider reports a split that conflicts with the recorded sales; check the trades.`);
            }
          }

          // The provider's split history reaches back one year, so an older split would be silently missing from the quantity; the security stays flagged.
          const unchecked = splitsUncovered(security, historyStart);

          if (unchecked) {
            incomplete += 1;
          }

          await savePriceCheck(security.id, checkedAt, unchecked ? `Splits before ${historyStart} cannot be checked with the price provider's history; quantities may be wrong if one occurred.` : null, security.price_checked_at);
        } catch (error) {
          if (!(error instanceof MarketDataError)) {
            throw error;
          }

          failed += 1;
          // A split check still pending from an earlier failure stays pending when this run fails before reaching it.
          const pendingSplits = security.price_error?.startsWith(splitErrorPrefix) && !error.message.startsWith(splitErrorPrefix);

          // A failed attempt keeps its older check time, so the longest-unchecked ordering puts it first on the next run instead of the same securities failing at the tail.
          await savePriceCheck(security.id, security.price_checked_at, pendingSplits ? `${splitErrorPrefix}${error.message}` : error.message, security.price_checked_at);
        }
      }

      return {
        status: interrupted ? "interrupted" as const : "updated" as const,
        securities: priced.length,
        failed,
        incomplete
      };
    }, randomUUID());
  } catch (error) {
    // A scheduled run that finds another update in progress leaves it to that one.
    if (error instanceof HttpError && error.status === 409) {
      return {
        status: "running",
        securities: 0,
        failed: 0,
        incomplete: 0
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

/** The configured provider's listings for an ISIN; none without a key or when the provider fails, since a security is valid without a price source. */
export async function searchProviderListings(isin: string, provider: MarketDataProvider | null = configuredProvider()) {
  if (!provider) {
    return [];
  }

  try {
    return await provider.searchByIsin(isin);
  } catch (error) {
    if (error instanceof MarketDataError) {
      return [];
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

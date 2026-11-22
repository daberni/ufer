import { and, asc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { securities, securityPrices, securitySplits, securityTrades } from "@/server/database/schema";
import type { PositionTrade } from "../holdings";

/** Securities with a provider symbol, their newest stored price date and their first trade date. */
export async function listPricedSecurities() {
  const db = await database();

  return db.select({
    id: securities.id,
    provider: securities.provider,
    provider_symbol: securities.provider_symbol,
    isin: securities.isin,
    currency: securities.currency,
    price_checked_at: securities.price_checked_at,
    price_error: securities.price_error,
    // Drizzle leaves columns in a single-table select unqualified, so these correlated subqueries name their tables explicitly.
    newest_price: sql<string | null>`(SELECT MAX(p.date) FROM security_prices p WHERE p.security_id=securities.id)`,
    oldest_price: sql<string | null>`(SELECT MIN(p.date) FROM security_prices p WHERE p.security_id=securities.id)`,
    first_trade: sql<string | null>`(SELECT MIN(t.date) FROM security_trades t WHERE t.security_id=securities.id)`
  // The longest-unchecked securities go first, so one skipped over the provider's daily quota leads the next run.
  // A security recorded by ISIN without a listing yet is included once, so the update can look up its listing.
  // Only securities some trade holds are updated, so one left without trades spends no provider requests.
  }).from(securities).where(and(sql`EXISTS (SELECT 1 FROM security_trades t WHERE t.security_id=securities.id)`, or(isNotNull(securities.provider_symbol), and(isNotNull(securities.isin), isNull(securities.price_checked_at))))).orderBy(sql`${securities.price_checked_at} IS NOT NULL`, asc(securities.price_checked_at), asc(securities.id));
}

/** Stores daily closes, replacing a close the provider corrected; one transaction per security. */
export async function savePrices(securityId: string, closes: {
  date: string;
  close_micros: number;
}[], source: string, fetchedAt: string) {
  if (!closes.length) {
    return;
  }

  const db = await database();

  await db.transaction(async tx => {
    // The security's last trade may have been deleted while its closes were fetched; then there is nothing to store.
    if (!(await securityExists(tx, securityId))) {
      return;
    }

    await tx.insert(securityPrices).values(closes.map(close => ({
      security_id: securityId,
      date: close.date,
      close_micros: close.close_micros,
      source,
      fetched_at: fetchedAt
    }))).onConflictDoUpdate({
      target: [securityPrices.security_id, securityPrices.date],
      set: {
        close_micros: sql`excluded.close_micros`,
        source: sql`excluded.source`,
        fetched_at: sql`excluded.fetched_at`
      }
    });
  });
}

async function securityExists(tx: DatabaseTransaction, securityId: string) {
  const row = await tx.select({
    id: securities.id
  }).from(securities).where(eq(securities.id, securityId)).get();

  return row !== undefined;
}

export type SplitRow = {
  date: string;
  numerator: number;
  denominator: number;
};

/**
 * Replaces the stored splits inside the fetched interval with the reported ones, so a split the provider retracted or redated within it is removed, unless `consistent` rejects the resulting split history for the security's trades, grouped by account.
 * The check reads trades and splits in the same transaction. Returns whether the splits were stored.
 */
export async function saveSplitsIfConsistent(securityId: string, interval: {
  from: string;
  to: string
}, splits: SplitRow[], consistent: (trades: PositionTrade[][], splits: SplitRow[]) => boolean) {
  const db = await database();
  const inInterval = (date: string) => date >= interval.from && date <= interval.to;

  return db.transaction(async tx => {
    // A security deleted with its last trade meanwhile has no splits to store.
    if (!(await securityExists(tx, securityId))) {
      return true;
    }

    const stored = await tx.select({
      date: securitySplits.date,
      numerator: securitySplits.numerator,
      denominator: securitySplits.denominator
    }).from(securitySplits).where(eq(securitySplits.security_id, securityId));
    const merged = [...stored.filter(split => !inInterval(split.date)), ...splits];
    const trades = await tx.select({
      account_id: securityTrades.account_id,
      date: securityTrades.date,
      side: securityTrades.side,
      sequence: securityTrades.sequence,
      quantity_micros: securityTrades.quantity_micros,
      gross_minor: securityTrades.gross_minor,
      fee_minor: securityTrades.fee_minor
    }).from(securityTrades).where(eq(securityTrades.security_id, securityId));
    const byAccount = Object.values(Object.groupBy(trades, trade => trade.account_id)).map(group => group ?? []);

    if (!consistent(byAccount, merged)) {
      return false;
    }

    await tx.delete(securitySplits).where(and(eq(securitySplits.security_id, securityId), sql`${securitySplits.date} BETWEEN ${interval.from} AND ${interval.to}`));

    if (!splits.length) {
      return true;
    }

    await tx.insert(securitySplits).values(splits.map(split => ({
      security_id: securityId,
      ...split
    }))).onConflictDoUpdate({
      target: [securitySplits.security_id, securitySplits.date],
      set: {
        numerator: sql`excluded.numerator`,
        denominator: sql`excluded.denominator`
      }
    });

    return true;
  });
}

/** Records the outcome of a price update so a failed or missing price is visible. */
export async function savePriceCheck(securityId: string, checkedAt: string | null, error: string | null, previousCheckedAt: string | null) {
  const db = await database();

  // A trade dated before the earliest one clears the last check meanwhile so splits are checked again; this run's outcome then does not overwrite that.
  await db.update(securities).set({
    price_checked_at: checkedAt,
    price_error: error
  }).where(and(eq(securities.id, securityId), sql`${securities.price_checked_at} IS ${previousCheckedAt}`));
}

/** Stores the listing the update chose for a security recorded by ISIN; false when another security already uses it. */
export async function assignListing(securityId: string, listing: {
  provider: string;
  provider_symbol: string;
  venue: string;
  name: string;
}) {
  const db = await database();

  return db.transaction(async tx => {
    const taken = await tx.select({
      id: securities.id
    }).from(securities).where(and(eq(securities.provider_symbol, listing.provider_symbol), ne(securities.id, securityId))).get();

    if (taken) {
      return false;
    }

    // A security still named by its ISIN takes the listing's name; a name the person entered stays.
    await tx.update(securities).set({
      provider: listing.provider,
      provider_symbol: listing.provider_symbol,
      venue: listing.venue,
      name: sql`CASE WHEN ${securities.name}=${securities.isin} THEN ${listing.name} ELSE ${securities.name} END`
    }).where(and(eq(securities.id, securityId), isNull(securities.provider_symbol)));

    return true;
  });
}

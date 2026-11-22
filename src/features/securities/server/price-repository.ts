import { asc, eq, isNotNull, sql } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { securities, securityPrices, securitySplits } from "@/server/database/schema";

/** Securities with a provider symbol, their newest stored price date and their first trade date. */
export async function listPricedSecurities() {
  const db = await database();

  return db.select({
    id: securities.id,
    provider: securities.provider,
    provider_symbol: securities.provider_symbol,
    price_checked_at: securities.price_checked_at,
    price_error: securities.price_error,
    // Drizzle leaves columns in a single-table select unqualified, so these correlated subqueries name their tables explicitly.
    newest_price: sql<string | null>`(SELECT MAX(p.date) FROM security_prices p WHERE p.security_id=securities.id)`,
    first_trade: sql<string | null>`(SELECT MIN(t.date) FROM security_trades t WHERE t.security_id=securities.id)`
  }).from(securities).where(isNotNull(securities.provider_symbol)).orderBy(asc(securities.id));
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

  await db.insert(securityPrices).values(closes.map(close => ({
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
}

export async function saveSplits(securityId: string, splits: {
  date: string;
  numerator: number;
  denominator: number;
}[]) {
  if (!splits.length) {
    return;
  }

  const db = await database();

  await db.insert(securitySplits).values(splits.map(split => ({
    security_id: securityId,
    ...split
  }))).onConflictDoUpdate({
    target: [securitySplits.security_id, securitySplits.date],
    set: {
      numerator: sql`excluded.numerator`,
      denominator: sql`excluded.denominator`
    }
  });
}

/** Records the outcome of a price update so a failed or missing price is visible. */
export async function savePriceCheck(securityId: string, checkedAt: string, error: string | null) {
  const db = await database();

  await db.update(securities).set({
    price_checked_at: checkedAt,
    price_error: error
  }).where(eq(securities.id, securityId));
}

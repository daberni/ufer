import { asc, eq, inArray } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { securities, securityPrices, securitySplits, securityTrades } from "@/server/database/schema";
import type { HoldingInputs } from "../valuation";

/** The trades, splits and prices of every security each of the given brokerage accounts traded, keyed by account. */
export async function readHoldingInputs(accountIds: string[]) {
  const byAccount = new Map<string, HoldingInputs[]>();

  if (!accountIds.length) {
    return byAccount;
  }

  const db = await database();
  const trades = await db.select({
    account_id: securityTrades.account_id,
    security_id: securityTrades.security_id,
    security_name: securities.name,
    currency: securities.currency,
    date: securityTrades.date,
    side: securityTrades.side,
    sequence: securityTrades.sequence,
    quantity_micros: securityTrades.quantity_micros,
    gross_minor: securityTrades.gross_minor,
    fee_minor: securityTrades.fee_minor
  }).from(securityTrades).innerJoin(securities, eq(securities.id, securityTrades.security_id)).where(inArray(securityTrades.account_id, accountIds)).orderBy(asc(securityTrades.date), asc(securityTrades.sequence));
  const securityIds = [...new Set(trades.map(trade => trade.security_id))];

  if (!securityIds.length) {
    return byAccount;
  }

  const splits = await db.select({
    security_id: securitySplits.security_id,
    date: securitySplits.date,
    numerator: securitySplits.numerator,
    denominator: securitySplits.denominator
  }).from(securitySplits).where(inArray(securitySplits.security_id, securityIds));
  const prices = await db.select({
    security_id: securityPrices.security_id,
    date: securityPrices.date,
    close_micros: securityPrices.close_micros
  }).from(securityPrices).where(inArray(securityPrices.security_id, securityIds)).orderBy(asc(securityPrices.date));

  for (const trade of trades) {
    const holdings = byAccount.get(trade.account_id) ?? [];
    let holding = holdings.find(item => item.security_id === trade.security_id);

    if (!holding) {
      holding = {
        security_id: trade.security_id,
        security_name: trade.security_name,
        currency: trade.currency,
        trades: [],
        splits: splits.filter(split => split.security_id === trade.security_id),
        prices: prices.filter(price => price.security_id === trade.security_id)
      };
      holdings.push(holding);
      byAccount.set(trade.account_id, holdings);
    }

    holding.trades.push(trade);
  }

  return byAccount;
}

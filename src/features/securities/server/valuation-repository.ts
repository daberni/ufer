import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { database, type Database, type DatabaseTransaction } from "@/server/database/connection";
import { securities, securityPrices, securitySplits, securityTrades, transactions } from "@/server/database/schema";
import { resolveTransferCosts } from "../transfers";
import type { HoldingInputs, TradeSettlement } from "../valuation";
import { readSecurityLegs, readTradedSecurityIds } from "./security-repository";

/** A holding whose replay steps keep their stored trade or transfer id. */
export type StoredHoldingInputs = HoldingInputs & {
  trades: Awaited<ReturnType<typeof readSecurityLegs>>;
};

export type AccountValuationInputs = {
  holdings: StoredHoldingInputs[];
  settlements: TradeSettlement[];
};

/**
 * The trades, transfer legs, splits and prices of every security each of the given brokerage accounts traded or received, with each trade's cash booking, keyed by account.
 * Received transfers carry the cost basis the sending account had, so the security's legs on every account are read.
 */
export async function readHoldingInputs(accountIds: string[], executor?: Database | DatabaseTransaction) {
  const byAccount = new Map<string, AccountValuationInputs>();
  const db = executor ?? await database();
  const securityIds = await readTradedSecurityIds(db, accountIds);

  if (!securityIds.length) {
    return byAccount;
  }

  const details = await db.select({
    id: securities.id,
    name: securities.name,
    currency: securities.currency
  }).from(securities).where(inArray(securities.id, securityIds));
  const splits = await db.select({
    security_id: securitySplits.security_id,
    date: securitySplits.date,
    numerator: securitySplits.numerator,
    denominator: securitySplits.denominator
  }).from(securitySplits).where(inArray(securitySplits.security_id, securityIds)).orderBy(asc(securitySplits.date));
  const prices = await db.select({
    security_id: securityPrices.security_id,
    date: securityPrices.date,
    close_micros: securityPrices.close_micros
  }).from(securityPrices).where(inArray(securityPrices.security_id, securityIds)).orderBy(asc(securityPrices.date));
  const legs = await readSecurityLegs(db, securityIds);
  const requested = new Set(accountIds);
  const resolved = securityIds.flatMap(securityId => resolveTransferCosts(legs.filter(leg => leg.security_id === securityId), splits.filter(split => split.security_id === securityId))).filter(leg => requested.has(leg.account_id)).toSorted((left, right) => left.date.localeCompare(right.date) || left.sequence - right.sequence);

  for (const leg of resolved) {
    const inputs = byAccount.get(leg.account_id) ?? {
      holdings: [],
      settlements: []
    };
    let holding = inputs.holdings.find(item => item.security_id === leg.security_id);

    if (!holding) {
      const security = details.find(item => item.id === leg.security_id)!;

      holding = {
        security_id: leg.security_id,
        security_name: security.name,
        currency: security.currency,
        trades: [],
        splits: splits.filter(split => split.security_id === leg.security_id),
        prices: prices.filter(price => price.security_id === leg.security_id)
      };
      inputs.holdings.push(holding);
    }

    holding.trades.push(leg);
    byAccount.set(leg.account_id, inputs);
  }

  const settlements = await db.select({
    account_id: securityTrades.account_id,
    trade_date: securityTrades.date,
    // A hidden cash booking counts toward no balance, so it settles nothing either.
    cash_date: transactions.date,
    amount_minor: transactions.amount_minor
  }).from(securityTrades).innerJoin(transactions, eq(transactions.id, securityTrades.settlement_transaction_id)).where(and(inArray(securityTrades.account_id, accountIds), isNull(transactions.suppressed_at))).orderBy(asc(securityTrades.date), asc(securityTrades.sequence));

  for (const settlement of settlements) {
    byAccount.get(settlement.account_id)?.settlements.push({
      trade_date: settlement.trade_date,
      cash_date: settlement.cash_date,
      amount_minor: settlement.amount_minor
    });
  }

  return byAccount;
}

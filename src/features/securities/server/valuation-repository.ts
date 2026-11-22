import { asc, eq, inArray, sql } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { securities, securityPrices, securitySplits, securityTrades, transactions } from "@/server/database/schema";
import type { HoldingInputs, TradeSettlement } from "../valuation";

export type AccountValuationInputs = {
  holdings: HoldingInputs[];
  settlements: TradeSettlement[];
};

/** The trades, splits and prices of every security each of the given brokerage accounts traded, with each trade's cash booking, keyed by account. */
export async function readHoldingInputs(accountIds: string[]) {
  const byAccount = new Map<string, AccountValuationInputs>();

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
    fee_minor: securityTrades.fee_minor,
    // A hidden cash booking counts toward no balance, so it settles nothing either.
    cash_date: sql<string | null>`CASE WHEN ${transactions.suppressed_at} IS NULL THEN ${transactions.date} END`,
    cash_minor: sql<number | null>`CASE WHEN ${transactions.suppressed_at} IS NULL THEN ${transactions.amount_minor} END`
  }).from(securityTrades).innerJoin(securities, eq(securities.id, securityTrades.security_id)).leftJoin(transactions, eq(transactions.id, securityTrades.settlement_transaction_id)).where(inArray(securityTrades.account_id, accountIds)).orderBy(asc(securityTrades.date), asc(securityTrades.sequence));
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
    const inputs = byAccount.get(trade.account_id) ?? {
      holdings: [],
      settlements: []
    };
    let holding = inputs.holdings.find(item => item.security_id === trade.security_id);

    if (!holding) {
      holding = {
        security_id: trade.security_id,
        security_name: trade.security_name,
        currency: trade.currency,
        trades: [],
        splits: splits.filter(split => split.security_id === trade.security_id),
        prices: prices.filter(price => price.security_id === trade.security_id)
      };
      inputs.holdings.push(holding);
    }

    holding.trades.push(trade);

    if (trade.cash_date !== null && trade.cash_minor !== null) {
      inputs.settlements.push({
        trade_date: trade.date,
        cash_date: trade.cash_date,
        amount_minor: trade.cash_minor
      });
    }

    byAccount.set(trade.account_id, inputs);
  }

  return byAccount;
}

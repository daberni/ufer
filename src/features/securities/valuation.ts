import { Temporal } from "temporal-polyfill";
import { positionOn, valueHolding, type PositionSplit, type PositionTrade, type PricePoint } from "./holdings";

/** One security on a brokerage account with everything its value on any date depends on. */
export type HoldingInputs = {
  security_id: string;
  security_name: string;
  currency: string;
  trades: PositionTrade[];
  splits: PositionSplit[];
  prices: PricePoint[];
};

/** A trade's date and the date and signed amount of its cash side, which a bank may book days before or after the trade. */
export type TradeSettlement = {
  trade_date: string;
  cash_date: string;
  amount_minor: number;
};

/**
 * Cash a trade has moved on one side but not yet on the other: between the trade and a later cash booking the holding is already counted, so its pending payment (negative for a buy) offsets it; between an earlier cash booking and the trade the holding is not counted yet, so the paid amount stands in for it.
 * Adding this to the holdings value keeps settlement cash plus holdings unchanged by a trade on every day.
 */
export function unsettledCash(settlements: TradeSettlement[], date: string) {
  let total = 0;

  for (const settlement of settlements) {
    if (settlement.trade_date <= date && date < settlement.cash_date) {
      total += settlement.amount_minor;
    } else if (settlement.cash_date <= date && date < settlement.trade_date) {
      total -= settlement.amount_minor;
    }
  }

  return total;
}

export type HoldingValue = {
  security_id: string;
  security_name: string;
  quantity_micros: number;
  cost_minor: number;
  realized_minor: number;
  status: "current" | "stale" | "missing";
  value_minor: number | null;
  price: PricePoint | null;
};

/** A brokerage account's value on one date: the sum of its holdings at the price valid then. A holding without a price counts zero and is reported missing; one with an old price counts and is reported stale. */
export type AccountValuation = {
  value_minor: number;
  missing: number;
  stale: number;
  holdings: HoldingValue[];
};

export function valueHoldings(holdings: HoldingInputs[], date: string): AccountValuation {
  const values = holdings.map(holding => {
    const position = positionOn(holding.trades, holding.splits, date);

    return {
      security_id: holding.security_id,
      security_name: holding.security_name,
      ...position,
      ...valueHolding(position.quantity_micros, holding.prices, holding.currency, date)
    };
  });

  return {
    value_minor: values.reduce((total, holding) => total + (holding.value_minor ?? 0), 0),
    missing: values.filter(holding => holding.status === "missing").length,
    stale: values.filter(holding => holding.status === "stale").length,
    holdings: values.filter(holding => holding.quantity_micros > 0 || holding.realized_minor !== 0)
  };
}

/**
 * The account's value on every date it can change through `endDate`: each trade, cash booking, split and price date, starting at zero the day before the first of them. Cash a trade has moved on only one side counts as in `unsettledCash`.
 * Values between two points equal the earlier point, so the series never uses a price dated after the day it values.
 */
export function valuationSeries(holdings: HoldingInputs[], settlements: TradeSettlement[], endDate: string) {
  const tradeDates = [...holdings.flatMap(holding => holding.trades.map(trade => trade.date)), ...settlements.map(settlement => settlement.cash_date)].filter(date => date <= endDate).sort();
  const first = tradeDates[0];

  if (!first) {
    return [];
  }

  const changeDates = new Set<string>([first, endDate]);

  for (const settlement of settlements) {
    for (const date of [settlement.trade_date, settlement.cash_date]) {
      if (date >= first && date <= endDate) {
        changeDates.add(date);
      }
    }
  }

  for (const holding of holdings) {
    for (const event of [...holding.trades, ...holding.splits, ...holding.prices]) {
      if (event.date >= first && event.date <= endDate) {
        changeDates.add(event.date);
      }
    }
  }

  const start = {
    date: Temporal.PlainDate.from(first).subtract({
      days: 1
    }).toString(),
    amount_minor: 0
  };

  return [start, ...[...changeDates].sort().map(date => ({
    date,
    amount_minor: valueHoldings(holdings, date).value_minor + unsettledCash(settlements, date)
  }))];
}

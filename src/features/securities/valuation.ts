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
 * The account's value on every date it can change through `endDate`: each trade, split and price date, starting at zero the day before the first trade.
 * Values between two points equal the earlier point, so the series never uses a price dated after the day it values.
 */
export function valuationSeries(holdings: HoldingInputs[], endDate: string) {
  const tradeDates = holdings.flatMap(holding => holding.trades.map(trade => trade.date)).filter(date => date <= endDate).sort();
  const first = tradeDates[0];

  if (!first) {
    return [];
  }

  const changeDates = new Set<string>([first, endDate]);

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
    amount_minor: valueHoldings(holdings, date).value_minor
  }))];
}

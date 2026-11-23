import { Temporal } from "temporal-polyfill";
import { amountMinor, positionOn, priceOn, quantityBeforeSplits, valueHolding, type PositionSplit, type PositionTrade, type PricePoint } from "./holdings";

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
  value_minor: number;
  price: PricePoint | null;
};

/** A brokerage account's value on one date: the sum of its holdings at the price valid then. A holding without any price counts at its cost basis and is reported missing ("no price"); one with an old price counts at that price and is reported stale. */
export type AccountValuation = {
  value_minor: number;
  missing: number;
  stale: number;
  holdings: HoldingValue[];
};

export function valueHoldings(holdings: HoldingInputs[], date: string): AccountValuation {
  const values = holdings.map(holding => {
    const position = positionOn(holding.trades, holding.splits, date);
    const valuation = valueHolding(position.quantity_micros, holding.splits, holding.prices, holding.currency, date);

    return {
      security_id: holding.security_id,
      security_name: holding.security_name,
      ...position,
      ...valuation,
      // Without any price the cost basis is the best available approximation (ADR 012 amendment); the status still says it is not a market value.
      value_minor: valuation.value_minor ?? position.cost_minor
    };
  });

  return {
    value_minor: values.reduce((total, holding) => total + holding.value_minor, 0),
    missing: values.filter(holding => holding.status === "missing").length,
    stale: values.filter(holding => holding.status === "stale").length,
    holdings: values.filter((_, index) => holdings[index]!.trades.some(trade => trade.date <= date))
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

/**
 * The two headline figures of one or more brokerage accounts on `date`.
 * Total: unrealized gain of priced holdings plus every realized gain, relative to all buy costs including fees. Holdings without a price add only their realized gain and are counted in `unpriced`.
 * Day: the price change of each currently priced holding between its last two price dates, at today's quantity, relative to its value at the earlier price. Stale, unpriced and single-price holdings are left out and counted in `excluded`; with none left there is no day change rather than a zero.
 */
export function changeSummary(holdings: HoldingInputs[], date: string) {
  let gain = 0;
  let unpriced = 0;
  let invested = 0;
  let change = 0;
  let previousValue = 0;
  let excluded = 0;
  let priceDate: string | null = null;
  let previousDate: string | null = null;
  const intervals = new Set<string>();

  for (const holding of holdings) {
    for (const trade of holding.trades) {
      if (trade.side === "buy" && trade.date <= date) {
        invested += trade.gross_minor + trade.fee_minor;
      }
    }

    const position = positionOn(holding.trades, holding.splits, date);
    const valuation = valueHolding(position.quantity_micros, holding.splits, holding.prices, holding.currency, date);

    gain += position.realized_minor;

    if (position.quantity_micros === 0) {
      continue;
    }

    if (valuation.value_minor === null || !valuation.price) {
      unpriced += 1;
      excluded += 1;
      continue;
    }

    gain += valuation.value_minor - position.cost_minor;

    const previous = priceOn(holding.prices, Temporal.PlainDate.from(valuation.price.date).subtract({
      days: 1
    }).toString());

    if (valuation.status === "stale" || !previous) {
      excluded += 1;
      continue;
    }

    // Both closes are in the units before any later split, so splits after the earlier close apply in reverse to today's quantity.
    const quantityBefore = quantityBeforeSplits(position.quantity_micros, holding.splits, previous.date, date);
    const before = amountMinor(quantityBefore, previous.close_micros, holding.currency);

    intervals.add(`${previous.date}/${valuation.price.date}`);

    change += valuation.value_minor - before;
    previousValue += before;

    if (!priceDate || valuation.price.date > priceDate) {
      priceDate = valuation.price.date;
      previousDate = previous.date;
    }
  }

  return {
    total: {
      gain_minor: gain,
      ratio: invested > 0 ? gain / invested : null,
      unpriced
    },
    day: priceDate !== null && previousValue > 0 ? {
      change_minor: change,
      ratio: change / previousValue,
      date: priceDate,
      previous_date: previousDate ?? priceDate,
      // Holdings whose latest two prices fall on different dates are summed over their own intervals, so no single date pair describes the total.
      mixed_dates: intervals.size > 1,
      excluded
    } : null,
    excluded
  };
}

export type ChangeSummary = ReturnType<typeof changeSummary>;

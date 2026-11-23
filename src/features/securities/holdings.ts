import { Temporal } from "temporal-polyfill";
import { ValidationError } from "@/lib/errors";
import { currencyExponent } from "@/lib/money";
import type { LegSide } from "./trade-sides";

/** Quantities and prices are stored in millionths of a unit. */
export const microsPerUnit = 1_000_000n;

/** A price older than this many days before the valuation date is shown as stale; fund values lag a day and weekends add two. */
export const staleAfterDays = 7;

export type PositionTrade = {
  date: string;
  side: LegSide;
  /** The trade's recorded order within its account; it decides the replay order of trades on the same date. */
  sequence: number;
  quantity_micros: number;
  /** For a transfer leg, the cost basis it carries; a received leg adds it, a sent leg's own value is ignored by the replay. */
  gross_minor: number;
  fee_minor: number;
};

export type PositionSplit = {
  date: string;
  numerator: number;
  denominator: number;
};

/** A holding on one date: split-adjusted quantity, moving-average cost of what is still held and the gains realized by sales so far. */
export type Position = {
  quantity_micros: number;
  cost_minor: number;
  realized_minor: number;
};

export type PricePoint = {
  date: string;
  close_micros: number;
};

export type HoldingValuation = {
  status: "current" | "stale" | "missing";
  value_minor: number | null;
  price: PricePoint | null;
};

/** Divides and rounds half to even, so repeated roundings do not drift in one direction. */
function divideRounded(numerator: bigint, denominator: bigint) {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const dividend = numerator < 0n ? -numerator : numerator;
  const divisor = denominator < 0n ? -denominator : denominator;
  let quotient = dividend / divisor;
  const twiceRemainder = (dividend % divisor) * 2n;

  if (twiceRemainder > divisor || (twiceRemainder === divisor && quotient % 2n === 1n)) {
    quotient += 1n;
  }

  return negative ? -quotient : quotient;
}

function safeNumber(value: bigint) {
  const result = Number(value);

  if (!Number.isSafeInteger(result)) {
    throw new ValidationError("The amount is too large.");
  }

  return result;
}

function minorPerUnit(currency: string) {
  const exponent = currencyExponent(currency);

  if (exponent === undefined) {
    throw new ValidationError(`Unknown currency ${currency}.`);
  }

  return 10n ** BigInt(exponent);
}

/** The amount in minor units of `currency` for a quantity at a price, both in micro-units. */
export function amountMinor(quantityMicros: number, priceMicros: number, currency: string) {
  return safeNumber(divideRounded(BigInt(quantityMicros) * BigInt(priceMicros) * minorPerUnit(currency), microsPerUnit * microsPerUnit));
}

/** The average cost per unit in micro-units of `currency` for a cost in minor units over a quantity in micro-units, computed exactly. */
export function averageCostMicros(costMinor: number, quantityMicros: number, currency: string) {
  return safeNumber(divideRounded(BigInt(costMinor) * microsPerUnit * microsPerUnit, BigInt(quantityMicros) * minorPerUnit(currency)));
}

/**
 * Replays trades and splits up to and including `date` by date, then recorded sequence, whatever order they are passed in. A split takes effect at the start of its date, so trades on that date are already in post-split units.
 * Buys add their gross amount and fees to the cost; a sale removes the average cost of the sold part and realizes its proceeds less fees and that cost. Taxes are cash only.
 * A sent transfer removes the average cost of its part without realizing anything; a received one adds the cost it carries.
 */
export function positionOn(trades: PositionTrade[], splits: PositionSplit[], date: string): Position {
  return replay(trades, splits, date).position;
}

/** The cost basis a sent transfer leg takes out of the holding, replaying only what precedes it in its account. */
export function sentCost(trades: PositionTrade[], splits: PositionSplit[], leg: PositionTrade) {
  const prior = trades.filter(trade => trade !== leg && (trade.date < leg.date || (trade.date === leg.date && trade.sequence < leg.sequence)));
  const cost = replay([...prior, leg], splits, leg.date).sent.get(leg);

  if (cost === undefined) {
    throw new Error("The sent transfer leg was not replayed.");
  }

  return cost;
}

/** The gain each sale realized, keyed by the trade object passed in, by the same replay as `positionOn`. */
export function saleGains<T extends PositionTrade>(trades: T[], splits: PositionSplit[]) {
  return replay(trades, splits, "9999-12-31").sales as Map<T, number>;
}

function replay(trades: PositionTrade[], splits: PositionSplit[], date: string) {
  const events = [
    ...splits.filter(split => split.date <= date).map(split => ({
      date: split.date,
      order: 0,
      sequence: 0,
      split,
      trade: null
    })),
    ...trades.filter(trade => trade.date <= date).map(trade => ({
      date: trade.date,
      order: 1,
      sequence: trade.sequence,
      split: null,
      trade
    }))
  ].toSorted((left, right) => left.date.localeCompare(right.date) || left.order - right.order || left.sequence - right.sequence);
  const sales = new Map<PositionTrade, number>();
  const sent = new Map<PositionTrade, number>();
  let quantity = 0n;
  let cost = 0n;
  let realized = 0n;

  for (const event of events) {
    if (event.split) {
      quantity = divideRounded(quantity * BigInt(event.split.numerator), BigInt(event.split.denominator));
      continue;
    }

    const trade = event.trade;
    const traded = BigInt(trade.quantity_micros);

    if (trade.side === "buy" || trade.side === "transfer_in") {
      quantity += traded;
      cost += BigInt(trade.gross_minor) + BigInt(trade.fee_minor);
      continue;
    }

    if (traded > quantity) {
      throw new ValidationError(`The ${trade.side === "sell" ? "sale" : "transfer"} on ${trade.date} exceeds the quantity held.`);
    }

    if (trade.side === "transfer_out") {
      const movedCost = divideRounded(cost * traded, quantity);

      quantity -= traded;
      cost -= movedCost;
      sent.set(trade, safeNumber(movedCost));
      continue;
    }

    const soldCost = divideRounded(cost * traded, quantity);
    const gain = BigInt(trade.gross_minor) - BigInt(trade.fee_minor) - soldCost;

    quantity -= traded;
    cost -= soldCost;
    realized += gain;
    sales.set(trade, safeNumber(gain));
  }

  return {
    position: {
      quantity_micros: safeNumber(quantity),
      cost_minor: safeNumber(cost),
      realized_minor: safeNumber(realized)
    },
    sales,
    sent
  };
}

/** The latest price on or before `date`; never a later one. */
export function priceOn(prices: PricePoint[], date: string) {
  let latest: PricePoint | null = null;

  for (const price of prices) {
    if (price.date <= date && (!latest || price.date > latest.date)) {
      latest = price;
    }
  }

  return latest;
}

/** Values a quantity on `date` with the price valid then; without one the value is unknown rather than zero. */
/** The quantity in the units of an earlier close: splits after `after` through `through` apply in reverse, since a split is no price change. */
export function quantityBeforeSplits(quantityMicros: number, splits: PositionSplit[], after: string, through: string) {
  return splits.filter(split => split.date > after && split.date <= through).reduce((quantity, split) => Math.round(quantity * split.denominator / split.numerator), quantityMicros);
}

export function valueHolding(quantityMicros: number, splits: PositionSplit[], prices: PricePoint[], currency: string, date: string): HoldingValuation {
  // A position with nothing held is worth exactly zero, however old or missing its price.
  if (quantityMicros === 0) {
    return {
      status: "current",
      value_minor: 0,
      price: null
    };
  }

  const price = priceOn(prices, date);

  if (!price) {
    return {
      status: "missing",
      value_minor: null,
      price: null
    };
  }

  const age = Temporal.PlainDate.from(price.date).until(Temporal.PlainDate.from(date)).days;

  return {
    status: age > staleAfterDays ? "stale" : "current",
    // A split newer than the close leaves the close in pre-split units until a newer quote arrives.
    value_minor: amountMinor(quantityBeforeSplits(quantityMicros, splits, price.date, date), price.close_micros, currency),
    price
  };
}

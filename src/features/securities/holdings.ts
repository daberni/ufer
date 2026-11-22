import { Temporal } from "temporal-polyfill";
import { ValidationError } from "@/lib/errors";
import { currencyExponent } from "@/lib/money";
import type { TradeSide } from "./trade-sides";

/** Quantities and prices are stored in millionths of a unit. */
export const microsPerUnit = 1_000_000n;

/** A price older than this many days before the valuation date is shown as stale; fund values lag a day and weekends add two. */
export const staleAfterDays = 7;

export type PositionTrade = {
  date: string;
  side: TradeSide;
  quantity_micros: number;
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

/**
 * Replays trades and splits up to and including `date`. A split takes effect at the start of its date, so trades on that date are already in post-split units.
 * Buys add their gross amount and fees to the cost; a sale removes the average cost of the sold part and realizes its proceeds less fees and that cost. Taxes are cash only.
 */
export function positionOn(trades: PositionTrade[], splits: PositionSplit[], date: string): Position {
  const events = [
    ...splits.filter(split => split.date <= date).map(split => ({
      date: split.date,
      order: 0,
      split,
      trade: null
    })),
    ...trades.filter(trade => trade.date <= date).map(trade => ({
      date: trade.date,
      order: 1,
      split: null,
      trade
    }))
  ].toSorted((left, right) => left.date.localeCompare(right.date) || left.order - right.order);
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

    if (trade.side === "buy") {
      quantity += traded;
      cost += BigInt(trade.gross_minor) + BigInt(trade.fee_minor);
      continue;
    }

    if (traded > quantity) {
      throw new ValidationError(`The sale on ${trade.date} exceeds the quantity held.`);
    }

    const soldCost = divideRounded(cost * traded, quantity);

    quantity -= traded;
    cost -= soldCost;
    realized += BigInt(trade.gross_minor) - BigInt(trade.fee_minor) - soldCost;
  }

  return {
    quantity_micros: safeNumber(quantity),
    cost_minor: safeNumber(cost),
    realized_minor: safeNumber(realized)
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
export function valueHolding(quantityMicros: number, prices: PricePoint[], currency: string, date: string): HoldingValuation {
  const price = priceOn(prices, date);

  if (!price) {
    return {
      status: quantityMicros === 0 ? "current" : "missing",
      value_minor: quantityMicros === 0 ? 0 : null,
      price: null
    };
  }

  const age = Temporal.PlainDate.from(price.date).until(Temporal.PlainDate.from(date)).days;

  return {
    status: age > staleAfterDays ? "stale" : "current",
    value_minor: amountMinor(quantityMicros, price.close_micros, currency),
    price
  };
}

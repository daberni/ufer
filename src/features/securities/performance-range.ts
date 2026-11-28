import { Temporal } from "temporal-polyfill";
import type { PerformancePoint } from "./performance";
import type { PricePoint } from "./types";

export const performanceRanges = ["1W", "1M", "YTD", "1Y", "All"] as const;

export type PerformanceRange = (typeof performanceRanges)[number];

/** A performance point within a range: its return and gain since the range's start. */
export type RangePoint = {
  date: string;
  return_ratio: number;
  gain_minor: number;
};

function rangeStart(range: PerformanceRange, end: string) {
  const date = Temporal.PlainDate.from(end);

  switch (range) {
    case "1W": return date.subtract({
      weeks: 1
    }).toString();
    case "1M": return date.subtract({
      months: 1
    }).toString();
    case "1Y": return date.subtract({
      years: 1
    }).toString();
    case "YTD": return date.with({
      month: 1,
      day: 1
    }).subtract({
      days: 1
    }).toString();
    case "All": return null;
  }
}

/**
 * Rebases the performance series to a range ending on `asOf`: the range starts at the last point on or before its start date, so the opening value is the one valid then, and each later point's return is its growth relative to that point.
 * Gains subtract what was invested within the range, so a buy is never shown as a gain. A series that ended with a closing on or before the range's start has nothing in the range.
 */
export function performanceInRange(points: PerformancePoint[], range: PerformanceRange, asOf?: string): RangePoint[] {
  const last = points[points.length - 1];

  if (!last) {
    return [];
  }

  const start = rangeStart(range, asOf ?? last.date);

  if (start !== null && last.date <= start) {
    return [];
  }

  const startIndex = start === null ? 0 : Math.max(0, points.findLastIndex(point => point.date <= start));
  const base = points[startIndex];
  const baseGain = base.value_minor - base.invested_minor;

  return points.slice(startIndex).map(point => ({
    date: start !== null && point === base ? start : point.date,
    return_ratio: point.growth / base.growth - 1,
    gain_minor: point.value_minor - point.invested_minor - baseGain
  }));
}

/**
 * A security's closes, oldest first, within a range ending on `asOf`: from the last close on or before the range's start, so the range opens with the price valid then, through the newest close.
 */
export function pricesInRange(prices: PricePoint[], range: PerformanceRange, asOf: string): PricePoint[] {
  const start = rangeStart(range, asOf);

  if (start === null) {
    return prices;
  }

  const startIndex = Math.max(0, prices.findLastIndex(price => price.date <= start));

  return prices.slice(startIndex);
}

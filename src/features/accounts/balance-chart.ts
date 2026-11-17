import { Temporal } from "temporal-polyfill";

/** An amount on a calendar day, such as a recorded balance or a month's net worth. */
export type DatedAmount = {
  date: string;
  amount_minor: number;
};

/** A balance positioned in a 100 × 100 plot: x by date, y downwards from the highest balance. */
export type PlottedBalance = {
  x: number;
  y: number;
};

export type BalanceChart = {
  /** Each series' points, in the order given. */
  series: PlottedBalance[][];
  lowest: number;
  highest: number;
  /** The height of zero when the amounts lie on both sides of it. */
  zero: number | null;
};

// Space above the highest and below the lowest balance, as a share of their range, so the line never touches the plot's edge.
const verticalPadding = 0.1;

/**
 * Plots series of amounts, each oldest first, on one shared scale against their dates. Dates are spaced by days rather than by observation, so gaps between observations stay visible. A single day or an unchanged amount is drawn in the middle instead of dividing by zero.
 */
export function plotSeries(series: DatedAmount[][]): BalanceChart {
  const all = series.flat();

  if (!all.length) {
    return {
      series: series.map(() => []),
      lowest: 0,
      highest: 0,
      zero: null
    };
  }

  const dates = all.map(entry => entry.date).toSorted();
  const first = Temporal.PlainDate.from(dates[0]);
  const span = first.until(Temporal.PlainDate.from(dates[dates.length - 1])).days;
  let lowest = all[0].amount_minor;
  let highest = lowest;

  for (const entry of all) {
    lowest = Math.min(lowest, entry.amount_minor);
    highest = Math.max(highest, entry.amount_minor);
  }

  const range = highest - lowest;
  const padding = range > 0 ? range * verticalPadding : Math.max(Math.abs(highest) * verticalPadding, 1);
  const bottom = lowest - padding;
  const top = highest + padding;
  const height = (amount: number) => (top - amount) / (top - bottom) * 100;

  return {
    series: series.map(entries => entries.map(entry => ({
      x: span > 0 ? first.until(Temporal.PlainDate.from(entry.date)).days / span * 100 : 50,
      y: height(entry.amount_minor)
    }))),
    lowest,
    highest,
    zero: lowest < 0 && highest > 0 ? height(0) : null
  };
}

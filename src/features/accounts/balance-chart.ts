import { Temporal } from "temporal-polyfill";
import type { BalancePoint } from "@/features/accounts/types";

/** A balance positioned in a 100 × 100 plot: x by date, y downwards from the highest balance. */
export type PlottedBalance = {
  x: number;
  y: number;
};

export type BalanceChart = {
  points: PlottedBalance[];
  lowest: number;
  highest: number;
};

// Space above the highest and below the lowest balance, as a share of their range, so the line never touches the plot's edge.
const verticalPadding = 0.1;

/**
 * Plots balances, oldest first, against their dates. Dates are spaced by days rather than by observation, so gaps between syncs stay visible. A single day or an unchanged balance is drawn in the middle instead of dividing by zero.
 */
export function plotBalances(balances: BalancePoint[]): BalanceChart {
  if (!balances.length) {
    return {
      points: [],
      lowest: 0,
      highest: 0
    };
  }

  const first = Temporal.PlainDate.from(balances[0].date);
  const last = Temporal.PlainDate.from(balances[balances.length - 1].date);
  const span = first.until(last).days;
  let lowest = balances[0].amount_minor;
  let highest = lowest;

  for (const balance of balances) {
    lowest = Math.min(lowest, balance.amount_minor);
    highest = Math.max(highest, balance.amount_minor);
  }

  const range = highest - lowest;
  const padding = range > 0 ? range * verticalPadding : Math.max(Math.abs(highest) * verticalPadding, 1);
  const bottom = lowest - padding;
  const top = highest + padding;

  return {
    points: balances.map(balance => ({
      x: span > 0 ? first.until(Temporal.PlainDate.from(balance.date)).days / span * 100 : 50,
      y: (top - balance.amount_minor) / (top - bottom) * 100
    })),
    lowest,
    highest
  };
}

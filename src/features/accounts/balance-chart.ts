import { Temporal } from "temporal-polyfill";
import { valueScale } from "@/lib/value-scale";
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
  /** The zero level's y when the balances cross zero, otherwise null. */
  zero: number | null;
};

// Space above the highest and below the lowest balance, as a share of their range, so the line never touches the plot's edge.
const verticalPadding = 0.1;
const edge = verticalPadding / (1 + 2 * verticalPadding) * 100;

/**
 * Plots balances, oldest first, against their dates. Dates are spaced by days rather than by observation, so gaps between syncs stay visible. An unchanged balance is drawn in the middle.
 */
export function plotBalances(balances: BalancePoint[]): BalanceChart {
  if (!balances.length) {
    return {
      points: [],
      lowest: 0,
      highest: 0,
      zero: null
    };
  }

  const first = Temporal.PlainDate.from(balances[0].date);
  const last = Temporal.PlainDate.from(balances[balances.length - 1].date);
  const span = first.until(last).days;
  const scale = valueScale(balances.map(balance => balance.amount_minor), {
    top: edge,
    base: 100 - edge,
    flat: 50
  });

  return {
    points: balances.map(balance => ({
      x: span > 0 ? first.until(Temporal.PlainDate.from(balance.date)).days / span * 100 : 50,
      y: scale.y(balance.amount_minor)
    })),
    lowest: scale.lowest,
    highest: scale.highest,
    zero: scale.zero
  };
}

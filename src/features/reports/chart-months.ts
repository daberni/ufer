import { trendLength } from "@/lib/period";

/** The fewest months the cash-flow chart shows, even when narrow; its bars stay readable down to phone width. */
export const minimumChartMonths = 6;

// Room for a month's income and expense bars and its label, including the gap to the next month.
const monthWidth = 52;

/** How many of the latest months fit a chart of the given width in CSS pixels. */
export function chartMonthCount(width: number) {
  const fitting = Math.floor(width / monthWidth);

  return Math.min(trendLength, Math.max(minimumChartMonths, fitting));
}

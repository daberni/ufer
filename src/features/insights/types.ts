import type { DateSpan } from "@/lib/period-range";
import type { CategoryAmount } from "@/features/reports/types";

/** Income and expenses with their categories over a span, from the counted lines; each breakdown sums to its total. */
export type SpanFlows = DateSpan & {
  income: number;
  expenses: number;
  incomeBreakdown: CategoryAmount[];
  expenseBreakdown: CategoryAmount[];
};

export type Insights = {
  /** The selected range in its URL form. */
  range: string;
  currency: string;
  /** One column per interval, oldest first; the last is the selected range. */
  columns: SpanFlows[];
  /** The selected range against the previous interval; while the range runs, both cover the same number of days. */
  comparison: {
    partial: boolean;
    current: SpanFlows;
    previous: SpanFlows;
  };
};

/** Net-worth change over the insights' compared spans; null for a span that starts after today. */
export type NetWorthChangeComparison = {
  range: string;
  currency: string;
  current: number | null;
  previous: number | null;
};

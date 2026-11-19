import type { PeriodJson } from "@/lib/period";

/** Income or spending in one category; `categoryId` is null for uncategorized transactions. */
export type CategoryAmount = {
  categoryId: string | null;
  name: string;
  color: string;
  icon: string | null;
  amount: number;
};

export type CashFlow = {
  /** The period the figures were computed for. */
  period: PeriodJson;
  currency: string;
  income: number;
  expenses: number;
  /** Income by category in the period, largest first. */
  incomeBreakdown: CategoryAmount[];
  /** Spending by category in the period, largest first. */
  expenseBreakdown: CategoryAmount[];
  /** Totals of the month before the trend; they only continue the chart's net area to its left edge and count toward nothing else. */
  leadIn: {
    month: string;
    income: number;
    expenses: number;
  };
  trend: {
    month: string;
    income: number;
    expenses: number;
    /** Income by category in this month, largest first; it sums to `income` unless a category's net amount is not positive. */
    incomeBreakdown: CategoryAmount[];
    /** Spending by category in this month, largest first; it sums to `expenses` unless a category's refunds reach its spending. */
    expenseBreakdown: CategoryAmount[];
  }[];
};

/** One account's flows in a period, in the account's currency; income and expenses exclude categorized transfers, which are reported separately. */
export type AccountCashFlow = {
  period: PeriodJson;
  currency: string;
  income: number;
  expenses: number;
  transfersIn: number;
  transfersOut: number;
};

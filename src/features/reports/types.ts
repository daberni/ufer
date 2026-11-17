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
  /** Spending by category in the period, largest first. */
  breakdown: CategoryAmount[];
  trend: {
    month: string;
    income: number;
    expenses: number;
    /** Income by category in this month, largest first; it sums to `income`. */
    incomeBreakdown: CategoryAmount[];
    /** Spending by category in this month, largest first; it sums to `expenses`. */
    expenseBreakdown: CategoryAmount[];
  }[];
};

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
  /** Income by category in the period, largest first; it sums to `income` and may include negative rows. */
  incomeBreakdown: CategoryAmount[];
  /** Spending by category in the period, largest first; it sums to `expenses` and may include negative rows for net refunds. */
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
    /** Income by category in this month, largest first; it sums to `income`, with a negative row for a category whose corrections exceed its income. */
    incomeBreakdown: CategoryAmount[];
    /** Spending by category in this month, largest first; it sums to `expenses`, with a negative row for a category whose refunds exceed its spending. */
    expenseBreakdown: CategoryAmount[];
  }[];
};

/** A batch of trend months before the ones already loaded, oldest first, with the totals of the month before the batch. */
export type CashFlowHistory = Pick<CashFlow, "currency" | "leadIn" | "trend"> & {
  /** Whether counted transactions exist before the batch, so another batch is worth loading. */
  hasEarlier: boolean;
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

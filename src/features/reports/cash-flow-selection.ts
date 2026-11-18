import { groupByCategory, type CategoryGroup } from "./category-groups";
import type { CashFlow } from "./types";

export type CashFlowDirection = "income" | "expenses";

export const flowPresentation: Record<CashFlowDirection, {
  label: string;
  breakdownLabel: string;
  empty: string;
}> = {
  income: {
    label: "Income",
    breakdownLabel: "Income by category",
    empty: "No income this month."
  },
  expenses: {
    label: "Expenses",
    breakdownLabel: "Spending by category",
    empty: "No expenses this month."
  }
};

export type CashFlowSelection = {
  key: string;
  month: string;
  flow: CashFlowDirection;
  total: number;
  groups: CategoryGroup[];
};

/** A selected bar uses the same monthly breakdown and total as the chart, rather than the page's whole-period spending. */
export function selectedCashFlow(data: CashFlow, key: string | null): CashFlowSelection | null {
  const month = data.trend.find(item => key === `${item.month}-income` || key === `${item.month}-expenses`);

  if (!month || !key) {
    return null;
  }

  const flow = key === `${month.month}-income` ? "income" : "expenses";

  return {
    key,
    month: month.month,
    flow,
    total: month[flow],
    groups: groupByCategory(flow === "income" ? month.incomeBreakdown : month.expenseBreakdown)
  };
}

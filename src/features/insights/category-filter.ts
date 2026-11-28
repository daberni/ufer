import { keyOf } from "@/features/insights/category-comparison";
import type { CategoryAmount } from "@/features/reports/types";
import type { Insights, SpanFlows } from "@/features/insights/types";

function only(items: CategoryAmount[], category: string) {
  return items.filter(item => keyOf(item) === category);
}

function sum(items: CategoryAmount[]) {
  return items.reduce((total, item) => total + item.amount, 0);
}

/** A span's flows narrowed to one category: its income and expenses become the totals. Account rows cannot be narrowed by category, so they are left out. */
function filterFlows(flows: SpanFlows, category: string): SpanFlows {
  const incomeBreakdown = only(flows.incomeBreakdown, category);
  const expenseBreakdown = only(flows.expenseBreakdown, category);

  return {
    ...flows,
    income: sum(incomeBreakdown),
    expenses: sum(expenseBreakdown),
    incomeBreakdown,
    expenseBreakdown,
    incomeByAccount: [],
    expensesByAccount: []
  };
}

/** The insights narrowed to one category (an ID or "uncategorized"), so the income and expenses chart and the breakdown show only its amounts. */
export function filterInsights(data: Insights, category: string): Insights {
  return {
    ...data,
    columns: data.columns.map(column => filterFlows(column, category)),
    comparison: {
      ...data.comparison,
      current: filterFlows(data.comparison.current, category),
      previous: filterFlows(data.comparison.previous, category)
    }
  };
}

/** The mean net of the given columns in whole minor units; zero without columns. */
export function averageNet(columns: Pick<SpanFlows, "income" | "expenses">[]) {
  if (!columns.length) {
    return 0;
  }

  return Math.round(columns.reduce((total, column) => total + column.income - column.expenses, 0) / columns.length);
}

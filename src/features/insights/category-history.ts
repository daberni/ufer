import type { CategoryAmount } from "@/features/reports/types";
import { keyOf } from "@/features/insights/category-comparison";
import type { InsightsColumn } from "@/features/insights/insights-columns";

/** The flow a category's history follows: its income or its expenses, like the breakdown row it was opened from. */
export type HistoryFlow = "income" | "expense";

/** A column of a category's history: one interval and what the category contributed to the flow in it. */
export type HistoryColumn = Pick<InsightsColumn, "key" | "range"> & {
  amount: number;
};

function breakdownOf(column: InsightsColumn, flow: HistoryFlow) {
  return flow === "income" ? column.incomeBreakdown : column.expenseBreakdown;
}

/** The category's amount in each column, read from the same counted-lines breakdowns as the insights' other figures; a column without it counts zero. */
export function categoryHistory(columns: InsightsColumn[], category: string, flow: HistoryFlow): HistoryColumn[] {
  return columns.map(column => ({
    key: column.key,
    range: column.range,
    amount: breakdownOf(column, flow).find(item => keyOf(item) === category)?.amount ?? 0
  }));
}

/** The category's name, colour and icon from the latest column that lists it; null when no column does. */
export function historyCategory(columns: InsightsColumn[], category: string, flow: HistoryFlow): CategoryAmount | null {
  for (const column of [...columns].reverse()) {
    const found = breakdownOf(column, flow).find(item => keyOf(item) === category);

    if (found) {
      return found;
    }
  }

  return null;
}

/** The mean amount of the given columns in whole minor units; zero without columns. */
export function averageAmount(columns: Pick<HistoryColumn, "amount">[]) {
  if (!columns.length) {
    return 0;
  }

  return Math.round(columns.reduce((sum, column) => sum + column.amount, 0) / columns.length);
}

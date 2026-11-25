import { trendLength } from "@/lib/period";
import { parseRange, precedingRanges, type PeriodRange } from "@/lib/period-range";
import { compareCategories } from "@/features/insights/category-comparison";
import type { Insights, SpanFlows } from "@/features/insights/types";
import type { BreakdownGrouping, CategoryAmount } from "@/features/reports/types";

/** A chart column: one interval's range with its flows. */
export type InsightsColumn = SpanFlows & {
  key: string;
  range: PeriodRange;
};

/** The intervals the chart shows for a range, oldest first; the range itself is the last. */
export function columnRanges(range: PeriodRange) {
  return precedingRanges(range, trendLength);
}

/** The columns of a response, keyed by their first day, so they never mix with columns of the range being loaded. */
export function insightsColumns(data: Insights): InsightsColumn[] {
  const range = parseRange(data.range);

  if (!range) {
    return [];
  }

  return columnRanges(range).map((columnRange, index) => ({
    ...data.columns[index],
    key: columnRange.start.toString(),
    range: columnRange
  }));
}

/** The span a column is compared with: the previous column, or for the selected range its comparison span, which covers the same days while the range runs. */
export function previousFlows(data: Insights, columns: InsightsColumn[], index: number): SpanFlows | null {
  if (index === columns.length - 1) {
    return data.comparison.previous;
  }

  return columns[index - 1] ?? null;
}

/** A span's income and expense rows by category or by account. */
export function breakdownOf(flows: SpanFlows, grouping: BreakdownGrouping): {
  income: CategoryAmount[];
  expenses: CategoryAmount[];
} {
  if (grouping === "account") {
    return {
      income: flows.incomeByAccount,
      expenses: flows.expensesByAccount
    };
  }

  return {
    income: flows.incomeBreakdown,
    expenses: flows.expenseBreakdown
  };
}

/** Rows each breakdown column reserves: the most any column's comparison lists, so the panel keeps its height between columns. */
export function reservedComparisonRows(data: Insights, columns: InsightsColumn[], grouping: BreakdownGrouping) {
  const counts = columns.map((column, index) => {
    const current = breakdownOf(column, grouping);
    const previousFlow = previousFlows(data, columns, index);
    const previous = previousFlow ? breakdownOf(previousFlow, grouping) : null;

    return {
      income: compareCategories(current.income, previous?.income ?? null).groups.length,
      expenses: compareCategories(current.expenses, previous?.expenses ?? null).groups.length
    };
  });

  return {
    income: Math.max(1, ...counts.map(count => count.income)),
    expenses: Math.max(1, ...counts.map(count => count.expenses))
  };
}

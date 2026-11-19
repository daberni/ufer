import { groupByCategory, type CategoryGroup } from "./category-groups";
import type { CashFlow, CategoryAmount } from "./types";

/** Income, expenses and their categories for a month or a period, with the derived net flow and savings rate. */
export type CashFlowSummary = {
  income: number;
  expenses: number;
  /** Income minus expenses in minor units; negative when expenses exceed income. */
  net: number;
  /** Net divided by income, or null without positive income, where a rate would be meaningless. */
  savingsRate: number | null;
  incomeGroups: CategoryGroup[];
  expenseGroups: CategoryGroup[];
};

/** The month whose column is hovered, focused or tapped in the chart. */
export type CashFlowSelection = CashFlowSummary & {
  month: string;
};

/** Net flow and savings rate of the given totals; integer minor units stay exact and only the rate is a fraction. */
export function netFlow(income: number, expenses: number) {
  const net = income - expenses;

  return {
    net,
    savingsRate: income > 0 ? net / income : null
  };
}

function summarize(income: number, expenses: number, incomeBreakdown: CategoryAmount[], expenseBreakdown: CategoryAmount[]): CashFlowSummary {
  return {
    income,
    expenses,
    ...netFlow(income, expenses),
    incomeGroups: groupByCategory(incomeBreakdown),
    expenseGroups: groupByCategory(expenseBreakdown)
  };
}

/** The whole period's figures, shown while no month is selected. */
export function periodCashFlow(data: CashFlow): CashFlowSummary {
  return summarize(data.income, data.expenses, data.incomeBreakdown, data.expenseBreakdown);
}

/** Net flow and savings rate across the given trend months, such as the chart's twelve-month trend. */
export function trendCashFlow(trend: CashFlow["trend"]) {
  const income = trend.reduce((total, item) => total + item.income, 0);
  const expenses = trend.reduce((total, item) => total + item.expenses, 0);

  return netFlow(income, expenses);
}

/** A selected month uses the same monthly totals and breakdowns as its chart column, rather than the page's whole period. */
export function selectedCashFlow(data: CashFlow, month: string | null): CashFlowSelection | null {
  const item = data.trend.find(entry => entry.month === month);

  if (!item) {
    return null;
  }

  return {
    month: item.month,
    ...summarize(item.income, item.expenses, item.incomeBreakdown, item.expenseBreakdown)
  };
}

const rateFormat = new Intl.NumberFormat("en-GB", {
  style: "percent",
  maximumFractionDigits: 0
});

/** "18%", "-25%", or an en dash when there is no rate; a rate that rounds to zero shows "0%" rather than "-0%". */
export function formatSavingsRate(rate: number | null) {
  if (rate === null) {
    return "–";
  }

  const roundsToZero = Math.round(rate * 100) === 0;

  return rateFormat.format(roundsToZero ? 0 : rate);
}

/**
 * Category rows each column of the panel reserves: the most any month of the trend or the period needs, up to the row limit. The panel's height then stays the same for every selection without reserving rows no selection can fill.
 */
export function reservedCategoryRows(data: CashFlow) {
  const sources = [data, ...data.trend];
  const rows = (breakdown: (source: typeof sources[number]) => CategoryAmount[]) => Math.max(1, ...sources.map(source => groupByCategory(breakdown(source)).length));

  return {
    income: rows(source => source.incomeBreakdown),
    expenses: rows(source => source.expenseBreakdown)
  };
}

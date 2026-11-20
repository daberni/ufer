import { groupByCategory, type CategoryGroup } from "./category-groups";
import type { CashFlow, CategoryAmount } from "./types";
import { formatPercent, isNegativePercent } from "@/lib/locale";

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

/** Net flow and savings rate across the given trend months, such as the months visible in the chart. */
export function trendCashFlow(trend: CashFlow["trend"]) {
  const income = trend.reduce((total, item) => total + item.income, 0);
  const expenses = trend.reduce((total, item) => total + item.expenses, 0);

  return netFlow(income, expenses);
}

/**
 * The net at the plot's left edge: halfway between the month before the first visible one and that first month, as on the line between their column centres. That month is a hidden trend month when fewer months fit, otherwise the month before the trend.
 */
export function edgeNet(data: CashFlow, visibleCount: number) {
  const hiddenCount = data.trend.length - visibleCount;
  const previous = hiddenCount > 0 ? data.trend[hiddenCount - 1] : data.leadIn;
  const first = data.trend[hiddenCount];

  if (!first) {
    return null;
  }

  return (netFlow(previous.income, previous.expenses).net + netFlow(first.income, first.expenses).net) / 2;
}

/** Whether the chart has anything to draw: a visible month with a flow, or a net entering from the left edge out of an earlier month. */
export function hasCashFlowToDraw(visible: CashFlow["trend"], leftEdgeNet: number | null) {
  const visibleFlow = visible.some(item => item.income !== 0 || item.expenses !== 0);

  return visibleFlow || (leftEdgeNet !== null && leftEdgeNet !== 0);
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

/** Whether a rate is shown with a minus sign; a rate that rounds to zero is not. */
export function isNegativeRate(rate: number | null, locale: string) {
  return rate !== null && isNegativePercent(rate, locale);
}

/** "18%", "-25%", or an en dash when there is no rate. */
export function formatSavingsRate(rate: number | null, locale: string) {
  if (rate === null) {
    return "–";
  }

  return formatPercent(rate, locale);
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

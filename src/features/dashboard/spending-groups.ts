import type { SpendingItem } from "./types";

/** A row of a spending breakdown: one category, uncategorized spending, or the remaining categories combined. */
export type SpendingGroup = {
  key: string;
  name: string;
  color: string;
  icon: string | null;
  amount: number;
  /** Share of all spending in the breakdown, from 0 to 1. */
  share: number;
};

/** The most rows a spending breakdown shows, including the combined row for the remaining categories. */
export const spendingRowLimit = 5;

const remainderColor = "#cdd3c7";

function byAmount(first: SpendingItem, second: SpendingItem) {
  if (first.amount !== second.amount) {
    return second.amount - first.amount;
  }

  if (first.name === second.name) {
    return 0;
  }

  return first.name < second.name ? -1 : 1;
}

function groupOf(item: SpendingItem, total: number): SpendingGroup {
  return {
    key: item.categoryId ?? "uncategorized",
    name: item.name,
    color: item.color,
    icon: item.icon,
    amount: item.amount,
    share: total > 0 ? item.amount / total : 0
  };
}

function remainderOf(items: SpendingItem[], total: number): SpendingGroup {
  const amount = items.reduce((sum, item) => sum + item.amount, 0);

  return {
    key: "remainder",
    name: `${items.length} other categories`,
    color: remainderColor,
    icon: null,
    amount,
    share: total > 0 ? amount / total : 0
  };
}

/**
 * Rows for a spending breakdown, largest first. Up to five categories are shown as they are. With more, the four largest keep their rows and the rest are combined into a final row, so the rows always add up to all spending. Uncategorized spending always keeps its own row because it points to transactions that still need a category.
 */
export function groupSpending(items: SpendingItem[]): SpendingGroup[] {
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  const ranked = [...items].sort(byAmount);

  if (ranked.length <= spendingRowLimit) {
    return ranked.map(item => groupOf(item, total));
  }

  const uncategorized = ranked.filter(item => item.categoryId === null);
  const categorized = ranked.filter(item => item.categoryId !== null);
  const categorizedRows = spendingRowLimit - 1 - uncategorized.length;
  const kept = [...categorized.slice(0, categorizedRows), ...uncategorized].sort(byAmount);
  const remainder = categorized.slice(categorizedRows);

  return [...kept.map(item => groupOf(item, total)), remainderOf(remainder, total)];
}

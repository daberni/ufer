import type { CategoryAmount } from "./types";

/** A row of a breakdown by category: one category, uncategorized transactions, or the remaining categories combined. */
export type CategoryGroup = {
  key: string;
  name: string;
  color: string;
  icon: string | null;
  amount: number;
  /** Share of the positive rows' sum, from 0 to 1; 0 for a negative row, which reduces the total but has no bar. */
  share: number;
};

/** The most rows a breakdown by category shows, including the combined row for the remaining categories. */
export const categoryRowLimit = 5;

const remainderColor = "#cdd3c7";

function byAmount(first: CategoryAmount, second: CategoryAmount) {
  if (first.amount !== second.amount) {
    return second.amount - first.amount;
  }

  if (first.name === second.name) {
    return 0;
  }

  return first.name < second.name ? -1 : 1;
}

function shareOf(amount: number, positiveTotal: number) {
  return amount > 0 && positiveTotal > 0 ? amount / positiveTotal : 0;
}

function groupOf(item: CategoryAmount, total: number): CategoryGroup {
  return {
    key: item.categoryId ?? "uncategorized",
    name: item.name,
    color: item.color,
    icon: item.icon,
    amount: item.amount,
    share: shareOf(item.amount, total)
  };
}

function remainderOf(items: CategoryAmount[], total: number): CategoryGroup {
  const amount = items.reduce((sum, item) => sum + item.amount, 0);

  return {
    key: "remainder",
    name: `+${items.length} more`,
    color: remainderColor,
    icon: null,
    amount,
    share: shareOf(amount, total)
  };
}

/**
 * Rows for a breakdown of income or spending by category, largest first. Up to five categories are shown as they are. With more, the four largest keep their rows and the rest are combined into a final row, so the rows always add up to the total. Uncategorized transactions always keep their own row because they still need a category.
 */
export function groupByCategory(items: CategoryAmount[]): CategoryGroup[] {
  // Shares compare the positive rows with each other; negative rows still count toward the rows' sum.
  const total = items.reduce((sum, item) => sum + Math.max(0, item.amount), 0);
  const ranked = [...items].sort(byAmount);

  if (ranked.length <= categoryRowLimit) {
    return ranked.map(item => groupOf(item, total));
  }

  const uncategorized = ranked.filter(item => item.categoryId === null);
  const categorized = ranked.filter(item => item.categoryId !== null);
  const categorizedRows = categoryRowLimit - 1 - uncategorized.length;
  const kept = [...categorized.slice(0, categorizedRows), ...uncategorized].sort(byAmount);
  const remainder = categorized.slice(categorizedRows);

  return [...kept.map(item => groupOf(item, total)), remainderOf(remainder, total)];
}

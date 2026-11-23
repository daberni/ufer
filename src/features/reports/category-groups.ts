import { formatCount } from "@/lib/locale";
import type { CategoryAmount } from "./types";

/** A row of a breakdown by category: one category, uncategorized transactions, or the remaining categories combined. */
export type CategoryGroup = {
  key: string;
  /** The category name; empty for the combined row, which displayName labels with its count. */
  name: string;
  /** How many categories the combined row holds; 0 for every other row. */
  combined: number;
  color: string;
  icon: string | null;
  amount: number;
  /** Share of the positive rows' sum among the rows shown, from 0 to 1; 0 for a negative row, which reduces the total but has no bar. */
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

type Row = Omit<CategoryGroup, "share">;

function rowOf(item: CategoryAmount): Row {
  return {
    key: item.categoryId ?? "uncategorized",
    name: item.name,
    combined: 0,
    color: item.color,
    icon: item.icon,
    amount: item.amount
  };
}

function remainderOf(items: CategoryAmount[]): Row {
  return {
    key: "remainder",
    name: "",
    combined: items.length,
    color: remainderColor,
    icon: null,
    amount: items.reduce((sum, item) => sum + item.amount, 0)
  };
}

/** The row's label: a category name, or the translated combined-row label such as "+3 more" for the count in the locale's numerals. */
export function displayName(group: Pick<CategoryGroup, "name" | "combined">, locale: string, moreLabel: (count: string) => string) {
  return group.combined ? moreLabel(formatCount(group.combined, locale)) : group.name;
}

/** Shares of the rows actually shown: positive rows divide their own sum, so the visible bars always add up to the whole; negative rows have none. */
function withShares(rows: Row[]): CategoryGroup[] {
  const positiveTotal = rows.reduce((sum, row) => sum + Math.max(0, row.amount), 0);

  return rows.map(row => ({
    ...row,
    share: row.amount > 0 && positiveTotal > 0 ? row.amount / positiveTotal : 0
  }));
}

/**
 * Rows for a breakdown of income or spending by category, largest first. Up to five categories are shown as they are. With more, the four largest keep their rows and the rest are combined into a final row, so the rows always add up to the total. Uncategorized transactions always keep their own row because they still need a category.
 */
export function groupByCategory(items: CategoryAmount[]): CategoryGroup[] {
  const ranked = [...items].sort(byAmount);

  if (ranked.length <= categoryRowLimit) {
    return withShares(ranked.map(rowOf));
  }

  const uncategorized = ranked.filter(item => item.categoryId === null);
  const categorized = ranked.filter(item => item.categoryId !== null);
  const categorizedRows = categoryRowLimit - 1 - uncategorized.length;
  const kept = [...categorized.slice(0, categorizedRows), ...uncategorized].sort(byAmount);
  const remainder = categorized.slice(categorizedRows);

  return withShares([...kept.map(rowOf), remainderOf(remainder)]);
}

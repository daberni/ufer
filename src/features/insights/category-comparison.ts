import { categoryRows, type CategoryGroup } from "@/features/reports/category-groups";
import type { CategoryAmount } from "@/features/reports/types";

function keyOf(item: CategoryAmount) {
  return item.categoryId ?? "uncategorized";
}

/**
 * Every category of a flow in a span, each with its change against the previous span. A category only the previous span had stays listed with a zero amount, so a drop to nothing remains visible. Without a previous span there are no changes.
 */
export function compareCategories(current: CategoryAmount[], previous: CategoryAmount[] | null) {
  const currentKeys = new Set(current.map(keyOf));
  const vanished = (previous ?? []).filter(item => !currentKeys.has(keyOf(item))).map(item => ({
    ...item,
    amount: 0
  }));
  const groups: CategoryGroup[] = categoryRows([...current, ...vanished]);

  if (!previous) {
    return {
      groups,
      changes: null
    };
  }

  const before = new Map(previous.map(item => [keyOf(item), item.amount]));

  return {
    groups,
    changes: new Map(groups.map(group => [group.key, group.amount - (before.get(group.key) ?? 0)]))
  };
}

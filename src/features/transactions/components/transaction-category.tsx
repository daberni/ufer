"use client";

import styles from "./transaction-category.module.css";
import { api } from "@/client/api";
import type { Transaction } from "@/features/dashboard/types";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import { Select } from "@/components/ui/select";
import { CategoryMarker } from "@/features/categorization/components/category-marker";

type Props = Pick<DashboardController, "busy" | "perform" | "reportFeedback" | "state"> & {
  transaction: Transaction;
};

export function TransactionCategory({
  busy,
  perform,
  reportFeedback,
  state,
  transaction
}: Props) {
  if (!state) {
    return null;
  }

  const selectedCategory = state.categories.find(item => item.id === transaction.category_id);

  // The select keeps showing the saved category; a failure goes to the page overlay because table rows clip anchored content.
  async function changeCategory(categoryId: string) {
    const result = await perform(() => api(`transactions/${transaction.id}`, {
      category_id: categoryId || null
    }, "PATCH"));

    if (!result.ok) {
      reportFeedback({
        tone: "problem",
        messages: [`Category could not be changed: ${result.message}`]
      });
    }
  }

  return (
    <div className={styles["category"]}>
      <span className={styles["icon"]}>
        {selectedCategory && <CategoryMarker icon={selectedCategory.icon} color={selectedCategory.color} />}
      </span>
      <Select
        variant="compact"
        className={styles["category-select"]}
        aria-label={`Category for ${transaction.counterparty || transaction.description}`}
        value={transaction.category_id || ""}
        disabled={busy}
        onChange={event => changeCategory(event.target.value)}
      >
        <option value="">Uncategorized</option>
        {state?.categories.map(category => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

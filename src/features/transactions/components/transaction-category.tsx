"use client";

import styles from "./transaction-category.module.css";
import { api } from "@/client/api";
import type { Transaction } from "@/features/dashboard/types";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import { CategoryPicker } from "@/features/categorization/components/category-picker";

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

  // The picker keeps showing the saved category; a failure goes to the page overlay because table rows clip anchored content.
  async function changeCategory(categoryId: string | null) {
    const result = await perform(() => api(`transactions/${transaction.id}`, {
      category_id: categoryId
    }, "PATCH"));

    if (!result.ok) {
      reportFeedback({
        tone: "problem",
        messages: [`Category could not be changed: ${result.message}`]
      });
    }
  }

  return (
    <CategoryPicker
      className={styles["picker"]}
      categories={state.categories}
      value={transaction.category_id}
      includeUncategorized
      manual={transaction.category_source === "manual"}
      disabled={busy}
      aria-label={`Category for ${transaction.counterparty || transaction.description}`}
      onChange={changeCategory}
    />
  );
}

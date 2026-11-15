"use client";

import styles from "./transaction-category.module.css";
import { api } from "@/client/api";
import type { Transaction } from "@/features/dashboard/types";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "busy" | "perform" | "state"> & {
  transaction: Transaction;
};

export function TransactionCategory({
  busy,
  perform,
  state,
  transaction
}: Props) {
  if (!state) {
    return null;
  }

  return (
    <select
      className={styles["category-select"]}
      aria-label={`Category for ${transaction.counterparty || transaction.description}`}
      value={transaction.category_id || ""}
      disabled={busy}
      onChange={event => perform(() => api(`transactions/${transaction.id}`, {
        category_id: event.target.value || null
      }, "PATCH"))}
    >
      <option value="">Uncategorized</option>
      {state?.categories.map(category => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
    </select>
  );
}

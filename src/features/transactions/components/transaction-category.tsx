"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId } from "react";
import { clsx } from "clsx";
import styles from "./transaction-category.module.css";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import type { State, Transaction } from "@/features/dashboard/types";
import type { TransactionCategorization } from "@/features/transactions/use-transaction-categorization";
import { Select } from "@/components/ui/select";
import { CategoryMarker } from "@/features/categorization/components/category-marker";

type Props = {
  categories: State["categories"];
  categorization: TransactionCategorization;
  transaction: Transaction;
};

export function TransactionCategory({
  categories,
  categorization,
  transaction
}: Props) {
  const messageId = useId();
  const categoryId = categorization.categoryFor(transaction);
  const status = categorization.statusFor(transaction);
  const selectedCategory = categories.find(item => item.id === categoryId);
  const failure = status?.kind === "failed" ? `Category not saved: ${status.message}` : "";
  const announcements = {
    saving: "Saving category …",
    saved: "Category saved.",
    failed: failure
  };

  return (
    <div className={styles["category"]}>
      <span className={styles["icon"]}>
        {selectedCategory && <CategoryMarker icon={selectedCategory.icon} color={selectedCategory.color} />}
      </span>
      <Select
        variant="compact"
        className={styles["category-select"]}
        aria-label={`Category for ${transaction.counterparty || transaction.description}`}
        aria-busy={status?.kind === "saving"}
        aria-invalid={status?.kind === "failed"}
        aria-describedby={failure ? messageId : undefined}
        value={categoryId || ""}
        onChange={event => categorization.changeCategory(transaction, event.target.value || null)}
      >
        <option value="">Uncategorized</option>
        {categories.map(category => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </Select>
      <span className={clsx(styles["status"], status && styles[status.kind])} aria-hidden="true">
        {status?.kind === "saving" && <LoaderCircle size={14} className={ui["spinning"]} />}
        {status?.kind === "saved" && <Check size={14} />}
        {status?.kind === "failed" && <CircleAlert size={14} />}
      </span>
      <span className={styles["announcer"]} role="status" aria-live={failure ? "assertive" : "polite"}>
        {status ? announcements[status.kind] : ""}
      </span>
      {failure && (
        <span id={messageId} className={styles["message"]} title={failure}>
          {failure}
        </span>
      )}
    </div>
  );
}

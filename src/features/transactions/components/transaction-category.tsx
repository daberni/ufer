"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId } from "react";
import { clsx } from "clsx";
import styles from "./transaction-category.module.css";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import type { Category } from "@/features/categorization/types";
import type { Transaction } from "@/features/transactions/types";
import { TraceId } from "@/components/ui/trace-id";
import { CategoryPicker } from "@/features/categorization/components/category-picker";
import { useTransactionCategory } from "@/features/transactions/use-transaction-category";

type Props = {
  categories: Category[];
  transaction: Transaction;
};

export function TransactionCategory({
  categories,
  transaction
}: Props) {
  const messageId = useId();
  const {
    categoryId,
    status,
    change
  } = useTransactionCategory(transaction);
  const failure = status?.kind === "failed" ? `Category not saved: ${status.failure.message}` : "";
  const announcements = {
    saving: "Saving category …",
    saved: "Category saved.",
    failed: failure
  };
  // A pending choice is a manual assignment before the server confirms it.
  const manual = status?.kind === "saving" || transaction.category_source === "manual";

  return (
    <div className={styles["category"]}>
      <CategoryPicker
        className={styles["picker"]}
        categories={categories}
        value={categoryId}
        includeUncategorized
        manual={manual}
        aria-label={`Category for ${transaction.counterparty || transaction.description}`}
        aria-busy={status?.kind === "saving"}
        aria-invalid={status?.kind === "failed"}
        aria-describedby={failure ? messageId : undefined}
        onChange={change}
      />
      <span className={clsx(styles["status"], status && styles[status.kind])} aria-hidden="true">
        {status?.kind === "saving" && <LoaderCircle size={14} className={ui["spinning"]} />}
        {status?.kind === "saved" && <Check size={14} />}
        {status?.kind === "failed" && <CircleAlert size={14} />}
      </span>
      <span className={ui["visually-hidden"]} role="status" aria-live={failure ? "assertive" : "polite"}>
        {status ? announcements[status.kind] : ""}
      </span>
      {failure && (
        <span id={messageId} className={styles["message"]} title={failure}>
          <span className={styles["message-text"]}>{failure}</span>
          <TraceId id={status?.kind === "failed" ? status.failure.traceId : undefined} />
        </span>
      )}
    </div>
  );
}

/** The category control's place in a skeleton row, so the row keeps the height of a loaded one. */
export function TransactionCategorySkeleton() {
  return (
    <div className={styles["category"]}>
      <span className={clsx(styles["picker"], styles["picker-placeholder"], ui["skeleton"])} />
      <span className={styles["status"]} />
    </div>
  );
}

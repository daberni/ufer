"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId, useState } from "react";
import { clsx } from "clsx";
import styles from "./transaction-category.module.css";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import type { Category } from "@/features/categorization/types";
import type { Transaction } from "@/features/transactions/types";
import { TraceId } from "@/components/ui/trace-id";
import { CategoryPicker } from "@/features/categorization/components/category-picker";
import { RuleFromAssignmentDialog } from "@/features/categorization/components/rule-from-assignment-form";
import { useTransactionCategory } from "@/features/transactions/use-transaction-category";
import { transactionTypeLabels } from "@/features/transactions/transaction-types";

type Props = {
  categories: Category[];
  transaction: Transaction;
};

type RuleDraft = {
  change: number | undefined;
  categoryId: string;
  counterparty: string;
  description: string;
};

type CreatedRule = {
  change: number | undefined;
  categorized: number;
};

function createdText(categorized: number) {
  if (categorized === 0) {
    return "Rule created.";
  }

  return `Rule created; ${categorized.toLocaleString("en")} ${categorized === 1 ? "transaction" : "transactions"} categorized.`;
}

export function TransactionCategory({
  categories,
  transaction
}: Props) {
  const messageId = useId();
  const fieldId = useId();
  const {
    categoryId,
    status,
    latestChange,
    change
  } = useTransactionCategory(transaction);
  const [creatingRule, setCreatingRule] = useState<RuleDraft | null>(null);
  const [createdRule, setCreatedRule] = useState<CreatedRule>();
  const created = createdRule?.change === latestChange ? createdRule : undefined;
  const failure = status?.kind === "failed" ? `Category not saved: ${status.failure.message}` : "";
  const announcements = {
    saving: "Saving category …",
    saved: "Category saved.",
    failed: failure
  };
  // A pending choice is a manual assignment before the server confirms it.
  const manual = status?.kind === "saving" || transaction.category_source === "manual";
  const assignmentSource = manual ? "manual" : "rule";
  let announcement = status ? announcements[status.kind] : "";

  if (created) {
    announcement = createdText(created.categorized);
  }

  return (
    <div className={styles["category"]}>
      <CategoryPicker
        id={fieldId}
        className={styles["picker"]}
        size="compact"
        appearance="inline"
        categories={categories}
        value={categoryId}
        includeUncategorized
        assignment={{
          source: categoryId === null ? null : assignmentSource,
          actionLabel: `Create rule for ${transaction.counterparty || transaction.description || transactionTypeLabels[transaction.type]}`,
          disabled: status?.kind === "saving",
          createRule: () => {
            if (categoryId !== null) {
              setCreatingRule({
                change: latestChange,
                categoryId,
                counterparty: transaction.counterparty,
                description: transaction.description
              });
            }
          }
        }}
        status={(
          <span className={clsx(styles["status"], status && styles[status.kind])} aria-hidden="true">
            {status?.kind === "saving" && <LoaderCircle className={ui["spinning"]} />}
            {status?.kind === "saved" && <Check />}
            {status?.kind === "failed" && <CircleAlert />}
          </span>
        )}
        aria-label={`Category for ${transaction.counterparty || transaction.description || transactionTypeLabels[transaction.type]}`}
        aria-busy={status?.kind === "saving"}
        aria-invalid={status?.kind === "failed"}
        aria-describedby={failure ? messageId : undefined}
        onChange={change}
      />
      <span className={ui["visually-hidden"]} role="status" aria-live={failure ? "assertive" : "polite"}>
        {announcement}
      </span>
      {failure && (
        <span id={messageId} className={styles["message"]} title={failure}>
          <span className={styles["message-text"]}>{failure}</span>
          <TraceId id={status?.kind === "failed" ? status.failure.traceId : undefined} />
        </span>
      )}
      {creatingRule && (
        <RuleFromAssignmentDialog
          counterparty={creatingRule.counterparty}
          description={creatingRule.description}
          categoryId={creatingRule.categoryId}
          close={() => setCreatingRule(null)}
          onCreated={categorized => {
            setCreatedRule({
              change: creatingRule.change,
              categorized
            });
          }}
        />
      )}
    </div>
  );
}

/** The category control's place in a skeleton row, so the row keeps the height of a loaded one. */
export function TransactionCategorySkeleton() {
  return (
    <div className={styles["category"]}>
      <span className={clsx(styles["picker"], styles["picker-placeholder"], ui["skeleton"])} />
    </div>
  );
}

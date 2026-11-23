"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId } from "react";
import { clsx } from "clsx";
import styles from "./transaction-category.module.css";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import type { Category, Rule } from "@/features/categorization/types";
import type { Transaction } from "@/features/transactions/types";
import { TraceId } from "@/components/ui/trace-id";
import { CategoryPicker } from "@/features/categorization/components/category-picker";
import { useTransactionCategory } from "@/features/transactions/use-transaction-category";
import { useTransactionRules } from "./transaction-rule-provider";
import { useTranslations } from "next-intl";

type Props = {
  categories: Category[];
  transaction: Transaction;
};

/** Names what returning to automatic categorization assigns, for example: Automatic · Groceries via rule “Market”. */
export function automaticLabel(assignment: NonNullable<Transaction["automatic_assignment"]>, categories: readonly Category[], rule: Rule | undefined, t: ReturnType<typeof useTranslations<"transactions.category">>) {
  const category = categories.find(candidate => candidate.id === assignment.category_id);

  if (!category) {
    return t("automaticUncategorized");
  }

  if (!rule) {
    return t("automaticViaRule", {
      category: category.name
    });
  }

  return t("automaticViaNamedRule", {
    category: category.name,
    rule: rule.name
  });
}

export function TransactionCategory({
  categories,
  transaction
}: Props) {
  const t = useTranslations("transactions");
  const tCategory = useTranslations("transactions.category");
  const messageId = useId();
  const fieldId = useId();
  const {
    categoryId,
    pendingAutomatic,
    status,
    change,
    returnToAutomatic
  } = useTransactionCategory(transaction);
  const rules = useTransactionRules();
  const failure = status?.kind === "failed" ? tCategory("failed", {
    message: status.failure.message
  }) : "";
  const announcements = {
    saving: tCategory("saving"),
    saved: tCategory("saved"),
    failed: failure
  };
  const subject = transaction.counterparty || transaction.description || t(`types.${transaction.type}`);
  // A pending choice is a manual assignment before the server confirms it, unless it returns the transaction to the rules.
  const manual = pendingAutomatic ? false : status?.kind === "saving" || transaction.category_source === "manual";
  const automatic = transaction.category_source === "manual" && !pendingAutomatic ? transaction.automatic_assignment : null;
  const assignmentSource = manual ? "manual" : "rule";
  const announcement = status ? announcements[status.kind] : "";
  // A rule deleted since, or one not yet loaded, leaves the indicator informational.
  const assigningRule = manual ? undefined : rules.findRule(transaction.category_rule_id);

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
        automaticOption={automatic ? {
          label: automaticLabel(automatic, categories, rules.findRule(automatic.rule_id), tCategory),
          choose: () => {
            rules.clearAnnouncement();
            returnToAutomatic();
          }
        } : undefined}
        assignment={{
          source: categoryId === null ? null : assignmentSource,
          actionLabel: tCategory("createRule", {
            subject
          }),
          disabled: status?.kind === "saving",
          assigningRule: assigningRule && {
            label: tCategory("openRule", {
              rule: assigningRule.name
            }),
            open: () => rules.edit(assigningRule, fieldId)
          },
          createRule: () => {
            if (categoryId !== null && manual) {
              rules.open({
                transactionId: transaction.id,
                categoryId,
                // Rules match the source's text, so a pattern from a person's override would not match later deliveries.
                counterparty: transaction.source_counterparty,
                description: transaction.source_description
              }, fieldId);
            }
          }
        }}
        status={status && (
          <span className={clsx(styles["status"], styles[status.kind])} aria-hidden="true">
            {status.kind === "saving" && <LoaderCircle className={ui["spinning"]} />}
            {status.kind === "saved" && <Check />}
            {status.kind === "failed" && <CircleAlert />}
          </span>
        )}
        aria-label={tCategory("label", {
          subject
        })}
        aria-busy={status?.kind === "saving"}
        aria-invalid={status?.kind === "failed"}
        aria-describedby={failure ? messageId : undefined}
        onChange={next => {
          rules.clearAnnouncement();
          change(next);
        }}
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

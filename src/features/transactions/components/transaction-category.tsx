"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useEffect, useId, useRef, useState } from "react";
import { clsx } from "clsx";
import styles from "./transaction-category.module.css";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import type { Category } from "@/features/categorization/types";
import type { Transaction } from "@/features/transactions/types";
import { TraceId } from "@/components/ui/trace-id";
import { useDismiss } from "@/components/ui/use-dismiss";
import { CategoryPicker } from "@/features/categorization/components/category-picker";
import { RuleFromAssignmentDialog } from "@/features/categorization/components/rule-from-assignment-form";
import { useTransactionCategory, type RuleOffer } from "@/features/transactions/use-transaction-category";
import { transactionTypeLabels } from "@/features/transactions/transaction-types";
import { RuleOffer as RuleOfferPrompt } from "./rule-offer";

type Props = {
  categories: Category[];
  transaction: Transaction;
};

/** What became of the rule offer of a saved change. */
type OfferOutcome = {
  change: number;
  kind: "dismissed";
} | {
  change: number;
  kind: "created";
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
  const categoryRef = useRef<HTMLDivElement>(null);
  const {
    categoryId,
    status,
    ruleOffer,
    latestChange,
    change
  } = useTransactionCategory(transaction);
  const [offerOutcome, setOfferOutcome] = useState<OfferOutcome>();
  // The offer a rule is being created from; the dialog keeps it even when a later save elsewhere moves the offer to another row.
  const [creatingRule, setCreatingRule] = useState<RuleOffer | null>(null);
  const [fieldFocusRequest, setFieldFocusRequest] = useState(0);
  const offered = ruleOffer !== null && offerOutcome?.change !== ruleOffer.change;
  const createdOutcome = offerOutcome?.kind === "created" ? offerOutcome : undefined;
  // The confirmation lasts until the row changes again, so a pending or failed change shows only its own status.
  const created = createdOutcome?.change === latestChange ? createdOutcome : undefined;
  const failure = status?.kind === "failed" ? `Category not saved: ${status.failure.message}` : "";
  const announcements = {
    saving: "Saving category …",
    saved: offered ? "Category saved. Create rule is available." : "Category saved.",
    failed: failure
  };
  // A pending choice is a manual assignment before the server confirms it.
  const manual = status?.kind === "saving" || transaction.category_source === "manual";
  let announcement = status ? announcements[status.kind] : "";

  if (created) {
    announcement = createdText(created.categorized);
  }

  // The offer and its confirmation are transient: Escape and a press outside the category field dismiss them.
  useDismiss({
    active: (offered || created !== undefined) && creatingRule === null,
    inside: [categoryRef],
    onDismiss: dismissal => {
      const shownChange = offered ? ruleOffer.change : created?.change;

      if (shownChange !== undefined) {
        setOfferOutcome({
          change: shownChange,
          kind: "dismissed"
        });
      }

      if (dismissal.focusInside) {
        document.getElementById(fieldId)?.focus();
      }
    }
  });

  // Runs after the closed dialog has tried to restore focus to an offer button that is gone, such as once the rule exists.
  useEffect(() => {
    if (fieldFocusRequest > 0) {
      document.getElementById(fieldId)?.focus();
    }
  }, [fieldFocusRequest, fieldId]);

  function closeRuleDialog() {
    setCreatingRule(null);
    // The suggestion is hidden while its dialog is open; return to the field instead of a hidden or replaced opener.
    setFieldFocusRequest(request => request + 1);
  }

  return (
    <div ref={categoryRef} className={styles["category"]}>
      <CategoryPicker
        id={fieldId}
        className={styles["picker"]}
        size="compact"
        appearance="inline"
        categories={categories}
        value={categoryId}
        includeUncategorized
        manual={manual}
        status={status && (
          <span className={clsx(styles["status"], styles[status.kind])} aria-hidden="true">
            {status.kind === "saving" && <LoaderCircle className={ui["spinning"]} />}
            {status.kind === "saved" && <Check />}
            {status.kind === "failed" && <CircleAlert />}
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
      {offered && creatingRule === null && (
        <RuleOfferPrompt
          anchor={categoryRef}
          payee={transaction.counterparty || transaction.description || transactionTypeLabels[transaction.type]}
          category={categories.find(category => category.id === ruleOffer.categoryId)?.name ?? "Selected category"}
          onCreate={() => setCreatingRule(ruleOffer)}
          onDismiss={() => {
            setOfferOutcome({
              change: ruleOffer.change,
              kind: "dismissed"
            });
            setFieldFocusRequest(request => request + 1);
          }}
        />
      )}
      {created && (
        <span className={clsx(styles["offer"], styles["created"])} aria-hidden="true">
          <Check />
          {createdText(created.categorized)}
        </span>
      )}
      {creatingRule && (
        <RuleFromAssignmentDialog
          counterparty={transaction.counterparty}
          description={transaction.description}
          categoryId={creatingRule.categoryId}
          close={closeRuleDialog}
          onCreated={categorized => {
            setOfferOutcome({
              change: creatingRule.change,
              kind: "created",
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

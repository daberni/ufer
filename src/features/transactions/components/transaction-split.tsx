"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useEffect, useId, useState } from "react";
import { clsx } from "clsx";
import { CircleAlert, Plus, Split, X } from "lucide-react";
import styles from "./transaction-split.module.css";
import { CategoryPicker } from "@/features/categorization/components/category-picker";
import type { Category } from "@/features/categorization/types";
import { money } from "@/lib/money";
import type { Transaction, TransactionSplit } from "@/features/transactions/types";
import { nextPartAmount, type DraftPart, type DraftState, type SplitDraft } from "@/features/transactions/split-draft";
import { useLocale } from "@/client/locale-provider";
import { formatCount } from "@/lib/locale";
import { useTranslations } from "next-intl";

type SplitTranslator = ReturnType<typeof useTranslations<"transactions.split">>;

/** Whether a booking of this type can be split; only income and expenses count by category. */
export function splittable(transaction: Transaction) {
  return transaction.type === "income" || transaction.type === "expense";
}

/** The number of distinct categories, counting uncategorized parts as one. */
function splitCategoryCount(split: TransactionSplit) {
  return new Set(split.parts.map(part => part.category_id)).size;
}

function partsTotal(split: TransactionSplit) {
  return split.parts.reduce((sum, part) => sum + part.amount_minor, 0);
}

/** Why an unbalanced split is flagged and how reports count it meanwhile. */
function unbalancedNote(transaction: Transaction, split: TransactionSplit, locale: string, t: SplitTranslator) {
  const total = money(partsTotal(split), transaction.currency, locale);
  const amount = money(transaction.amount_minor, transaction.currency, locale);

  return t("unbalanced", {
    total,
    amount
  });
}

/** The split cell of a transaction row: how many categories, flagged when the parts no longer add up to the booking. Pressing the row opens the split in the edit dialog. */
export function SplitTag({
  transaction,
  split
}: {
  transaction: Transaction;
  split: TransactionSplit;
}) {
  const locale = useLocale();
  const t = useTranslations("transactions.split");
  const label = t("tag", {
    count: splitCategoryCount(split)
  });
  const warning = split.balanced ? undefined : unbalancedNote(transaction, split, locale, t);

  return (
    <span className={clsx(styles["tag"], !split.balanced && styles["unbalanced"])} title={warning}>
      {split.balanced ? <Split size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
      <span>{label}</span>
      {warning && <span className={ui["visually-hidden"]}>{` ${warning}`}</span>}
    </span>
  );
}

function statusText(state: DraftState, currency: string, locale: string, t: SplitTranslator) {
  const remaining = money(Math.abs(state.remaining), currency, locale);

  switch (state.status) {
    case "invalid":
      return t("status.invalid");
    case "under":
      return t("status.under", {
        remaining
      });
    case "over":
      return t("status.over", {
        remaining
      });
    case "single":
      return t("status.single");
    default:
      return t("status.complete");
  }
}

/**
 * Edits a booking's split inside the transaction dialog. Part amounts are entered in the booking's direction and must add up to the total; parts with an amount of 0 are ignored.
 * The summary compares the assigned amount with the total and carries every validation message. A new part starts with what is still to assign.
 */
export function SplitEditor({
  transaction,
  categories,
  draft,
  state,
  disabled,
  focusFirst,
  onDraft,
  onClose
}: {
  transaction: Transaction;
  categories: Category[];
  draft: SplitDraft;
  state: DraftState;
  disabled: boolean;
  /** Moves focus to the first amount when the person opened the section, whose trigger then disappears. */
  focusFirst: boolean;
  onDraft: (draft: SplitDraft) => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("transactions.split");
  const statusId = useId();
  // The part just added, whose category takes focus since its amount is already filled in.
  const [addedKey, setAddedKey] = useState<number | null>(null);
  const total = Math.abs(transaction.amount_minor);
  const fill = total === 0 ? 0 : Math.min(100, Math.max(0, state.assigned / total * 100));
  const problem = state.status === "invalid" || state.status === "under" || state.status === "over";

  function update(key: number, change: Partial<DraftPart>) {
    onDraft({
      ...draft,
      parts: draft.parts.map(part => part.key === key ? {
        ...part,
        ...change
      } : part)
    });
  }

  return (
    <section className={styles["section"]} aria-label={t("title")}>
      <div className={styles["section-head"]}>
        <h3 className={styles["section-title"]}>
          <Split size={15} aria-hidden="true" />
          {t("title")}
        </h3>
        <button
          type="button"
          className={clsx(ui["text-button"], styles["close"])}
          disabled={disabled}
          onClick={onClose}
        >
          <X size={14} aria-hidden="true" />
          {transaction.split ? t("remove") : t("cancel")}
        </button>
      </div>
      <div className={styles["meter-row"]}>
        <div className={styles["meter-text"]}>
          <span>
            {t.rich("assigned", {
              assigned: money(state.assigned, transaction.currency, locale),
              total: money(total, transaction.currency, locale),
              strong: chunks => <strong>{chunks}</strong>
            })}
          </span>
          <span id={statusId} className={clsx(styles["status"], problem && styles["problem"])} role="status">
            {problem && <CircleAlert size={14} aria-hidden="true" />}
            {statusText(state, transaction.currency, locale, t)}
          </span>
        </div>
        <span className={clsx(styles["meter"], state.status === "over" && styles["over"])} aria-hidden="true">
          <span
            style={{
              width: `${fill}%`
            }}
          />
        </span>
      </div>
      <ol className={styles["editor"]}>
        {draft.parts.map((part, index) => (
          <SplitPartFields
            key={part.key}
            position={index + 1}
            part={part}
            invalid={state.amounts[index] === null}
            categories={categories}
            statusId={statusId}
            focusAmount={focusFirst && index === 0}
            focusCategory={part.key === addedKey}
            onChange={change => update(part.key, change)}
            onRemove={draft.parts.length > 1 ? () => onDraft({
              ...draft,
              parts: draft.parts.filter(item => item.key !== part.key)
            }) : undefined}
          />
        ))}
      </ol>
      <button
        type="button"
        className={ui["text-button"]}
        disabled={disabled || !state.canAdd}
        onClick={() => {
          setAddedKey(draft.nextKey);
          onDraft({
            ...draft,
            parts: [...draft.parts, {
              key: draft.nextKey,
              amount: nextPartAmount(state, transaction.currency),
              categoryId: null,
              note: ""
            }],
            nextKey: draft.nextKey + 1
          });
        }}
      >
        <Plus size={14} aria-hidden="true" />
        {t("addPart")}
      </button>
    </section>
  );
}

function SplitPartFields({
  position,
  part,
  invalid,
  categories,
  statusId,
  focusAmount,
  focusCategory,
  onChange,
  onRemove
}: {
  position: number;
  part: DraftPart;
  invalid: boolean;
  categories: Category[];
  statusId: string;
  focusAmount: boolean;
  focusCategory: boolean;
  onChange: (change: Partial<DraftPart>) => void;
  onRemove?: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("transactions.split");
  const fieldId = useId();
  const categoryId = `${fieldId}-category`;
  const shownPosition = formatCount(position, locale);

  useEffect(() => {
    if (focusCategory) {
      document.getElementById(categoryId)?.focus();
    }
  }, [focusCategory, categoryId]);

  return (
    <li className={styles["part"]}>
      <input
        className={styles["amount"]}
        aria-label={t("partAmount", {
          position: shownPosition
        })}
        autoFocus={focusAmount}
        inputMode="decimal"
        placeholder="0.00"
        value={part.amount}
        aria-invalid={invalid || undefined}
        aria-describedby={statusId}
        onChange={event => onChange({
          amount: event.target.value
        })}
      />
      <div className={styles["category"]}>
        <label htmlFor={categoryId} className={ui["visually-hidden"]}>{t("partCategory", {
          position: shownPosition
        })}</label>
        <CategoryPicker
          id={categoryId}
          categories={categories}
          value={part.categoryId}
          includeUncategorized
          onChange={value => onChange({
            categoryId: value
          })}
        />
      </div>
      <input
        className={styles["note"]}
        aria-label={t("partNote", {
          position: shownPosition
        })}
        maxLength={200}
        placeholder={t("note")}
        value={part.note}
        onChange={event => onChange({
          note: event.target.value
        })}
      />
      {onRemove ? (
        <button
          type="button"
          className={styles["remove"]}
          aria-label={t("removePart", {
            position: shownPosition
          })}
          onClick={onRemove}
        >
          <X size={16} />
        </button>
      ) : <span className={styles["remove-placeholder"]} />}
    </li>
  );
}

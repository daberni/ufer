"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId, type ReactNode } from "react";
import { clsx } from "clsx";
import { CircleAlert, Plus, Split, X } from "lucide-react";
import styles from "./transaction-split.module.css";
import { CategoryPicker } from "@/features/categorization/components/category-picker";
import type { Category } from "@/features/categorization/types";
import { money } from "@/lib/money";
import type { Transaction, TransactionSplit } from "@/features/transactions/types";
import type { DraftPart, DraftState, SplitDraft } from "@/features/transactions/split-draft";

/** Whether a booking of this type can be split; only income and expenses count by category. */
export function splittable(transaction: Transaction) {
  return transaction.type === "income" || transaction.type === "expense";
}

/** For example "Split · 3 categories"; the number of distinct categories, counting uncategorized parts as one. */
export function splitLabel(split: TransactionSplit) {
  const count = new Set(split.parts.map(part => part.category_id)).size;

  return `Split · ${count} ${count === 1 ? "category" : "categories"}`;
}

function partsTotal(split: TransactionSplit) {
  return split.parts.reduce((sum, part) => sum + part.amount_minor, 0);
}

/** Why an unbalanced split is flagged and how reports count it meanwhile. */
function unbalancedNote(transaction: Transaction, split: TransactionSplit) {
  const total = money(partsTotal(split), transaction.currency);
  const amount = money(transaction.amount_minor, transaction.currency);

  return `The parts add up to ${total}, but the booking is now ${amount}. Reports count the difference as uncategorized until the split is corrected.`;
}

/** The split cell of a transaction row: how many categories, flagged when the parts no longer add up to the booking. Pressing the row opens the split in the edit dialog. */
export function SplitTag({
  transaction,
  split
}: {
  transaction: Transaction;
  split: TransactionSplit;
}) {
  const label = splitLabel(split);
  const warning = split.balanced ? undefined : unbalancedNote(transaction, split);

  return (
    <span className={clsx(styles["tag"], !split.balanced && styles["unbalanced"])} title={warning}>
      {split.balanced ? <Split size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
      <span>{label}</span>
      {warning && <span className={ui["visually-hidden"]}>{` ${warning}`}</span>}
    </span>
  );
}

function statusText(state: DraftState, currency: string, restCategory: string | null) {
  const remaining = money(Math.abs(state.remaining), currency);

  switch (state.status) {
    case "invalid":
      return "Check the highlighted amount.";
    case "incomplete":
      return "Enter an amount for every part.";
    case "over":
      return `${remaining} more than the total`;
    case "single":
      return "Lower an amount to split off the rest.";
    default:
      // The rest part covers whatever the entered parts leave, so the booking is fully assigned either way.
      return state.remaining > 0 && restCategory === null ? "Fully assigned · choose a category for the rest" : "Fully assigned";
  }
}

/**
 * Edits a booking's split inside the transaction dialog. The entered parts are amounts in the booking's direction; whatever they leave of the total is proposed as a remaining part whose amount follows them, so only its category is chosen.
 * The summary compares the assigned amount with the total and carries every validation message.
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
  const statusId = useId();
  const total = Math.abs(transaction.amount_minor);
  // The rest part counts as assigned while it covers the gap.
  const assigned = state.assigned + Math.max(state.remaining, 0);
  const fill = total === 0 ? 0 : Math.min(100, Math.max(0, assigned / total * 100));
  const problem = state.status === "invalid" || state.status === "incomplete" || state.status === "over";

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
    <section className={styles["section"]} aria-label="Split">
      <div className={styles["section-head"]}>
        <h3 className={styles["section-title"]}>
          <Split size={15} aria-hidden="true" />
          Split
        </h3>
        <button
          type="button"
          className={clsx(ui["text-button"], styles["close"])}
          disabled={disabled}
          onClick={onClose}
        >
          <X size={14} aria-hidden="true" />
          {transaction.split ? "Remove split" : "Cancel split"}
        </button>
      </div>
      <div className={styles["meter-row"]}>
        <div className={styles["meter-text"]}>
          <span>
            Assigned <strong>{money(assigned, transaction.currency)}</strong> of {money(total, transaction.currency)}
          </span>
          <span id={statusId} className={clsx(styles["status"], problem && styles["problem"])} role="status">
            {problem && <CircleAlert size={14} aria-hidden="true" />}
            {statusText(state, transaction.currency, draft.remainder.categoryId)}
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
            categories={categories}
            categoryId={part.categoryId}
            note={part.note}
            statusId={statusId}
            amount={(
              <input
                className={styles["amount"]}
                aria-label={`Amount of part ${index + 1}`}
                autoFocus={focusFirst && index === 0}
                inputMode="decimal"
                placeholder="0.00"
                value={part.amount}
                aria-invalid={state.amounts[index] === null && part.amount.trim() !== "" || undefined}
                aria-describedby={statusId}
                onChange={event => update(part.key, {
                  amount: event.target.value
                })}
              />
            )}
            onCategory={categoryId => update(part.key, {
              categoryId
            })}
            onNote={note => update(part.key, {
              note
            })}
            onRemove={draft.parts.length > 1 ? () => onDraft({
              ...draft,
              parts: draft.parts.filter(item => item.key !== part.key)
            }) : undefined}
          />
        ))}
        {state.remaining > 0 && (
          <SplitPartFields
            position={draft.parts.length + 1}
            categories={categories}
            categoryId={draft.remainder.categoryId}
            note={draft.remainder.note}
            statusId={statusId}
            amount={(
              <span className={styles["rest"]}>
                <span className={styles["rest-label"]}>Rest</span>
                {money(state.remaining, transaction.currency)}
              </span>
            )}
            onCategory={categoryId => onDraft({
              ...draft,
              remainder: {
                ...draft.remainder,
                categoryId
              }
            })}
            onNote={note => onDraft({
              ...draft,
              remainder: {
                ...draft.remainder,
                note
              }
            })}
          />
        )}
      </ol>
      <button
        type="button"
        className={ui["text-button"]}
        disabled={disabled || !state.canAdd}
        onClick={() => onDraft({
          ...draft,
          parts: [...draft.parts, {
            key: draft.nextKey,
            amount: "",
            categoryId: null,
            note: ""
          }],
          nextKey: draft.nextKey + 1
        })}
      >
        <Plus size={14} aria-hidden="true" />
        Add part
      </button>
    </section>
  );
}

function SplitPartFields({
  position,
  amount,
  categories,
  categoryId,
  note,
  statusId,
  onCategory,
  onNote,
  onRemove
}: {
  position: number;
  amount: ReactNode;
  categories: Category[];
  categoryId: string | null;
  note: string;
  statusId: string;
  onCategory: (categoryId: string | null) => void;
  onNote: (note: string) => void;
  onRemove?: () => void;
}) {
  const fieldId = useId();

  return (
    <li className={styles["part"]}>
      {amount}
      <div className={styles["category"]}>
        <label htmlFor={`${fieldId}-category`} className={ui["visually-hidden"]}>{`Category of part ${position}`}</label>
        <CategoryPicker
          id={`${fieldId}-category`}
          categories={categories}
          value={categoryId}
          includeUncategorized
          onChange={onCategory}
        />
      </div>
      <input
        className={styles["note"]}
        aria-label={`Note of part ${position}`}
        aria-describedby={statusId}
        maxLength={200}
        placeholder="Note"
        value={note}
        onChange={event => onNote(event.target.value)}
      />
      {onRemove ? (
        <button
          type="button"
          className={styles["remove"]}
          aria-label={`Remove part ${position}`}
          onClick={onRemove}
        >
          <X size={16} />
        </button>
      ) : <span className={styles["remove-placeholder"]} />}
    </li>
  );
}

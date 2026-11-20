"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId, useState } from "react";
import { clsx } from "clsx";
import { Check, CircleAlert, Plus, Split, X } from "lucide-react";
import styles from "./transaction-split.module.css";
import { toFailure } from "@/client/api";
import { FormError } from "@/components/ui/form-error";
import { CategoryPicker } from "@/features/categorization/components/category-picker";
import { useCategories } from "@/features/categorization/queries";
import type { Category } from "@/features/categorization/types";
import { decimalAmount, minorUnits, money } from "@/lib/money";
import { useRemoveSplit, useSaveSplit, type SplitPartEdit } from "@/features/transactions/mutations";
import type { Transaction, TransactionSplit } from "@/features/transactions/types";

/** Whether a booking of this type can be split; only income and expenses count by category. */
export function splittable(transaction: Transaction) {
  return transaction.type === "income" || transaction.type === "expense";
}

function categoryName(categories: readonly Category[], categoryId: string | null) {
  return categories.find(category => category.id === categoryId)?.name ?? "Uncategorized";
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

/** A split booking's parts in the edit dialog, in place of its category. */
export function SplitSummary({
  transaction,
  split,
  onEdit
}: {
  transaction: Transaction;
  split: TransactionSplit;
  onEdit: () => void;
}) {
  const categories = useCategories();
  const list = categories.data ?? [];

  return (
    <div className={styles["summary"]}>
      <p className={styles["summary-title"]}>{splitLabel(split)}</p>
      <ul className={styles["parts"]}>
        {split.parts.map(part => (
          <li key={part.id} className={styles["part-line"]}>
            <span className={styles["part-name"]}>
              {categoryName(list, part.category_id)}
              {part.note && <span className={styles["part-note"]}>{part.note}</span>}
            </span>
            <span className={styles["part-amount"]}>{money(part.amount_minor, transaction.currency)}</span>
          </li>
        ))}
      </ul>
      {!split.balanced && (
        <p className={styles["warning"]} role="status">
          <CircleAlert size={16} aria-hidden="true" />
          {unbalancedNote(transaction, split)}
        </p>
      )}
      <button type="button" className={clsx(ui["button"], ui["full-width"])} onClick={onEdit}>
        <Split size={15} />
        Edit split
      </button>
    </div>
  );
}

type DraftPart = {
  key: number;
  amount: string;
  categoryId: string | null;
  note: string;
};

/** Part amounts are entered in the booking's direction: positive for an expense's spending or an income's receipt, negative for a part going the other way. */
function direction(transaction: Transaction) {
  return transaction.amount_minor < 0 ? -1 : 1;
}

function initialParts(transaction: Transaction): DraftPart[] {
  const sign = direction(transaction);

  if (transaction.split) {
    return transaction.split.parts.map((part, index) => ({
      key: index,
      amount: decimalAmount(part.amount_minor * sign, transaction.currency),
      categoryId: part.category_id,
      note: part.note
    }));
  }

  return [{
    key: 0,
    amount: decimalAmount(transaction.amount_minor * sign, transaction.currency),
    categoryId: transaction.category_id,
    note: ""
  }, {
    key: 1,
    amount: "",
    categoryId: null,
    note: ""
  }];
}

/** A part's signed minor units, or null while its amount is empty, invalid or zero. */
function partAmount(part: DraftPart, transaction: Transaction) {
  try {
    const amount = minorUnits(part.amount, transaction.currency) * direction(transaction);

    return amount === 0 ? null : amount;
  } catch {
    return null;
  }
}

function remainingStatus(remaining: number, currency: string) {
  if (remaining === 0) {
    return "Balanced";
  }

  const amount = money(Math.abs(remaining), currency);

  return remaining > 0 ? `${amount} left to assign` : `${amount} too much`;
}

/**
 * Divides a booking into at least two parts, each with an amount, a category and an optional note. The parts must add up exactly to the booking's amount; the remaining amount updates as amounts change and Save stays disabled until it is zero.
 */
export function SplitForm({
  transaction,
  close
}: {
  transaction: Transaction;
  close: () => void;
}) {
  const categories = useCategories();
  const save = useSaveSplit(transaction.id);
  const remove = useRemoveSplit(transaction.id);
  const statusId = useId();
  const [parts, setParts] = useState(() => initialParts(transaction));
  const [nextKey, setNextKey] = useState(parts.length);
  const sign = direction(transaction);
  const amounts = parts.map(part => partAmount(part, transaction));
  const complete = amounts.every(amount => amount !== null);
  // Remaining in the booking's direction, so a positive value is still to be assigned.
  const remaining = (transaction.amount_minor - amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0)) * sign;
  const pending = save.isPending || remove.isPending;
  const balanced = complete && remaining === 0 && parts.length >= 2;
  const error = save.error ?? remove.error;
  const failure = error ? toFailure(error) : null;

  function update(key: number, change: Partial<DraftPart>) {
    setParts(current => current.map(part => part.key === key ? {
      ...part,
      ...change
    } : part));
  }

  function addPart() {
    const amount = remaining > 0 ? decimalAmount(remaining, transaction.currency) : "";

    setParts(current => [...current, {
      key: nextKey,
      amount,
      categoryId: null,
      note: ""
    }]);
    setNextKey(nextKey + 1);
  }

  function submit() {
    const edits: SplitPartEdit[] = parts.map((part, index) => ({
      amount: decimalAmount(amounts[index] ?? 0, transaction.currency),
      category_id: part.categoryId,
      note: part.note
    }));

    save.mutate(edits, {
      onSuccess: close
    });
  }

  return (
    <form
      className={ui["form"]}
      onSubmit={event => {
        event.preventDefault();

        if (balanced) {
          submit();
        }
      }}
    >
      <p className={ui["form-hint"]}>Each part counts in reports with its own category. Enter amounts in the booking&apos;s direction; a negative part goes the other way.</p>
      <ol className={styles["editor"]}>
        {parts.map((part, index) => (
          <SplitPartFields
            key={part.key}
            index={index}
            part={part}
            invalid={part.amount.trim() !== "" && amounts[index] === null}
            categories={categories.data ?? []}
            removable={parts.length > 2}
            statusId={statusId}
            onChange={change => update(part.key, change)}
            onRemove={() => setParts(current => current.filter(item => item.key !== part.key))}
          />
        ))}
      </ol>
      <button
        type="button"
        className={clsx(ui["button"], ui["full-width"])}
        disabled={pending}
        onClick={addPart}
      >
        <Plus size={15} />
        Add part
      </button>
      <p id={statusId} className={clsx(styles["remaining"], remaining === 0 && complete && styles["balanced"])} role="status">
        {complete ? remainingStatus(remaining, transaction.currency) : "Enter an amount for every part."}
      </p>
      <FormError failure={failure} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || !balanced}>
        Save split <Check size={16} />
      </button>
      {transaction.split && (
        <button
          type="button"
          className={clsx(ui["button"], ui["full-width"])}
          disabled={pending}
          onClick={() => remove.mutate(undefined, {
            onSuccess: close
          })}
        >
          <X size={15} />
          Remove split
        </button>
      )}
      {transaction.split && <p className={ui["form-hint"]}>Removing the split returns the transaction to automatic categorization.</p>}
    </form>
  );
}

function SplitPartFields({
  index,
  part,
  invalid,
  categories,
  removable,
  statusId,
  onChange,
  onRemove
}: {
  index: number;
  part: DraftPart;
  invalid: boolean;
  categories: Category[];
  removable: boolean;
  statusId: string;
  onChange: (change: Partial<DraftPart>) => void;
  onRemove: () => void;
}) {
  const categoryId = useId();
  const position = index + 1;

  return (
    <li className={styles["part"]}>
      <div className={styles["part-header"]}>
        <span className={styles["part-number"]}>Part {position}</span>
        <button
          type="button"
          className={styles["remove"]}
          disabled={!removable}
          aria-label={`Remove part ${position}`}
          onClick={onRemove}
        >
          <X size={16} />
        </button>
      </div>
      <div className={styles["part-fields"]}>
        <label>
          Amount
          <input
            required
            inputMode="decimal"
            pattern="[+\-]?[0-9]+([.][0-9]+)?"
            placeholder="0.00"
            value={part.amount}
            aria-invalid={invalid || undefined}
            aria-describedby={statusId}
            onChange={event => onChange({
              amount: event.target.value
            })}
          />
        </label>
        <div className={ui["field"]}>
          <label htmlFor={categoryId}>Category</label>
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
      </div>
      <label>
        Note
        <input
          maxLength={200}
          placeholder="Optional"
          value={part.note}
          onChange={event => onChange({
            note: event.target.value
          })}
        />
      </label>
    </li>
  );
}

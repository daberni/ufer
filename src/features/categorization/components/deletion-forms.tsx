"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { Trash2 } from "lucide-react";
import { useId, useState } from "react";
import styles from "./deletion-forms.module.css";
import { toFailure } from "@/client/api";
import { FormError } from "@/components/ui/form-error";
import { InlineFailure } from "@/components/ui/area-placeholder";
import { useAreaResult } from "@/components/ui/use-area-result";
import { useDeleteCategory, useDeleteRule } from "@/features/categorization/mutations";
import { useCategories, useCategoryUsage } from "@/features/categorization/queries";
import type { Category, CategoryUsage, Rule } from "@/features/categorization/types";
import { CategoryPicker } from "./category-picker";
import { formatCount } from "@/lib/locale";
import { useLocale } from "@/client/locale-provider";

/** Opens the deletion step of an edit dialog. */
export function DeleteButton({
  label,
  disabled,
  onClick
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx(ui["button"], ui["full-width"], styles["delete"])}
      disabled={disabled}
      onClick={onClick}
    >
      <Trash2 size={15} />
      {label}
    </button>
  );
}

function ConfirmActions({
  pending,
  disabled = false,
  cancel,
  label
}: {
  pending: boolean;
  disabled?: boolean;
  cancel: () => void;
  label: string;
}) {
  return (
    <div className={ui["form-actions"]}>
      <button
        type="button"
        className={ui["button"]}
        disabled={pending}
        onClick={cancel}
      >
        Cancel
      </button>
      <button className={styles["danger"]} disabled={pending || disabled}>
        <Trash2 size={15} />
        {label}
      </button>
    </div>
  );
}

export function RuleDeleteConfirmation({
  rule,
  close,
  cancel
}: {
  rule: Rule;
  close: () => void;
  cancel: () => void;
}) {
  const remove = useDeleteRule(rule);

  return (
    <form
      className={ui["form"]}
      onSubmit={event => {
        event.preventDefault();
        remove.mutate(undefined, {
          onSuccess: close
        });
      }}
    >
      <p className={ui["form-description"]}>“{rule.name}” · {rule.pattern}</p>
      <ul className={styles["effects"]}>
        <li>New and re-applied transactions no longer match this rule; the next matching rule decides instead.</li>
        <li>Transactions it already categorized keep their category until you apply the rules.</li>
        <li>Manual assignments are never changed.</li>
      </ul>
      <FormError failure={remove.error ? toFailure(remove.error) : null} />
      <ConfirmActions pending={remove.isPending} cancel={cancel} label="Delete rule" />
    </form>
  );
}

function count(value: number, singular: string, plural: string, locale: string) {
  return `${formatCount(value, locale)} ${value === 1 ? singular : plural}`;
}

type Outcome = "reassign" | "uncategorize";

export function CategoryDeleteForm({
  category,
  close,
  cancel
}: {
  category: Category;
  close: () => void;
  cancel: () => void;
}) {
  const usage = useAreaResult(useCategoryUsage(category.id));
  const categories = useCategories();
  const remove = useDeleteCategory(category);
  const [outcome, setOutcome] = useState<Outcome>("reassign");
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const replacementFieldId = useId();
  const others = (categories.data ?? []).filter(other => other.id !== category.id);
  const replacementMissing = outcome === "reassign" && replacementId === null;

  return (
    <form
      className={ui["form"]}
      onSubmit={event => {
        event.preventDefault();

        if (replacementMissing) {
          return;
        }

        remove.mutate(outcome === "reassign" ? replacementId : null, {
          onSuccess: close
        });
      }}
    >
      <p className={ui["form-description"]}>{category.name}</p>
      {usage.status === "pending" && usage.failure ? (
        <InlineFailure failure={usage.failure} subject="What uses this category" />
      ) : (
        <UsageSummary usage={usage.data ?? null} />
      )}
      <fieldset className={styles["outcomes"]}>
        <legend>Its transactions and rules</legend>
        <label className={styles["outcome"]}>
          <input
            type="radio"
            name="outcome"
            value="reassign"
            checked={outcome === "reassign"}
            onChange={() => setOutcome("reassign")}
          />
          <span>
            Move to another category
            <small>Transactions and rules use the chosen category instead; reports count them there.</small>
          </span>
        </label>
        {outcome === "reassign" && (
          <div className={clsx(ui["field"], styles["replacement"])}>
            <label htmlFor={replacementFieldId}>Move to</label>
            <CategoryPicker
              id={replacementFieldId}
              categories={others}
              value={replacementId}
              onChange={setReplacementId}
            />
          </div>
        )}
        <label className={styles["outcome"]}>
          <input
            type="radio"
            name="outcome"
            value="uncategorize"
            checked={outcome === "uncategorize"}
            onChange={() => setOutcome("uncategorize")}
          />
          <span>
            Leave uncategorized
            <small>Transactions become uncategorized and reports show them as Uncategorized. Its rules are deleted, since a rule needs a category.</small>
          </span>
        </label>
      </fieldset>
      <p className={ui["form-hint"]}>Manual assignments stay manual, so applying rules later does not change them. This cannot be undone.</p>
      <FormError failure={remove.error ? toFailure(remove.error) : null} />
      <ConfirmActions
        pending={remove.isPending}
        disabled={replacementMissing || usage.status === "pending"}
        cancel={cancel}
        label="Delete category"
      />
    </form>
  );
}

function UsageSummary({
  usage
}: {
  usage: CategoryUsage | null;
}) {
  const locale = useLocale();

  if (!usage) {
    return (
      <p className={styles["usage"]}>
        <span className={ui["skeleton"]} aria-hidden="true">Used by 0 transactions and 0 rules</span>
        <span className={ui["visually-hidden"]}>Counting what uses this category …</span>
      </p>
    );
  }

  const manual = usage.manual_transactions > 0 ? ` (${count(usage.manual_transactions, "manual assignment", "manual assignments", locale)})` : "";

  return (
    <p className={styles["usage"]}>
      Used by <strong>{count(usage.transactions, "transaction", "transactions", locale)}</strong>{manual} and <strong>{count(usage.rules, "rule", "rules", locale)}</strong>.
    </p>
  );
}

"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { Trash2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import styles from "./deletion-forms.module.css";
import { toFailure } from "@/client/api";
import { FormError } from "@/components/ui/form-error";
import { InlineFailure } from "@/components/ui/area-placeholder";
import { useAreaResult } from "@/components/ui/use-area-result";
import { useDeleteCategory, useDeleteRule } from "@/features/categorization/mutations";
import { useCategories, useCategoryUsage } from "@/features/categorization/queries";
import type { Category, CategoryUsage, Rule } from "@/features/categorization/types";
import { CategoryPicker } from "./category-picker";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("categorization.deletion");

  return (
    <div className={ui["form-actions"]}>
      <button
        type="button"
        className={ui["button"]}
        disabled={pending}
        onClick={cancel}
      >
        {t("cancel")}
      </button>
      <button className={ui["danger-button"]} disabled={pending || disabled}>
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
  const t = useTranslations("categorization.deletion");
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
        <li>{t("ruleEffects.matching")}</li>
        <li>{t("ruleEffects.categorized")}</li>
        <li>{t("ruleEffects.manual")}</li>
      </ul>
      <FormError failure={remove.error ? toFailure(remove.error) : null} />
      <ConfirmActions pending={remove.isPending} cancel={cancel} label={t("deleteRule")} />
    </form>
  );
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
  const t = useTranslations("categorization.deletion");
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
        <InlineFailure failure={usage.failure} failureTitle={t("usageFailed")} />
      ) : (
        <UsageSummary usage={usage.data ?? null} />
      )}
      <fieldset className={styles["outcomes"]}>
        <legend>{t("outcomesLegend")}</legend>
        <label className={styles["outcome"]}>
          <input
            type="radio"
            name="outcome"
            value="reassign"
            checked={outcome === "reassign"}
            onChange={() => setOutcome("reassign")}
          />
          <span>
            {t("reassign")}
            <small>{t("reassignHint")}</small>
          </span>
        </label>
        {outcome === "reassign" && (
          <div className={clsx(ui["field"], styles["replacement"])}>
            <label htmlFor={replacementFieldId}>{t("moveTo")}</label>
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
            {t("uncategorize")}
            <small>{t("uncategorizeHint")}</small>
          </span>
        </label>
      </fieldset>
      <p className={ui["form-hint"]}>{t("categoryNote")}</p>
      <FormError failure={remove.error ? toFailure(remove.error) : null} />
      <ConfirmActions
        pending={remove.isPending}
        disabled={replacementMissing || usage.status === "pending"}
        cancel={cancel}
        label={t("deleteCategory")}
      />
    </form>
  );
}

function UsageSummary({
  usage
}: {
  usage: CategoryUsage | null;
}) {
  const t = useTranslations("categorization.deletion");

  if (!usage) {
    return (
      <p className={styles["usage"]}>
        <span className={ui["skeleton"]} aria-hidden="true">{t("usagePlaceholder")}</span>
        <span className={ui["visually-hidden"]}>{t("countingUsage")}</span>
      </p>
    );
  }

  const values = {
    transactions: usage.transactions,
    manual: usage.manual_transactions,
    rules: usage.rules,
    strong: (chunks: ReactNode) => <strong>{chunks}</strong>
  };

  return (
    <p className={styles["usage"]}>
      {usage.manual_transactions > 0 ? t.rich("usageWithManual", values) : t.rich("usage", values)}
    </p>
  );
}

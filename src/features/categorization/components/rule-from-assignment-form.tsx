"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./rule-from-assignment-form.module.css";
import { useId, useState } from "react";
import { Sparkles } from "lucide-react";
import { toFailure } from "@/client/api";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { useCreateRuleFromAssignment } from "@/features/categorization/mutations";
import { useCategories } from "@/features/categorization/queries";
import { useRulePreviewDraft } from "@/features/categorization/use-rule-preview-draft";
import { proposeRulePattern } from "@/features/categorization/rule-pattern";
import { CategoryPicker } from "./category-picker";
import { ManualAdoptionOption, useManualAdoption } from "./manual-adoption-option";
import { useTranslations } from "next-intl";

type Props = {
  /** The transaction whose category was chosen manually; the proposed pattern comes from it, and it becomes rule-assigned when the new rule decides its category. */
  transactionId: string;
  counterparty: string;
  description: string;
  categoryId: string;
  close: () => void;
  /** Called after the rule is stored, with the number of uncategorized transactions it categorized. */
  onCreated: (categorized: number) => void;
};

export function RuleFromAssignmentDialog(props: Props) {
  const t = useTranslations("categorization.ruleForm");

  return (
    <Dialog eyebrow={t("eyebrow")} title={t("createTitle")} onClose={props.close}>
      <RuleFromAssignmentForm {...props} />
    </Dialog>
  );
}

function RuleFromAssignmentForm({
  transactionId,
  counterparty,
  description,
  categoryId: assignedCategoryId,
  close,
  onCreated
}: Props) {
  const t = useTranslations("categorization.fromAssignment");
  const categories = useCategories();
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useCreateRuleFromAssignment(), close);
  const patternFieldId = useId();
  const patternHintId = useId();
  const categoryFieldId = useId();
  const [pattern, setPattern] = useState(() => proposeRulePattern(counterparty, description));
  const [categoryId, setCategoryId] = useState(assignedCategoryId);
  const [applyToUncategorized, setApplyToUncategorized] = useState(true);
  const {
    draft,
    preview,
    current: matchesCurrentDraft
  } = useRulePreviewDraft({
    pattern: pattern.trim(),
    mode: "keyword",
    accountId: null,
    ruleId: null,
    categoryId,
    sourceTransactionId: transactionId
  });
  const previewReady = matchesCurrentDraft && preview.isSuccess && !preview.isFetching && !preview.isPlaceholderData;
  const previewPending = draft !== null && (!matchesCurrentDraft || preview.isFetching);
  const adoption = useManualAdoption(previewReady && preview.data ? {
    count: preview.data.manual,
    sameCategory: preview.data.manual_same_category
  } : null);

  let previewText = t("enterPattern");

  if (matchesCurrentDraft && preview.isError) {
    previewText = t("unavailable", {
      message: toFailure(preview.error).message
    });
  } else if (previewPending) {
    previewText = t("counting");
  } else if (previewReady && preview.data?.matched === 0) {
    previewText = t("none");
  } else if (previewReady && preview.data) {
    previewText = t("matches", {
      matched: preview.data.matched,
      uncategorized: preview.data.uncategorized
    });
  }

  return (
    <form
      onSubmit={event => {
        const previewId = preview.data?.id;

        if (!previewReady || !previewId) {
          event.preventDefault();

          return;
        }

        submit(event, () => {
          const keyword = pattern.trim();

          return {
            id: previewId,
            name: keyword.slice(0, 100),
            pattern: keyword,
            mode: "keyword",
            category_id: categoryId,
            apply_to_uncategorized: applyToUncategorized,
            adopt_manual: adoption.checked,
            source_transaction_id: transactionId
          };
        }, created => onCreated(created.categorized));
      }}
      className={ui["form"]}
    >
      <p className={ui["form-description"]}>{t("description", {
        example: counterparty || description
      })}</p>
      <div className={ui["field"]}>
        <label htmlFor={patternFieldId}>{t("pattern")}</label>
        <input
          id={patternFieldId}
          name="pattern"
          required
          maxLength={500}
          value={pattern}
          aria-describedby={patternHintId}
          onChange={event => setPattern(event.target.value)}
        />
        <span id={patternHintId} className={styles["hint"]}>{t("patternHint")}</span>
      </div>
      <div className={ui["field"]}>
        <label htmlFor={categoryFieldId}>{t("category")}</label>
        <CategoryPicker
          id={categoryFieldId}
          categories={categories.data ?? []}
          value={categoryId}
          onChange={next => setCategoryId(next ?? assignedCategoryId)}
        />
      </div>
      <p className={clsx(ui["form-hint"], styles["preview"])} role="status" aria-busy={previewPending}>{previewText}</p>
      <label className={ui["check-option"]}>
        <input
          type="checkbox"
          checked={applyToUncategorized}
          onChange={event => setApplyToUncategorized(event.target.checked)}
        />
        {t("applyNow")}
      </label>
      <ManualAdoptionOption adoption={adoption} />
      <p className={ui["form-hint"]}>{t("orderHint")}</p>
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || !categories.data || !previewReady || !preview.data?.id}>
        {t("create")} <Sparkles size={16} />
      </button>
    </form>
  );
}

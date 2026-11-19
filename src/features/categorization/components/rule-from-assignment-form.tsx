"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./rule-from-assignment-form.module.css";
import { useEffect, useId, useState } from "react";
import { Sparkles } from "lucide-react";
import { toFailure } from "@/client/api";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { useCreateRuleFromAssignment } from "@/features/categorization/mutations";
import { useCategories, useRulePreview } from "@/features/categorization/queries";
import { proposeRulePattern } from "@/features/categorization/rule-pattern";
import type { RulePreviewDraft } from "@/features/categorization/types";
import { CategoryPicker } from "./category-picker";

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

// Counting waits for typing to pause.
const previewDelay = 300;

export function RuleFromAssignmentDialog(props: Props) {
  return (
    <Dialog eyebrow="YOUR FINANCES" title="Create rule" onClose={props.close}>
      <RuleFromAssignmentForm {...props} />
    </Dialog>
  );
}

function previewDraft(pattern: string): RulePreviewDraft | null {
  const trimmed = pattern.trim();

  if (!trimmed) {
    return null;
  }

  return {
    pattern: trimmed,
    mode: "keyword",
    ruleId: null
  };
}

function transactionCount(count: number) {
  return count === 1 ? "1 other transaction" : `${count.toLocaleString("en")} other transactions`;
}

function RuleFromAssignmentForm({
  transactionId,
  counterparty,
  description,
  categoryId: assignedCategoryId,
  close,
  onCreated
}: Props) {
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
  const [previewed, setPreviewed] = useState(() => previewDraft(pattern));

  useEffect(() => {
    const timer = setTimeout(() => setPreviewed(previewDraft(pattern)), previewDelay);

    return () => clearTimeout(timer);
  }, [pattern]);

  const draft = previewDraft(pattern);
  const preview = useRulePreview(previewed);
  const matchesCurrentDraft = draft !== null && draft.pattern === previewed?.pattern;
  const previewReady = matchesCurrentDraft && preview.isSuccess && !preview.isFetching && !preview.isPlaceholderData;
  const previewPending = draft !== null && (!matchesCurrentDraft || preview.isFetching);

  let previewText = "Enter a pattern to see what the rule would categorize.";

  if (matchesCurrentDraft && preview.isError) {
    previewText = `The preview is unavailable: ${toFailure(preview.error).message}`;
  } else if (previewPending) {
    previewText = "Counting matching transactions …";
  } else if (previewReady && preview.data?.matched === 0) {
    previewText = "Would not categorize any other transactions yet.";
  } else if (previewReady && preview.data) {
    previewText = `Would categorize ${transactionCount(preview.data.matched)}; ${preview.data.uncategorized.toLocaleString("en")} of them ${preview.data.uncategorized === 1 ? "is" : "are"} uncategorized.`;
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
            source_transaction_id: transactionId
          };
        }, created => onCreated(created.categorized));
      }}
      className={ui["form"]}
    >
      <p className={ui["form-description"]}>Categorize transactions like “{counterparty || description}” automatically. The first matching rule wins. This transaction follows the rule when the rule decides its category; other manual assignments are never changed.</p>
      <div className={ui["field"]}>
        <label htmlFor={patternFieldId}>Matching pattern</label>
        <input
          id={patternFieldId}
          name="pattern"
          required
          maxLength={500}
          value={pattern}
          aria-describedby={patternHintId}
          onChange={event => setPattern(event.target.value)}
        />
        <span id={patternHintId} className={styles["hint"]}>Contained in the payee or description, without case sensitivity.</span>
      </div>
      <div className={ui["field"]}>
        <label htmlFor={categoryFieldId}>Category</label>
        <CategoryPicker
          id={categoryFieldId}
          categories={categories.data ?? []}
          value={categoryId}
          onChange={next => setCategoryId(next ?? assignedCategoryId)}
        />
      </div>
      <p className={clsx(ui["form-hint"], styles["preview"])} role="status" aria-busy={previewPending}>{previewText}</p>
      <label className={styles["apply"]}>
        <input
          type="checkbox"
          checked={applyToUncategorized}
          onChange={event => setApplyToUncategorized(event.target.checked)}
        />
        Categorize the uncategorized matches now
      </label>
      <p className={ui["form-hint"]}>The rule is added at the end of your rules; reorder it in the rule list. Other matches follow the rule when rules are applied.</p>
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || !categories.data || !previewReady || !preview.data?.id}>
        Create rule <Sparkles size={16} />
      </button>
    </form>
  );
}

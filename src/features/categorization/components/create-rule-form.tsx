"use client";

import ui from "../../../components/ui/primitives.module.css";
import { useFormatLocale } from "@/client/format-locale-provider";

import { clsx } from "clsx";
import { useEffect, useId, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { useDialogSubmit, type DialogFormProps } from "@/components/ui/use-dialog-submit";
import { useSaveRule } from "@/features/categorization/mutations";
import { useCategories, useRulePreview } from "@/features/categorization/queries";
import { toFailure } from "@/client/api";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { CategoryPicker } from "./category-picker";
import { CategoryDialog } from "./category-form";
import { Dialog } from "@/components/ui/dialog";
import type { Rule, RulePreviewDraft } from "@/features/categorization/types";
import { DeleteButton, RuleDeleteConfirmation } from "./deletion-forms";
import { ManualAdoptionOption, useManualAdoption, type ManualMatches } from "./manual-adoption-option";
import { formatCount } from "@/lib/locale";

type RuleFormProps = DialogFormProps & {
  rule?: Rule | null;
};

export function RuleDialog({
  close,
  rule
}: RuleFormProps) {
  const [deleting, setDeleting] = useState(false);
  let title = rule ? "Edit rule" : "Create rule";

  if (rule && deleting) {
    title = "Delete rule";
  }

  return (
    <Dialog eyebrow="YOUR FINANCES" title={title} onClose={close}>
      {rule && deleting ? <RuleDeleteConfirmation rule={rule} close={close} cancel={() => setDeleting(false)} /> : <RuleForm close={close} rule={rule} onDelete={() => setDeleting(true)} />}
    </Dialog>
  );
}

// Counting waits for typing to pause.
const previewDelay = 300;

type Mode = RulePreviewDraft["mode"];

function previewDraft(pattern: string, mode: Mode, ruleId: string | null, categoryId: string | null): RulePreviewDraft | null {
  if (!pattern.trim()) {
    return null;
  }

  return {
    pattern,
    mode,
    ruleId,
    categoryId
  };
}

function sameDraft(first: RulePreviewDraft | null, second: RulePreviewDraft | null) {
  return first !== null && second !== null && first.pattern === second.pattern && first.mode === second.mode && first.ruleId === second.ruleId && first.categoryId === second.categoryId;
}

function transactionCount(count: number, locale: string) {
  return count === 1 ? "1 transaction" : `${formatCount(count, locale)} transactions`;
}

/** What the drafted rule would decide when rules are applied; nothing changes before that. The draft must keep its identity while its fields are unchanged. */
function useRuleImpact(draft: RulePreviewDraft | null) {
  const locale = useFormatLocale();
  const [previewed, setPreviewed] = useState(draft);

  useEffect(() => {
    const timer = setTimeout(() => setPreviewed(draft), previewDelay);

    return () => clearTimeout(timer);
  }, [draft]);

  const preview = useRulePreview(previewed);
  const current = sameDraft(draft, previewed);
  const pending = draft !== null && (!current || preview.isFetching);

  if (draft === null) {
    return {
      pending: false,
      previewId: null,
      manual: null,
      text: "Enter a pattern to see which transactions the rule would decide."
    };
  }

  if (current && preview.isError) {
    return {
      pending: false,
      previewId: null,
      manual: null,
      text: `The preview is unavailable: ${toFailure(preview.error).message}`
    };
  }

  if (pending || !preview.data || preview.isPlaceholderData) {
    return {
      pending: true,
      previewId: null,
      manual: null,
      text: "Counting matching transactions …"
    };
  }

  // The counted ID breaks equal-priority ties, so a new rule is stored with exactly this ID.
  const previewId = preview.data.id;
  const manual: ManualMatches = {
    count: preview.data.manual,
    sameCategory: preview.data.manual_same_category
  };

  if (!preview.data.enabled) {
    return {
      pending: false,
      previewId,
      manual,
      text: "This rule is disabled, so it decides no transactions until you enable it in the list."
    };
  }

  if (preview.data.matched === 0) {
    return {
      pending: false,
      previewId,
      manual,
      text: "Would not decide any transactions yet."
    };
  }

  return {
    pending: false,
    previewId,
    manual,
    text: `Would decide ${transactionCount(preview.data.matched, locale)} without a manual category when rules are applied; ${formatCount(preview.data.uncategorized, locale)} of them ${preview.data.uncategorized === 1 ? "is" : "are"} uncategorized now.`
  };
}

function RuleForm({
  close,
  rule,
  onDelete
}: RuleFormProps & {
  onDelete: () => void;
}) {
  const categories = useCategories();
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useSaveRule(rule), close);
  const categoryFieldId = useId();
  const [chosenCategoryId, setChosenCategoryId] = useState<string | null>(rule?.category_id ?? null);
  const categoryId = chosenCategoryId ?? categories.data?.[0]?.id ?? null;
  const categorySelected = categoryId !== null && Boolean(categories.data?.some(category => category.id === categoryId));
  const noCategories = categories.data?.length === 0;
  const [addingCategory, setAddingCategory] = useState(false);
  const [pattern, setPattern] = useState(rule?.pattern ?? "");
  const [mode, setMode] = useState<Mode>(rule?.mode === "regex" ? "regex" : "keyword");
  const ruleId = rule?.id ?? null;
  const draft = useMemo(() => previewDraft(pattern, mode, ruleId, categoryId), [pattern, mode, ruleId, categoryId]);
  const impact = useRuleImpact(draft);
  const adoption = useManualAdoption(impact.manual);

  return (
    <form
      onSubmit={event => {
        const previewId = impact.previewId;

        if ((!rule && !previewId) || !categorySelected) {
          event.preventDefault();

          return;
        }

        submit(event, data => ({
          ...Object.fromEntries(data),
          adopt_manual: adoption.checked,
          ...(rule ? {} : {
            id: previewId
          })
        }));
      }}
      className={ui["form"]}
    >
      <label>
        Rule name
        <input
          name="name"
          defaultValue={rule?.name}
          required
          placeholder="e.g. Groceries"
          maxLength={100}
        />
      </label>
      <div className={ui["form-grid"]}>
        <label>
          Match type
          <Select name="mode" value={mode} onChange={event => setMode(event.target.value === "regex" ? "regex" : "keyword")}>
            <option value="keyword">Contains keyword</option>
            <option value="regex">Regular expression (RE2)</option>
          </Select>
        </label>
        <label>
          Matching pattern
          <input
            name="pattern"
            value={pattern}
            onChange={event => setPattern(event.target.value)}
            required
            placeholder="e.g. MARKET"
            maxLength={500}
          />
        </label>
      </div>
      <div className={ui["field"]}>
        <label htmlFor={categoryFieldId}>Category</label>
        <CategoryPicker
          id={categoryFieldId}
          name="category_id"
          categories={categories.data ?? []}
          value={categoryId}
          onChange={setChosenCategoryId}
        />
        {noCategories && (
          <p className={ui["form-hint"]}>
            A rule needs a category, and none exist yet.{" "}
            <button className={ui["text-button"]} type="button" onClick={() => setAddingCategory(true)}>Add a category</button>
          </p>
        )}
      </div>
      {addingCategory && <CategoryDialog close={() => setAddingCategory(false)} onSaved={setChosenCategoryId} />}
      <p className={ui["form-hint"]}>Matches the payee and description without case sensitivity. The first matching rule in the list wins; new rules are added at the end.</p>
      <p className={ui["form-hint"]} role="status" aria-busy={impact.pending}>{impact.text}</p>
      <ManualAdoptionOption adoption={adoption} />
      <p className={ui["form-hint"]}>{adoption.checked ? "Saving also lets this rule decide the chosen manual assignments; other transactions stay unchanged until you apply the rules." : "Existing transactions stay unchanged until you apply the rules. Manual assignments are never changed."}</p>
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || !categorySelected || (!rule && !impact.previewId)}>
        {rule ? "Save changes" : "Create rule"} <Sparkles size={16} />
      </button>
      {rule && <DeleteButton label="Delete rule" disabled={pending} onClick={onDelete} />}
    </form>
  );
}

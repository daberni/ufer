"use client";

import ui from "../../../components/ui/primitives.module.css";

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
import { Dialog } from "@/components/ui/dialog";
import type { Rule, RulePreviewDraft } from "@/features/categorization/types";
import { DeleteButton, RuleDeleteConfirmation } from "./deletion-forms";

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

function previewDraft(pattern: string, mode: Mode, priority: string, ruleId: string | null): RulePreviewDraft | null {
  const order = Number(priority);

  if (!pattern.trim() || priority.trim() === "" || !Number.isInteger(order) || order < 0 || order > 10000) {
    return null;
  }

  return {
    pattern,
    mode,
    priority: order,
    ruleId
  };
}

function sameDraft(first: RulePreviewDraft | null, second: RulePreviewDraft | null) {
  return first !== null && second !== null && first.pattern === second.pattern && first.mode === second.mode && first.priority === second.priority && first.ruleId === second.ruleId;
}

function transactionCount(count: number) {
  return count === 1 ? "1 transaction" : `${count.toLocaleString("en")} transactions`;
}

/** What the drafted rule would decide when rules are applied; nothing changes before that. The draft must keep its identity while its fields are unchanged. */
function useRuleImpact(draft: RulePreviewDraft | null) {
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
      text: "Enter a pattern and a priority to see which transactions the rule would decide."
    };
  }

  if (current && preview.isError) {
    return {
      pending: false,
      text: `The preview is unavailable: ${toFailure(preview.error).message}`
    };
  }

  if (pending || !preview.data || preview.isPlaceholderData) {
    return {
      pending: true,
      text: "Counting matching transactions …"
    };
  }

  if (preview.data.matched === 0) {
    return {
      pending: false,
      text: "Would not decide any transactions yet."
    };
  }

  return {
    pending: false,
    text: `Would decide ${transactionCount(preview.data.matched)} without a manual category when rules are applied; ${preview.data.uncategorized.toLocaleString("en")} of them ${preview.data.uncategorized === 1 ? "is" : "are"} uncategorized now.`
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
  const [pattern, setPattern] = useState(rule?.pattern ?? "");
  const [mode, setMode] = useState<Mode>(rule?.mode === "regex" ? "regex" : "keyword");
  const [priority, setPriority] = useState(String(rule?.priority ?? 100));
  const ruleId = rule?.id ?? null;
  const draft = useMemo(() => previewDraft(pattern, mode, priority, ruleId), [pattern, mode, priority, ruleId]);
  const impact = useRuleImpact(draft);

  return (
    <form
      onSubmit={event => submit(event, data => ({
        ...Object.fromEntries(data),
        priority: Number(data.get("priority"))
      }))}
      className={ui["form"]}
    >
      <div className={ui["form-grid"]}>
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
        <label>
          Priority
          <input
            name="priority"
            type="number"
            min="0"
            max="10000"
            value={priority}
            onChange={event => setPriority(event.target.value)}
            required
          />
        </label>
      </div>
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
      </div>
      <p className={ui["form-hint"]}>Matches the payee and description without case sensitivity. Lower priority numbers match first; the first matching rule wins.</p>
      <p className={ui["form-hint"]} role="status" aria-busy={impact.pending}>{impact.text}</p>
      <p className={ui["form-hint"]}>Existing transactions stay unchanged until you apply the rules. Manual assignments are never changed.</p>
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || !categories.data}>
        {rule ? "Save changes" : "Create rule"} <Sparkles size={16} />
      </button>
      {rule && <DeleteButton label="Delete rule" disabled={pending} onClick={onDelete} />}
    </form>
  );
}

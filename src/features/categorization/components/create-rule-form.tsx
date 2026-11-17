"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useId, useState } from "react";
import { Sparkles } from "lucide-react";
import { useDialogSubmit, type DialogFormProps } from "@/components/ui/use-dialog-submit";
import { useSaveRule } from "@/features/categorization/mutations";
import { useCategories } from "@/features/categorization/queries";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { CategoryPicker } from "./category-picker";
import { Dialog } from "@/components/ui/dialog";
import type { Rule } from "@/features/categorization/types";

type RuleFormProps = DialogFormProps & {
  rule?: Rule | null;
};

export function RuleDialog({
  close,
  rule
}: RuleFormProps) {
  return (
    <Dialog eyebrow="YOUR FINANCES" title={rule ? "Edit rule" : "Create rule"} onClose={close}>
      <RuleForm close={close} rule={rule} />
    </Dialog>
  );
}

function RuleForm({
  close,
  rule
}: RuleFormProps) {
  const categories = useCategories();
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useSaveRule(rule), close);
  const categoryFieldId = useId();
  const [chosenCategoryId, setChosenCategoryId] = useState<string | null>(rule?.category_id ?? null);
  const categoryId = chosenCategoryId ?? categories.data?.[0]?.id ?? null;

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
            defaultValue={rule?.priority ?? 100}
            required
          />
        </label>
      </div>
      <div className={ui["form-grid"]}>
        <label>
          Match type
          <Select name="mode" defaultValue={rule?.mode ?? "keyword"}>
            <option value="keyword">Contains keyword</option>
            <option value="regex">Regular expression (RE2)</option>
          </Select>
        </label>
        <label>
          Matching pattern
          <input
            name="pattern"
            defaultValue={rule?.pattern}
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
      <p className={ui["form-hint"]}>Matches the payee and description without case sensitivity. The first matching rule wins.</p>
      {rule && <p className={ui["form-hint"]}>Existing transactions stay unchanged until you apply the rules.</p>}
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || !categories.data}>
        {rule ? "Save changes" : "Create rule"} <Sparkles size={16} />
      </button>
    </form>
  );
}

"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useId, useState } from "react";
import { Sparkles } from "lucide-react";
import { useDialogSubmit, type DialogFormProps } from "@/features/dashboard/use-dialog-submit";
import { useCreateRule } from "@/features/categorization/mutations";
import { useCategories } from "@/features/categorization/queries";
import { FormError } from "@/components/ui/form-error";
import { Select } from "@/components/ui/select";
import { CategoryPicker } from "./category-picker";
import { Dialog } from "@/components/ui/dialog";

export function CreateRuleDialog({ close }: DialogFormProps) {
  return (
    <Dialog eyebrow="YOUR FINANCES" title="Create rule" onClose={close}>
      <CreateRuleForm close={close} />
    </Dialog>
  );
}

function CreateRuleForm({ close }: DialogFormProps) {
  const categories = useCategories();
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useCreateRule(), close);
  const categoryFieldId = useId();
  const [chosenCategoryId, setChosenCategoryId] = useState<string | null>(null);
  const categoryId = chosenCategoryId ?? categories.data?.[0]?.id ?? null;

  return (
    <form
      onSubmit={event => submit(event, data => ({
        ...Object.fromEntries(data),
        priority: Number(data.get("priority"))
      }))}
      className={ui["form"]}
    >
      <label>
        Rule name
        <input
          name="name"
          required
          placeholder="e.g. Groceries"
          maxLength={100}
        />
      </label>
      <label>
        Matching pattern
        <input
          name="pattern"
          required
          placeholder="e.g. MARKET"
          maxLength={500}
        />
      </label>
      <div className={ui["form-grid"]}>
        <label>
          Match type
          <Select name="mode">
            <option value="keyword">Contains keyword</option>
            <option value="regex">Regular expression (RE2)</option>
          </Select>
        </label>
        <label>
          Priority
          <input
            name="priority"
            type="number"
            min="0"
            max="10000"
            defaultValue="100"
            required
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
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending || !categories.data}>
        Create rule <Sparkles size={16} />
      </button>
    </form>
  );
}

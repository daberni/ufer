"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useState } from "react";
import styles from "./category-form.module.css";
import { isCategoryIcon, type CategoryIconKey } from "@/features/categorization/category-icons";
import type { Category } from "@/features/dashboard/types";
import { useDialogSubmit, type DialogFormProps } from "@/features/dashboard/use-dialog-submit";
import { useSaveCategory } from "@/features/categorization/mutations";
import { FormError } from "@/components/ui/form-error";
import { CategoryChip } from "./category-chip";
import { CategoryIconPicker } from "./category-icon-picker";
import { Dialog } from "@/components/ui/dialog";

type Props = DialogFormProps & {
  category?: Category | null;
  /** Prefills the name of a new category. */
  initialName?: string;
  /** Receives the saved category's id after the dialog has closed. */
  onSaved?: (categoryId: string) => void;
};

const defaultColor = "#638777";

/** Adds a category, or edits the given one. */
export function CategoryDialog({
  category,
  close,
  initialName,
  onSaved
}: Props) {
  return (
    <Dialog eyebrow="YOUR FINANCES" title={category ? "Edit category" : "Add category"} onClose={close}>
      <CategoryForm
        category={category}
        close={close}
        initialName={initialName}
        onSaved={onSaved}
      />
    </Dialog>
  );
}

function CategoryForm({
  category,
  close,
  initialName = "",
  onSaved
}: Props) {
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useSaveCategory(category), close);
  const [name, setName] = useState(category?.name ?? initialName);
  const [color, setColor] = useState(category?.color ?? defaultColor);
  const savedIcon = category?.icon;
  const [icon, setIcon] = useState<CategoryIconKey | "">(isCategoryIcon(savedIcon) ? savedIcon : "");

  return (
    <form
      onSubmit={event => submit(event, data => Object.fromEntries(data), onSaved)}
      className={ui["form"]}
    >
      <div className={styles["preview"]} aria-hidden="true">
        <CategoryChip
          category={{
            name: name.trim() || "New category",
            color,
            icon: icon || null
          }}
          size="large"
        />
      </div>
      <label>
        Name
        <input
          name="name"
          required
          maxLength={100}
          value={name}
          onChange={event => setName(event.target.value)}
        />
      </label>
      <label>
        Color
        <span className={styles["color-field"]}>
          <input
            className={styles["color-input"]}
            name="color"
            type="color"
            required
            value={color}
            onChange={event => setColor(event.target.value)}
          />
          <code aria-hidden="true">{color}</code>
        </span>
      </label>
      <CategoryIconPicker color={color} icon={icon} onChange={setIcon} />
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
        Save category
      </button>
    </form>
  );
}

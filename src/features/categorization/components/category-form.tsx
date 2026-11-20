"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useState } from "react";
import styles from "./category-form.module.css";
import { defaultCategoryColor } from "@/features/categorization/category-colors";
import { isCategoryIcon, type CategoryIconKey } from "@/features/categorization/category-icons";
import type { Category } from "@/features/categorization/types";
import { useDialogSubmit, type DialogFormProps } from "@/components/ui/use-dialog-submit";
import { useSaveCategory } from "@/features/categorization/mutations";
import { FormError } from "@/components/ui/form-error";
import { CategoryLabel } from "./category-label";
import { CategoryColorField } from "./category-color-field";
import { CategoryIconField } from "./category-icon-field";
import { Dialog } from "@/components/ui/dialog";
import { CategoryDeleteForm, DeleteButton } from "./deletion-forms";

type Props = DialogFormProps & {
  category?: Category | null;
  /** Prefills the name of a new category. */
  initialName?: string;
  /** Receives the saved category's id after the dialog has closed. */
  onSaved?: (categoryId: string) => void;
};

type OpenPanel = "color" | "icon" | null;

/** Adds a category, or edits the given one. */
export function CategoryDialog({
  category,
  close,
  initialName,
  onSaved
}: Props) {
  const [deleting, setDeleting] = useState(false);
  let title = category ? "Edit category" : "Add category";

  if (category && deleting) {
    title = "Delete category";
  }

  return (
    <Dialog eyebrow="YOUR FINANCES" title={title} onClose={close}>
      {category && deleting ? (
        <CategoryDeleteForm category={category} close={close} cancel={() => setDeleting(false)} />
      ) : (
        <CategoryForm
          category={category}
          close={close}
          initialName={initialName}
          onSaved={onSaved}
          onDelete={() => setDeleting(true)}
        />
      )}
    </Dialog>
  );
}

function CategoryForm({
  category,
  close,
  initialName = "",
  onSaved,
  onDelete
}: Props & {
  onDelete: () => void;
}) {
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useSaveCategory(category), close);
  const [name, setName] = useState(category?.name ?? initialName);
  const [color, setColor] = useState(category?.color ?? defaultCategoryColor);
  const savedIcon = category?.icon;
  const [icon, setIcon] = useState<CategoryIconKey | "">(isCategoryIcon(savedIcon) ? savedIcon : "");
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);

  function panelToggle(panel: Exclude<OpenPanel, null>) {
    return (open: boolean) => setOpenPanel(current => {
      if (open) {
        return panel;
      }

      return current === panel ? null : current;
    });
  }

  return (
    <form
      onSubmit={event => submit(event, data => Object.fromEntries(data), onSaved)}
      className={ui["form"]}
    >
      <div className={styles["preview"]} aria-hidden="true">
        <CategoryLabel
          category={{
            name: name.trim() || "New category",
            color,
            icon: icon || null
          }}
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
      <div className={styles["appearance"]}>
        <CategoryIconField
          color={color}
          icon={icon}
          onChange={setIcon}
          open={openPanel === "icon"}
          onOpenChange={panelToggle("icon")}
        />
        <CategoryColorField
          color={color}
          onChange={setColor}
          open={openPanel === "color"}
          onOpenChange={panelToggle("color")}
        />
      </div>
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
        Save category
      </button>
      {category && <DeleteButton label="Delete category" disabled={pending} onClick={onDelete} />}
    </form>
  );
}

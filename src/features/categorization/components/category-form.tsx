"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useState } from "react";
import styles from "./category-form.module.css";
import { isCategoryIcon, suggestCategoryIcon, type CategoryIconKey } from "@/features/categorization/category-icons";
import type { Category } from "@/features/categorization/types";
import { useDialogSubmit, type DialogFormProps } from "@/components/ui/use-dialog-submit";
import { useSaveCategory } from "@/features/categorization/mutations";
import { useCategories } from "@/features/categorization/queries";
import { randomCategoryColor, suggestCategoryColor } from "@/features/categorization/category-color-suggestions";
import { FormError } from "@/components/ui/form-error";
import { CategoryLabel } from "./category-label";
import { CategoryColorField } from "./category-color-field";
import { CategoryIconField } from "./category-icon-field";
import { Dialog } from "@/components/ui/dialog";
import { CategoryDeleteForm, DeleteButton } from "./deletion-forms";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("categorization.categoryForm");
  const [deleting, setDeleting] = useState(false);
  let title = category ? t("editTitle") : t("addTitle");

  if (category && deleting) {
    title = t("deleteTitle");
  }

  return (
    <Dialog eyebrow={t("eyebrow")} title={title} onClose={close}>
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
  const t = useTranslations("categorization.categoryForm");
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useSaveCategory(category), close);
  const [name, setName] = useState(category?.name ?? initialName);
  const savedIcon = isCategoryIcon(category?.icon) ? category.icon : "";
  // Null while a new category follows its suggestions; an explicit choice, "" for no icon included, replaces them.
  const [chosenIcon, setChosenIcon] = useState<CategoryIconKey | "" | null>(category ? savedIcon : null);
  const similarIcon = suggestCategoryIcon(name);
  const icon = chosenIcon ?? similarIcon ?? "";
  const suggestedIcon = chosenIcon === null || similarIcon !== icon ? similarIcon : null;
  const categories = useCategories();
  // A new category's color derives from the other categories; without them, while loading or after a failed load, the server chooses on save.
  let unknownColorLabel: string | null = null;

  if (!category && !categories.data) {
    unknownColorLabel = categories.isError ? t("colorAutomatic") : t("colorLoading");
  }

  const existing = categories.data ?? [];
  const others = existing.filter(other => other.id !== category?.id);
  // One random draw per dialog keeps the fallback stable while it is applied to the loaded categories.
  const [draw] = useState(Math.random);
  const fallbackColor = randomCategoryColor(existing.map(other => other.color), () => draw);
  const [chosenColor, setChosenColor] = useState<string | null>(category?.color ?? null);
  const similarColor = suggestCategoryColor(name, icon || null, others);
  // A new category follows what similar categories use until a color is chosen, otherwise a rarely used palette color.
  const color = chosenColor ?? similarColor ?? fallbackColor;
  const followingColor = chosenColor === null && similarColor !== null;
  const suggestedColor = followingColor || similarColor?.toLowerCase() !== color.toLowerCase() ? similarColor : null;
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
            name: name.trim() || t("newCategory"),
            color,
            icon: icon || null
          }}
        />
      </div>
      <label>
        {t("name")}
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
          suggested={suggestedIcon}
          onChange={setChosenIcon}
          open={openPanel === "icon"}
          onOpenChange={panelToggle("icon")}
        />
        <CategoryColorField
          color={color}
          unknownLabel={unknownColorLabel}
          suggested={suggestedColor}
          onChange={setChosenColor}
          open={openPanel === "color"}
          onOpenChange={panelToggle("color")}
        />
      </div>
      <FormError failure={error} />
      <button className={clsx(ui["button"], ui["primary"], ui["full-width"])} disabled={pending}>
        {t("save")}
      </button>
      {category && <DeleteButton label={t("deleteTitle")} disabled={pending} onClick={onDelete} />}
    </form>
  );
}

"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useId } from "react";
import styles from "./category-choices.module.css";
import { type CategorySelection, type CategoryValue, type ImportProblem, type NewImportCategory } from "@/features/imports/import-plan";
import { FieldProblem, problemProps } from "./field-problem";
import { CategoryPicker, type PickerCategory } from "@/features/categorization/components/category-picker";
import { newCategoryColor } from "@/features/categorization/category-color-suggestions";
import { suggestCategoryIcon } from "@/features/categorization/category-icons";
import { categoryNameKey } from "@/lib/category-name";
import type { Category } from "@/features/categorization/types";
import type { ImportDraft } from "./use-import-draft";
import { useTranslations } from "next-intl";

// Categories the import creates on confirmation are offered under IDs no stored category uses.
function pendingId(name: string) {
  return `pending:${categoryNameKey(name)}`;
}

/** The distinct categories chosen for creation, offered to every value like existing ones. */
function pendingCategories(selections: ReadonlyMap<string, CategorySelection>) {
  const pending = new Map<string, PickerCategory>();

  for (const selection of selections.values()) {
    if (selection.action === "create") {
      pending.set(pendingId(selection.category.name), {
        ...selection.category,
        id: pendingId(selection.category.name)
      });
    }
  }

  return [...pending.values()];
}

/** The category column's distinct values, each mapped to an existing category, a category created on confirmation, or uncategorized. */
export function CategoryChoices({
  draft
}: {
  draft: ImportDraft;
}) {
  const t = useTranslations("imports.categoryChoices");
  const pending = pendingCategories(draft.categories);
  const options = [...draft.categoryOptions, ...pending];

  return (
    <section className={clsx(ui["panel"], styles["section"])} aria-labelledby="import-categories">
      <div>
        <h2 id="import-categories">{t("heading")}</h2>
        <p className={ui["form-hint"]}>{t("hint")}</p>
      </div>
      <fieldset className={styles["values"]} disabled={draft.inputsLocked}>
        <legend className={ui["visually-hidden"]}>{t("legend")}</legend>
        {draft.categoryValues.map(value => (
          <CategoryRow
            key={value.value}
            value={value}
            selection={draft.categories.get(value.value)}
            existing={draft.categoryOptions}
            pending={pending}
            options={options}
            problem={draft.prepared?.problems.find(problem => problem.field === "category" && problem.value === value.value)}
            onChange={selection => draft.chooseCategory(value.value, selection)}
          />
        ))}
      </fieldset>
    </section>
  );
}

function CategoryRow({
  value,
  selection,
  existing,
  pending,
  options,
  problem,
  onChange
}: {
  value: CategoryValue;
  selection: CategorySelection | undefined;
  existing: Category[];
  pending: PickerCategory[];
  options: PickerCategory[];
  problem: ImportProblem | undefined;
  onChange: (selection: CategorySelection) => void;
}) {
  const t = useTranslations("imports");
  const pickerId = useId();
  // An unset value matches no option, so the field starts empty and asks for a choice.
  let current: string | null = "";

  if (selection?.action === "existing") {
    current = selection.categoryId;
  } else if (selection?.action === "create") {
    current = pendingId(selection.category.name);
  } else if (selection?.action === "uncategorized") {
    current = null;
  }

  function choose(categoryId: string | null) {
    const chosenPending = pending.find(category => category.id === categoryId);

    if (categoryId === null) {
      onChange({
        action: "uncategorized"
      });
    } else if (chosenPending) {
      onChange({
        action: "create",
        category: newCategory(chosenPending)
      });
    } else {
      onChange({
        action: "existing",
        categoryId
      });
    }
  }

  // Creating from a search only records the category; the import creates it on confirmation with the same suggested icon and color.
  function create(name: string) {
    const icon = suggestCategoryIcon(name);

    onChange({
      action: "create",
      category: {
        name,
        icon,
        color: newCategoryColor(name, icon, [...existing, ...pending])
      }
    });
  }

  return (
    <div className={clsx(styles["value"], problem && styles["incomplete"])}>
      <label htmlFor={pickerId} className={styles["label"]}>
        <strong>{value.value}</strong>
        <span>
          {t("rowCount", {
            count: value.rows
          })}
          {value.multiTag && <span className={styles["several"]}>{t("categoryChoices.severalTags")}</span>}
          {selection?.action === "create" && <span className={styles["new"]}>{t("categoryChoices.newCategory")}</span>}
        </span>
      </label>
      <div className={styles["control"]}>
        <CategoryPicker
          id={pickerId}
          categories={options}
          includeUncategorized
          value={current}
          onChange={choose}
          onCreate={create}
          {...problemProps(problem, `${pickerId}-problem`)}
        />
        <FieldProblem problem={problem} id={`${pickerId}-problem`} />
      </div>
    </div>
  );
}

function newCategory(category: PickerCategory): NewImportCategory {
  return {
    name: category.name,
    color: category.color,
    icon: category.icon
  };
}

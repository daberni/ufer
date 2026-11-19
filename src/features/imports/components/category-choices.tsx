"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useId } from "react";
import styles from "./category-choices.module.css";
import { Select } from "@/components/ui/select";
import { rowCount, type CategorySelection, type CategoryValue } from "@/features/imports/import-plan";
import type { Category } from "@/features/categorization/types";
import type { ImportDraft } from "./use-import-draft";

/** The category column's distinct values, each mapped to an existing category, a new one, or the rules. */
export function CategoryChoices({
  draft
}: {
  draft: ImportDraft;
}) {
  return (
    <section className={clsx(ui["panel"], styles["section"])} aria-labelledby="import-categories">
      <div>
        <h2 id="import-categories">Categories</h2>
        <p className={ui["form-hint"]}>Values with several tags are not guessed: they are categorized by rules unless you choose a category.</p>
      </div>
      <fieldset className={styles["values"]} disabled={draft.inputsLocked}>
        <legend className={ui["visually-hidden"]}>Category for each value</legend>
        {draft.categoryValues.map(value => (
          <CategoryRow
            key={value.value}
            value={value}
            selection={draft.categories.get(value.value)}
            categories={draft.categoryOptions}
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
  categories,
  onChange
}: {
  value: CategoryValue;
  selection: CategorySelection | undefined;
  categories: Category[];
  onChange: (selection: CategorySelection) => void;
}) {
  const selectId = useId();
  const current = selection?.action === "existing" ? `existing:${selection.categoryId}` : selection?.action ?? "rules";
  const review = value.multiTag && !selection?.chosen;

  function select(next: string) {
    if (next.startsWith("existing:")) {
      onChange({
        action: "existing",
        categoryId: next.slice("existing:".length),
        chosen: true
      });

      return;
    }

    onChange({
      action: next as "create" | "rules",
      chosen: true
    });
  }

  return (
    <div className={styles["value"]}>
      <label htmlFor={selectId} className={styles["label"]}>
        <strong>{value.value}</strong>
        <span>
          {rowCount(value.rows)}
          {review && <span className={styles["review"]}>Several tags · needs review</span>}
        </span>
      </label>
      <Select id={selectId} value={current} onChange={event => select(event.target.value)}>
        <optgroup label="Existing categories">
          {categories.map(category => <option key={category.id} value={`existing:${category.id}`}>{category.name}</option>)}
        </optgroup>
        {!value.matchId && <option value="create">Create “{value.value}”</option>}
        <option value="rules">Use rules</option>
      </Select>
    </div>
  );
}

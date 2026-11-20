"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useId } from "react";
import styles from "./category-choices.module.css";
import { Select } from "@/components/ui/select";
import { rowCount, type CategorySelection, type CategoryValue, type ImportProblem } from "@/features/imports/import-plan";
import { FieldProblem, problemProps } from "./field-problem";
import type { Category } from "@/features/categorization/types";
import type { ImportDraft } from "./use-import-draft";
import { useLocale } from "@/client/locale-provider";

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
        <p className={ui["form-hint"]}>Each value without a category of the same name goes to an existing category, a new one, or the rules. Values with several tags are not guessed; tags with amounts split their row, and each tag is listed here.</p>
      </div>
      <fieldset className={styles["values"]} disabled={draft.inputsLocked}>
        <legend className={ui["visually-hidden"]}>Category for each value</legend>
        {draft.categoryValues.map(value => (
          <CategoryRow
            key={value.value}
            value={value}
            selection={draft.categories.get(value.value)}
            categories={draft.categoryOptions}
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
  categories,
  problem,
  onChange
}: {
  value: CategoryValue;
  selection: CategorySelection | undefined;
  categories: Category[];
  problem: ImportProblem | undefined;
  onChange: (selection: CategorySelection) => void;
}) {
  const locale = useLocale();
  const selectId = useId();
  let current = "";

  if (selection?.action === "existing") {
    current = `existing:${selection.categoryId}`;
  } else if (selection?.action === "create" || selection?.action === "rules") {
    current = selection.action;
  }

  function select(next: string) {
    if (next.startsWith("existing:")) {
      onChange({
        action: "existing",
        categoryId: next.slice("existing:".length)
      });
    } else if (next === "create" || next === "rules") {
      onChange({
        action: next
      });
    } else {
      onChange({
        action: "unset"
      });
    }
  }

  return (
    <div className={clsx(styles["value"], problem && styles["incomplete"])}>
      <label htmlFor={selectId} className={styles["label"]}>
        <strong>{value.value}</strong>
        <span>
          {rowCount(value.rows, locale)}
          {value.multiTag && <span className={styles["several"]}>Several tags</span>}
        </span>
      </label>
      <div className={styles["control"]}>
        <Select
          id={selectId}
          value={current}
          {...problemProps(problem, `${selectId}-problem`)}
          onChange={event => select(event.target.value)}
        >
          <option value="">Choose a category</option>
          <optgroup label="Existing categories">
            {categories.map(category => <option key={category.id} value={`existing:${category.id}`}>{category.name}</option>)}
          </optgroup>
          {!value.matchId && <option value="create">Create “{value.value}”</option>}
          {/* The server stores the rules choice of a part as uncategorized, since rules leave split bookings alone. */}
          <option value="rules">{value.splitOnly ? "Leave uncategorized" : "Use rules"}</option>
        </Select>
        <FieldProblem problem={problem} id={`${selectId}-problem`} />
      </div>
    </div>
  );
}

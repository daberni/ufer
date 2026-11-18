"use client";

import ui from "../../../components/ui/primitives.module.css";

import styles from "./category-picker.module.css";
import { clsx } from "clsx";
import { Zap } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { SearchableSelect, type SearchableSelectOption, type SearchableSelectAppearance } from "@/components/ui/searchable-select";
import { CategoryGlyph, categoryLabel, categoryNameColor, type DisplayCategory, type NeutralCategory } from "./category-label";
import { CategoryDialog } from "./category-form";

export type PickerCategory = DisplayCategory & {
  id: string;
};

/** Chooses "All categories" in a filter, as opposed to null for "Uncategorized". */
export const anyCategory: unique symbol = Symbol("any category");

export type CategoryPickerValue = string | null | typeof anyCategory;

/** Applies categorization rules to a new booking instead of explicitly assigning a category. */
export const automaticCategory: unique symbol = Symbol("automatic category");

export type CategoryAssignmentValue = string | null | typeof automaticCategory;

type PickerValue = CategoryPickerValue | typeof automaticCategory;

type ValueProps = {
  includeAll?: false;
  includeAutomatic?: false;
  value: string | null;
  onChange: (categoryId: string | null) => void;
} | {
  /** Offers "All categories" first, chosen by anyCategory; for filters. */
  includeAll: true;
  includeAutomatic?: false;
  value: CategoryPickerValue;
  onChange: (value: CategoryPickerValue) => void;
} | {
  includeAll?: false;
  /** Offers "Automatic" before explicit assignments; for a new booking. */
  includeAutomatic: true;
  value: CategoryAssignmentValue;
  onChange: (value: CategoryAssignmentValue) => void;
};

type Props = ValueProps & {
  categories: readonly PickerCategory[];
  /** Offers "Uncategorized", chosen by null. */
  includeUncategorized?: boolean;
  /** Transaction source; only manual assignments expose rule creation. Null shows no indicator. */
  assignment?: {
    source: "manual" | "rule" | null;
    actionLabel: string;
    disabled: boolean;
    createRule: () => void;
  };
  /** Compact fields suit transaction rows and filters; regular fields match the inputs of forms and dialogs. */
  size?: "regular" | "compact";
  /** Inline presentation is reserved for editable category labels in transaction rows. */
  appearance?: SearchableSelectAppearance;
  /** Save feedback inside the field, before the dropdown toggle and source indicator. */
  status?: ReactNode;
  /** Submits the chosen category ID with a surrounding form. */
  name?: string;
  id?: string;
  "aria-label"?: string;
  /** A change is being saved; the picker stays usable, since changes are saved in order. */
  "aria-busy"?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  className?: string;
};

const assignmentHints = {
  manual: "Set manually; kept when syncing and applying rules",
  rule: "Assigned by a rule; source rule not recorded"
};

const categoryNoun = {
  one: "category",
  other: "categories"
};

// Options show the same readable icon and name as a category label.
function categoryOption(key: string, value: PickerValue, category: DisplayCategory | NeutralCategory): SearchableSelectOption<PickerValue> {
  return {
    key,
    value,
    label: categoryLabel(category),
    icon: <CategoryGlyph category={category} />,
    color: categoryNameColor(category)
  };
}

function pickerOptions(categories: readonly PickerCategory[], includeAll: boolean, includeUncategorized: boolean, includeAutomatic: boolean) {
  const options: SearchableSelectOption<PickerValue>[] = [];

  if (includeAutomatic) {
    options.push(categoryOption("automatic-category", automaticCategory, "automatic"));
  }

  if (includeAll) {
    options.push(categoryOption("all-categories", anyCategory, "all-categories"));
  }

  if (includeUncategorized) {
    options.push(categoryOption("uncategorized", null, "uncategorized"));
  }

  for (const category of categories) {
    options.push(categoryOption(category.id, category.id, category));
  }

  return options;
}

/**
 * A searchable select of categories; typing narrows the list and only a picked option changes the category. Where it assigns a category, a search
 * without an exact match offers to create that category, which is selected once saved.
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  includeAll = false,
  includeAutomatic = false,
  includeUncategorized = false,
  assignment,
  size = "regular",
  appearance = "default",
  status,
  name,
  id,
  "aria-label": ariaLabel,
  "aria-busy": ariaBusy,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  className
}: Props) {
  const generatedId = useId();
  const assignmentHintId = useId();
  // A typed search; null while the field shows the selected category.
  const [search, setSearch] = useState<string | null>(null);
  // The name of a category being created from a search; its dialog is open while set.
  const [newCategoryName, setNewCategoryName] = useState<string | null>(null);
  const options = pickerOptions(categories, includeAll, includeUncategorized, includeAutomatic);
  const selected = options.find(option => Object.is(option.value, value));
  const assignmentSource = assignment?.source;
  const assignmentHint = assignmentSource ? assignmentHints[assignmentSource] : undefined;
  const describedBy = clsx(ariaDescribedBy, assignmentHint && assignmentHintId) || undefined;

  function choose(next: PickerValue) {
    setSearch(null);

    if (!Object.is(next, value)) {
      // The offered values match the assignment, automatic or filter variant selected by the flags.
      (onChange as (next: PickerValue) => void)(next);
    }
  }

  return (
    <div
      className={clsx(styles["picker"], className)}
      onBlur={event => {
        // An unfinished search is dropped when focus leaves, so the field shows the category that is actually set.
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setSearch(null);
        }
      }}
    >
      <SearchableSelect
        id={id ?? generatedId}
        options={options}
        value={value}
        onChange={choose}
        query={search ?? selected?.label ?? ""}
        onQueryChange={setSearch}
        noun={categoryNoun}
        placeholder="Search categories"
        appearance={appearance}
        busy={ariaBusy}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={describedBy}
        // A filter offers existing categories only.
        onCreate={includeAll ? undefined : setNewCategoryName}
        className={size === "compact" ? styles["compact"] : undefined}
        adornment={status && <span className={styles["adornment"]}>{status}</span>}
        endAdornment={assignment && assignmentSource && (
          <span className={styles["assignment-slot"]}>
            {assignmentSource === "manual" && (
              <button
                type="button"
                className={styles["assignment-action"]}
                data-assignment-source="manual"
                aria-label={assignment.actionLabel}
                aria-describedby={assignmentHintId}
                aria-haspopup="dialog"
                title={`${assignmentHint}. ${assignment.actionLabel}.`}
                disabled={assignment.disabled}
                onClick={assignment.createRule}
              >
                <Zap className={clsx(styles["assignment-icon"], styles["manual"])} aria-hidden="true" />
              </button>
            )}
            {assignmentSource === "rule" && (
              <span
                className={styles["assignment-indicator"]}
                data-assignment-source="rule"
                title={assignmentHint}
                aria-hidden="true"
              >
                <Zap className={clsx(styles["assignment-icon"], styles["rule"])} />
              </span>
            )}
          </span>
        )}
        footer={assignmentHint && assignmentSource && (
          <p className={styles["note"]}>
            <Zap className={clsx(styles["note-icon"], styles[assignmentSource])} aria-hidden="true" />
            {assignmentHint}.
          </p>
        )}
      />
      {assignmentHint && <span id={assignmentHintId} className={ui["visually-hidden"]}>{assignmentHint}</span>}
      {name && <input type="hidden" name={name} value={typeof value === "string" ? value : ""} />}
      {newCategoryName !== null && (
        <CategoryDialog
          initialName={newCategoryName}
          close={() => setNewCategoryName(null)}
          onSaved={choose}
        />
      )}
    </div>
  );
}

"use client";

import ui from "../../../components/ui/primitives.module.css";

import styles from "./category-picker.module.css";
import { clsx } from "clsx";
import { Pin } from "lucide-react";
import { useId, useState } from "react";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { neutralChipColor } from "@/features/categorization/category-colors";
import { manualAssignmentHint, type ChipCategory } from "./category-chip";
import { CategoryDialog } from "./category-form";
import { CategoryMarker } from "./category-marker";

export type PickerCategory = ChipCategory & {
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
  manual?: boolean;
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

const categoryNoun = {
  one: "category",
  other: "categories"
};

function neutralOption(key: string, value: PickerValue, label: string): SearchableSelectOption<PickerValue> {
  return {
    key,
    value,
    label,
    icon: <CategoryMarker icon={null} color={neutralChipColor} />
  };
}

function pickerOptions(categories: readonly PickerCategory[], includeAll: boolean, includeUncategorized: boolean, includeAutomatic: boolean) {
  const options: SearchableSelectOption<PickerValue>[] = [];

  if (includeAutomatic) {
    options.push(neutralOption("automatic-category", automaticCategory, "Automatic"));
  }

  if (includeAll) {
    options.push(neutralOption("all-categories", anyCategory, "All categories"));
  }

  if (includeUncategorized) {
    options.push(neutralOption("uncategorized", null, "Uncategorized"));
  }

  for (const category of categories) {
    options.push({
      key: category.id,
      value: category.id,
      label: category.name,
      icon: <CategoryMarker icon={category.icon} color={category.color} />
    });
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
  manual = false,
  name,
  id,
  "aria-label": ariaLabel,
  "aria-busy": ariaBusy,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  className
}: Props) {
  const generatedId = useId();
  const manualHintId = useId();
  // A typed search; null while the field shows the selected category.
  const [search, setSearch] = useState<string | null>(null);
  // The name of a category being created from a search; its dialog is open while set.
  const [newCategoryName, setNewCategoryName] = useState<string | null>(null);
  const options = pickerOptions(categories, includeAll, includeUncategorized, includeAutomatic);
  const selected = options.find(option => Object.is(option.value, value));
  const describedBy = clsx(ariaDescribedBy, manual && manualHintId) || undefined;

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
        busy={ariaBusy}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={describedBy}
        // A filter offers existing categories only.
        onCreate={includeAll ? undefined : setNewCategoryName}
        footer={manual && (
          <p className={styles["note"]}>
            <Pin className={styles["note-icon"]} aria-hidden="true" strokeWidth={2.2} />
            {manualAssignmentHint}.
          </p>
        )}
      />
      {manual && (
        <span className={styles["manual"]} title={manualAssignmentHint}>
          <Pin className={styles["note-icon"]} aria-hidden="true" strokeWidth={2.2} />
          <span id={manualHintId} className={ui["visually-hidden"]}>{manualAssignmentHint}</span>
        </span>
      )}
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

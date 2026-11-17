"use client";

import ui from "../../../components/ui/primitives.module.css";

import styles from "./category-picker.module.css";
import { clsx } from "clsx";
import { Pin } from "lucide-react";
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

type ValueProps = {
  includeAll?: false;
  value: string | null;
  onChange: (categoryId: string | null) => void;
} | {
  /** Offers "All categories" first, chosen by anyCategory; for filters. */
  includeAll: true;
  value: CategoryPickerValue;
  onChange: (value: CategoryPickerValue) => void;
};

type Props = ValueProps & {
  categories: readonly PickerCategory[];
  /** Offers "Uncategorized", chosen by null. */
  includeUncategorized?: boolean;
  manual?: boolean;
  /** Compact fields suit transaction rows and filters; regular fields match the inputs of forms and dialogs. */
  size?: "regular" | "compact";
  /** Inline presentation is reserved for editable category labels in transaction rows. */
  appearance?: SearchableSelectAppearance;
  /** Shown inside the field's right edge after the manual pin, such as the saving state of a change. */
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

const manualAssignmentHint = "Set manually; kept when syncing and applying rules";

const categoryNoun = {
  one: "category",
  other: "categories"
};

// Options show the same readable icon and name as a category label.
function categoryOption(key: string, value: CategoryPickerValue, category: DisplayCategory | NeutralCategory): SearchableSelectOption<CategoryPickerValue> {
  return {
    key,
    value,
    label: categoryLabel(category),
    icon: <CategoryGlyph category={category} />,
    color: categoryNameColor(category)
  };
}

function pickerOptions(categories: readonly PickerCategory[], includeAll: boolean, includeUncategorized: boolean) {
  const options: SearchableSelectOption<CategoryPickerValue>[] = [];

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
  includeUncategorized = false,
  manual = false,
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
  const manualHintId = useId();
  // A typed search; null while the field shows the selected category.
  const [search, setSearch] = useState<string | null>(null);
  // The name of a category being created from a search; its dialog is open while set.
  const [newCategoryName, setNewCategoryName] = useState<string | null>(null);
  const options = pickerOptions(categories, includeAll, includeUncategorized);
  const selected = options.find(option => Object.is(option.value, value));
  const describedBy = clsx(ariaDescribedBy, manual && manualHintId) || undefined;

  function choose(next: CategoryPickerValue) {
    setSearch(null);

    if (!Object.is(next, value)) {
      // The offered values always match the onChange variant that includeAll selects.
      (onChange as (next: CategoryPickerValue) => void)(next);
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
        adornment={(manual || status) && (
          <span className={styles["adornment"]}>
            {manual && (
              <span className={styles["manual"]} title={manualAssignmentHint}>
                <Pin className={styles["adornment-icon"]} aria-hidden="true" strokeWidth={2.2} />
                <span id={manualHintId} className={ui["visually-hidden"]}>{manualAssignmentHint}</span>
              </span>
            )}
            {status}
          </span>
        )}
        footer={manual && (
          <p className={styles["note"]}>
            <Pin className={styles["note-icon"]} aria-hidden="true" strokeWidth={2.2} />
            {manualAssignmentHint}.
          </p>
        )}
      />
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

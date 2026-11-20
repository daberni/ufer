"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import styles from "./category-color-suggestions-dialog.module.css";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { useDialogSubmit } from "@/components/ui/use-dialog-submit";
import { useApplyCategoryColors } from "@/features/categorization/mutations";
import { categoryBarColor, suggestedCategoryColors, themedColor } from "@/features/categorization/category-colors";
import { suggestCategoryColors } from "@/features/categorization/category-color-suggestions";
import type { Category } from "@/features/categorization/types";
import { CategoryGlyph } from "./category-label";

type Props = {
  categories: Category[];
  close: () => void;
};

function swatchColor(color: string) {
  return themedColor(scheme => categoryBarColor(color, scheme));
}

function colorName(color: string) {
  return suggestedCategoryColors.find(suggestion => suggestion.value.toLowerCase() === color.toLowerCase())?.name ?? color.toUpperCase();
}

/** Previews a palette color for every category; only the checked suggestions are stored, in one request, after confirmation. */
export function CategoryColorSuggestionsDialog({
  categories,
  close
}: Props) {
  // The suggestions are computed once, so a refresh while the dialog is open does not change what the person reviews.
  const [changes] = useState(() => suggestCategoryColors(categories).filter(suggestion => suggestion.changed).sort((first, second) => first.category.name.localeCompare(second.category.name)));
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const {
    error,
    pending,
    submit
  } = useDialogSubmit(useApplyCategoryColors(), close);
  const selected = changes.filter(change => !skipped.has(change.category.id));
  const unchanged = categories.length - changes.length;

  function toggle(id: string, include: boolean) {
    setSkipped(current => {
      const next = new Set(current);

      if (include) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  return (
    <Dialog eyebrow="YOUR FINANCES" title="Suggest colors" onClose={close}>
      <form
        className={ui["form"]}
        onSubmit={event => submit(event, () => selected.map(change => ({
          id: change.category.id,
          color: change.suggested
        })))}
      >
        <p className={ui["form-description"]}>
          Categories sharing a prefix such as “Car / …” get one color, and other categories a color for their icon’s area. Uncheck a category to keep its color.
        </p>
        {changes.length === 0 ? (
          <p className={ui["muted"]}>Every category already has its suggested color.</p>
        ) : (
          <ul className={styles["list"]} aria-label="Suggested colors">
            {changes.map(change => {
              const included = !skipped.has(change.category.id);

              return (
                <li key={change.category.id}>
                  <label className={clsx(styles["row"], !included && styles["skipped"])}>
                    <input type="checkbox" checked={included} onChange={event => toggle(change.category.id, event.target.checked)} />
                    <CategoryGlyph category={change.category} />
                    <span className={styles["name"]}>{change.category.name}</span>
                    <span className={styles["colors"]}>
                      <span
                        className={styles["swatch"]}
                        title={colorName(change.category.color)}
                        style={{
                          background: swatchColor(change.category.color)
                        }}
                      />
                      <span className={ui["visually-hidden"]}>{`${colorName(change.category.color)} to ${colorName(change.suggested)}`}</span>
                      <ArrowRight size={14} aria-hidden="true" />
                      <span
                        className={styles["swatch"]}
                        title={colorName(change.suggested)}
                        style={{
                          background: swatchColor(change.suggested)
                        }}
                      />
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {unchanged > 0 && changes.length > 0 && <p className={ui["form-hint"]}>{unchanged === 1 ? "1 category already has its suggested color." : `${unchanged} categories already have their suggested colors.`}</p>}
        <FormError failure={error} />
        <div className={ui["form-actions"]}>
          <button
            type="button"
            className={ui["button"]}
            disabled={pending}
            onClick={close}
          >Cancel</button>
          <button className={clsx(ui["button"], ui["primary"])} disabled={pending || selected.length === 0}>
            {selected.length === 1 ? "Apply 1 color" : `Apply ${selected.length} colors`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

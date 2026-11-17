import styles from "./category-label.module.css";
import { clsx } from "clsx";
import { CircleDashed, Shapes, SlidersHorizontal } from "lucide-react";
import { isCategoryIcon } from "@/features/categorization/category-icons";
import { categoryTextColor, neutralChipColor, themedColor } from "@/features/categorization/category-colors";
import { categoryIconComponents } from "./category-icon-components";

export type DisplayCategory = {
  name: string;
  color: string;
  icon: string | null;
};

/** Neutral labels for automatic assignment, no assigned category and unrestricted category filters. */
export type NeutralCategory = "automatic" | "uncategorized" | "all-categories";

const neutralCategories = {
  "automatic": {
    label: "Automatic",
    Icon: SlidersHorizontal
  },
  "uncategorized": {
    label: "Uncategorized",
    Icon: CircleDashed
  },
  "all-categories": {
    label: "All categories",
    Icon: Shapes
  }
};

type Props = {
  category: DisplayCategory | NeutralCategory;
  className?: string;
};

export function categoryLabel(category: DisplayCategory | NeutralCategory) {
  return typeof category === "string" ? neutralCategories[category].label : category.name;
}

function baseColor(category: DisplayCategory | NeutralCategory) {
  return typeof category === "string" ? neutralChipColor : category.color;
}

/** The readable category color shared by labels and category selects. */
export function categoryNameColor(category: DisplayCategory | NeutralCategory) {
  return themedColor(scheme => categoryTextColor(baseColor(category), scheme));
}

/** The category's icon, or a dot without one, in the current text color and sized with the text. Decorative: the name always accompanies it. */
export function CategoryGlyph({
  category
}: {
  category: DisplayCategory | NeutralCategory;
}) {
  if (typeof category === "string") {
    const NeutralIcon = neutralCategories[category].Icon;

    return <NeutralIcon className={styles["icon"]} aria-hidden="true" strokeWidth={2.2} />;
  }

  if (!isCategoryIcon(category.icon)) {
    return <span className={styles["dot"]} aria-hidden="true" />;
  }

  const Icon = categoryIconComponents[category.icon];

  return <Icon className={styles["icon"]} aria-hidden="true" strokeWidth={2.2} />;
}

/** A category's icon and name in its readable color, without a separate badge surface. */
export function CategoryLabel({
  category,
  className
}: Props) {
  return (
    <span
      className={clsx(styles["label"], className)}
      title={categoryLabel(category)}
      style={{
        color: categoryNameColor(category)
      }}
    >
      <CategoryGlyph category={category} />
      <span className={styles["name"]}>{categoryLabel(category)}</span>
    </span>
  );
}

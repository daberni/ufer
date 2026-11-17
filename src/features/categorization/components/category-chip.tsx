import styles from "./category-chip.module.css";
import { clsx } from "clsx";
import { CircleDashed, Shapes } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { isCategoryIcon } from "@/features/categorization/category-icons";
import { categoryChipColors, categoryTextColor, neutralChipColor, themedColor, themedColors } from "@/features/categorization/category-colors";
import { categoryIconComponents } from "./category-icon-components";

export type ChipCategory = {
  name: string;
  color: string;
  icon: string | null;
};

/** Neutral chips for the absence of a category and, in filters, for no category restriction. */
export type NeutralChip = "uncategorized" | "all-categories";

const neutralChips = {
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
  category: ChipCategory | NeutralChip;
  className?: string;
  /** Trailing content inside the chip, such as an edit indicator. */
  children?: ReactNode;
};

export function categoryLabel(category: ChipCategory | NeutralChip) {
  return typeof category === "string" ? neutralChips[category].label : category.name;
}

function baseColor(category: ChipCategory | NeutralChip) {
  return typeof category === "string" ? neutralChipColor : category.color;
}

/** The color of the category's icon and name without its chip, such as in a category select. */
export function categoryNameColor(category: ChipCategory | NeutralChip) {
  return themedColor(scheme => categoryTextColor(baseColor(category), scheme));
}

/** The category's icon, or a dot without one, in the current text color and sized with the text. Decorative: the name always accompanies it. */
export function CategoryGlyph({
  category
}: {
  category: ChipCategory | NeutralChip;
}) {
  if (typeof category === "string") {
    const NeutralIcon = neutralChips[category].Icon;

    return <NeutralIcon className={styles["icon"]} aria-hidden="true" strokeWidth={2.2} />;
  }

  if (!isCategoryIcon(category.icon)) {
    return <span className={styles["dot"]} aria-hidden="true" />;
  }

  const Icon = categoryIconComponents[category.icon];

  return <Icon className={styles["icon"]} aria-hidden="true" strokeWidth={2.2} />;
}

/** The single presentation of a category wherever one is shown: a tinted chip with its icon followed by its name, in one size. */
export function CategoryChip({
  category,
  className,
  children
}: Props) {
  const colors = themedColors(scheme => categoryChipColors(baseColor(category), scheme));
  const colorVariables = {
    "--chip-background": colors.background,
    "--chip-border": colors.border,
    "--chip-foreground": colors.foreground
  } as CSSProperties;

  return (
    <span className={clsx(styles["chip"], className)} style={colorVariables}>
      <CategoryGlyph category={category} />
      <span className={styles["name"]}>{categoryLabel(category)}</span>
      {children}
    </span>
  );
}

import ui from "../../../components/ui/primitives.module.css";
import styles from "./category-label.module.css";
import { clsx } from "clsx";
import { CircleDashed, Shapes, SlidersHorizontal } from "lucide-react";
import { isCategoryIcon } from "@/features/categorization/category-icons";
import { categoryTextColor, neutralChipColor, themedColor } from "@/features/categorization/category-colors";
import { categoryIconComponents } from "./category-icon-components";
import { Tooltip } from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";

export type DisplayCategory = {
  name: string;
  color: string;
  icon: string | null;
};

/** Neutral labels for automatic assignment, no assigned category and unrestricted category filters. */
export type NeutralCategory = "automatic" | "uncategorized" | "all-categories";

const neutralIcons = {
  "automatic": SlidersHorizontal,
  "uncategorized": CircleDashed,
  "all-categories": Shapes
};

type Props = {
  category: DisplayCategory | NeutralCategory;
  className?: string;
};

export type NeutralCategoryTranslator = ReturnType<typeof useTranslations<"categorization.neutral">>;

export function categoryLabel(category: DisplayCategory | NeutralCategory, t: NeutralCategoryTranslator) {
  return typeof category === "string" ? t(category) : category.name;
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
    const NeutralIcon = neutralIcons[category];

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
  const t = useTranslations("categorization.neutral");

  return (
    <Tooltip text={categoryLabel(category, t)} describes={false} onlyWhenTruncated>
      {trigger => (
        <span
          {...trigger}
          className={clsx(styles["label"], className)}
          style={{
            color: categoryNameColor(category)
          }}
        >
          <CategoryGlyph category={category} />
          <span className={ui["truncate"]}>{categoryLabel(category, t)}</span>
        </span>
      )}
    </Tooltip>
  );
}

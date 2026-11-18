import ui from "../../../components/ui/primitives.module.css";

import styles from "./category-rows.module.css";
import { clsx } from "clsx";
import { money } from "@/lib/money";
import { CategoryLabel, type DisplayCategory, type NeutralCategory } from "@/features/categorization/components/category-label";
import { categoryBarColor, neutralChipColor, themedColor } from "@/features/categorization/category-colors";
import type { CategoryGroup } from "@/features/reports/category-groups";

const shareFormat = new Intl.NumberFormat("en-GB", {
  style: "percent",
  maximumFractionDigits: 0
});

/** The rows as one sentence for an accessible description, e.g. "Groceries €120.00 (40%), Rent €180.00 (60%)". */
export function describeCategoryGroups(groups: CategoryGroup[], currency: string) {
  if (!groups.length) {
    return "None.";
  }

  return groups.map(group => `${group.name} ${money(group.amount, currency)} (${shareFormat.format(group.share)})`).join(", ");
}

function groupCategory(group: CategoryGroup): DisplayCategory | NeutralCategory {
  if (group.key === "uncategorized") {
    return "uncategorized";
  }

  return {
    name: group.name,
    color: group.color,
    icon: group.icon
  };
}

type Props = {
  groups: CategoryGroup[];
  currency: string;
  className?: string;
};

/** Category, amount and share bar for the selected period or monthly flow. */
export function CategoryRows({
  groups,
  currency,
  className
}: Props) {
  return (
    <div className={clsx(styles["rows"], className)}>
      {groups.map(group => (
        <div className={styles["row"]} key={group.key}>
          <span className={styles["category"]}>
            <CategoryLabel category={groupCategory(group)} />
          </span>
          <strong>{money(group.amount, currency)}</strong>
          <div>
            <i
              style={{
                width: `${group.share * 100}%`,
                background: themedColor(scheme => categoryBarColor(group.color, scheme))
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// Names of different lengths give the skeleton rows a natural outline.
const skeletonNames = ["Groceries", "Housing and utilities", "Transport", "Restaurants", "Leisure"];

/** Rows in the shape of category rows for a breakdown whose first results are loading. */
export function CategoryRowsSkeleton({
  rows,
  className
}: {
  rows: number;
  className?: string;
}) {
  return (
    <div className={clsx(styles["rows"], className)}>
      {Array.from({
        length: rows
      }, (_, index) => (
        <div className={styles["row"]} key={index}>
          <span className={styles["category"]}>
            <CategoryLabel
              className={ui["skeleton"]}
              category={{
                name: skeletonNames[index % skeletonNames.length],
                color: neutralChipColor,
                icon: null
              }}
            />
          </span>
          <strong className={ui["skeleton"]}>€000.00</strong>
          <div />
        </div>
      ))}
    </div>
  );
}

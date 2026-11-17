import ui from "../../../components/ui/primitives.module.css";

import styles from "./category-rows.module.css";
import { clsx } from "clsx";
import { money } from "@/lib/money";
import { CategoryMarker } from "@/features/categorization/components/category-marker";
import { categoryBarColor, themedColor } from "@/features/categorization/category-colors";
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

type Props = {
  groups: CategoryGroup[];
  currency: string;
  /** One line per row with the name truncated and a thin share bar, for details that must fit a fixed height. */
  compact?: boolean;
  className?: string;
};

/** Rows with category, amount and share bar; shared by "Where your money goes" and the monthly breakdowns in the cash-flow chart. */
export function CategoryRows({
  groups,
  currency,
  compact = false,
  className
}: Props) {
  return (
    <div className={clsx(styles["rows"], compact && styles["compact"], className)}>
      {groups.map(group => (
        <div className={styles["row"]} key={group.key}>
          <span>
            <CategoryMarker icon={group.icon} color={group.color} />
            <span className={styles["name"]} title={compact ? group.name : undefined}>{group.name}</span>
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
          <span>
            <span className={clsx(styles["marker"], ui["skeleton"])} />
            <span className={ui["skeleton"]}>{skeletonNames[index % skeletonNames.length]}</span>
          </span>
          <strong className={ui["skeleton"]}>€000.00</strong>
          <div />
        </div>
      ))}
    </div>
  );
}

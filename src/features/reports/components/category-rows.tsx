import ui from "../../../components/ui/primitives.module.css";

import styles from "./category-rows.module.css";
import Link from "next/link";
import { clsx } from "clsx";
import { formatPercent } from "@/lib/locale";
import { money } from "@/lib/money";
import { CategoryLabel, type DisplayCategory, type NeutralCategory } from "@/features/categorization/components/category-label";
import { categoryBarColor, neutralChipColor, themedColor } from "@/features/categorization/category-colors";
import { displayName, type CategoryGroup } from "@/features/reports/category-groups";
import { useFormatLocale } from "@/client/format-locale-provider";

/** The rows as one sentence for an accessible description, e.g. "Groceries €120.00 (40%), Rent €180.00 (60%)". */
export function describeCategoryGroups(groups: CategoryGroup[], currency: string, locale: string) {
  if (!groups.length) {
    return "None.";
  }

  return groups.map(group => `${displayName(group, locale)} ${money(group.amount, currency, locale)} (${formatPercent(group.share, locale)})`).join(", ");
}

function groupCategory(group: CategoryGroup, locale: string): DisplayCategory | NeutralCategory {
  if (group.key === "uncategorized") {
    return "uncategorized";
  }

  return {
    name: displayName(group, locale),
    color: group.color,
    icon: group.icon
  };
}

/** Where a row leads and how a screen reader names that link. */
export type CategoryRowLink = {
  href: string;
  label: string;
};

type Props = {
  groups: CategoryGroup[];
  currency: string;
  /** The transactions behind a row; rows without one stay plain. */
  rowLink?: (group: CategoryGroup) => CategoryRowLink | null;
  className?: string;
};

/** Category, amount and share bar for the selected period or monthly flow. */
export function CategoryRows({
  groups,
  currency,
  rowLink,
  className
}: Props) {
  const locale = useFormatLocale();

  return (
    <div className={clsx(styles["rows"], className)}>
      {groups.map(group => {
        const link = rowLink?.(group) ?? null;
        const content = (
          <>
            <span className={styles["category"]}>
              <CategoryLabel category={groupCategory(group, locale)} />
            </span>
            <strong>{money(group.amount, currency, locale)}</strong>
            <div>
              <i
                style={{
                  width: `${group.share * 100}%`,
                  background: themedColor(scheme => categoryBarColor(group.color, scheme))
                }}
              />
            </div>
          </>
        );

        if (!link) {
          return <div className={styles["row"]} key={group.key}>{content}</div>;
        }

        return (
          <Link
            className={clsx(styles["row"], styles["link"])}
            key={group.key}
            href={link.href}
            aria-label={link.label}
          >
            {content}
          </Link>
        );
      })}
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

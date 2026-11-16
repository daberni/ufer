import styles from "./spending-rows.module.css";
import { clsx } from "clsx";
import { money } from "@/lib/money";
import { CategoryMarker } from "@/features/categorization/components/category-marker";
import type { SpendingGroup } from "@/features/dashboard/spending-groups";

const shareFormat = new Intl.NumberFormat("en-GB", {
  style: "percent",
  maximumFractionDigits: 0
});

/** The rows as one sentence for an accessible description, e.g. "Groceries €120.00 (40%), Rent €180.00 (60%)". */
export function describeSpending(groups: SpendingGroup[], currency: string) {
  if (!groups.length) {
    return "No expenses.";
  }

  return groups.map(group => `${group.name} ${money(group.amount, currency)} (${shareFormat.format(group.share)})`).join(", ");
}

type Props = {
  groups: SpendingGroup[];
  currency: string;
  className?: string;
};

/** Spending rows with category, amount and share bar; shared by "Where your money goes" and the monthly breakdown in the cash-flow chart. */
export function SpendingRows({
  groups,
  currency,
  className
}: Props) {
  return (
    <div className={clsx(styles["rows"], className)}>
      {groups.map(group => (
        <div className={styles["row"]} key={group.key}>
          <span>
            <CategoryMarker icon={group.icon} color={group.color} />
            {group.name}
          </span>
          <strong>{money(group.amount, currency)}</strong>
          <div>
            <i
              style={{
                width: `${group.share * 100}%`,
                background: group.color
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

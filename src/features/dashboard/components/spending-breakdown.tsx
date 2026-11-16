"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./spending-breakdown.module.css";
import { periodLabel } from "@/features/dashboard/presentation";
import { periodFromJson } from "@/features/dashboard/period";
import { money } from "@/lib/money";
import { Empty } from "@/components/ui/empty-state";
import { CategoryMarker } from "@/features/categorization/components/category-marker";
import { areaProps, valueMask } from "@/features/dashboard/components/result-presentation";
import type { AreaResult } from "@/features/dashboard/use-area-result";
import type { CashFlow } from "@/features/dashboard/types";

type Props = {
  cashFlow: AreaResult<CashFlow>;
};

export function SpendingBreakdown({ cashFlow }: Props) {
  const {
    breakdown,
    currency,
    period
  } = cashFlow.data;
  const totalExpenses = breakdown.reduce((sum, item) => sum + item.amount, 0);

  return (
    <section className={ui["panel"]}>
      <div className={ui["card-heading"]}>
        <h2>Where your money goes</h2>
        <span className={clsx(ui["subtle"], valueMask(cashFlow.status))}>{periodLabel(periodFromJson(period))}</span>
      </div>
      <div {...areaProps(cashFlow.status)}>
        {breakdown.length ? (
          <div className={styles["category-breakdown"]}>
            {breakdown.slice(0, 5).map(item => (
              <div className={styles["breakdown-row"]} key={item.name}>
                <span>
                  <CategoryMarker icon={item.icon} color={item.color} />
                  {item.name}
                </span>
                <strong>{money(item.amount, currency)}</strong>
                <div>
                  <i
                    style={{
                      width: `${item.amount / totalExpenses * 100}%`,
                      background: item.color
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : <Empty title="No expenses yet" illustration={null}>Your spending breakdown appears here once transactions are available.</Empty>}
      </div>
    </section>
  );
}

"use client";

import ui from "../../../components/ui/primitives.module.css";

import styles from "./spending-breakdown.module.css";
import { periodLabel } from "@/features/dashboard/presentation";
import { periodFromJson } from "@/features/dashboard/period";
import { money } from "@/lib/money";
import { Empty } from "@/components/ui/empty-state";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import { CategoryMarker } from "@/features/categorization/components/category-marker";

type Props = Pick<DashboardController, "currency" | "state" | "totalExpenses">;

export function SpendingBreakdown({
  currency,
  state,
  totalExpenses
}: Props) {
  if (!state) {
    return null;
  }

  return (
    <section className={ui["panel"]}>
      <div className={ui["card-heading"]}>
        <h2>Where your money goes</h2>
        <span className={ui["subtle"]}>{periodLabel(periodFromJson(state.period))}</span>
      </div>
      {state.breakdown.length ? (
        <div className={styles["category-breakdown"]}>
          {state.breakdown.slice(0, 5).map(item => (
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
    </section>
  );
}

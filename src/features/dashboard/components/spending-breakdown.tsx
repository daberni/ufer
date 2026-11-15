"use client";

import ui from "../../../components/ui/primitives.module.css";

import styles from "./spending-breakdown.module.css";
import { monthLabel } from "@/features/dashboard/presentation";
import { money } from "@/lib/money";
import { Empty } from "@/components/ui/empty-state";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "currency" | "month" | "state" | "totalExpenses">;

export function SpendingBreakdown({
  currency,
  month,
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
        <span className={ui["subtle"]}>{monthLabel(month)}</span>
      </div>
      {state.breakdown.length ? (
        <div className={styles["category-breakdown"]}>
          {state.breakdown.slice(0, 5).map(item => (
            <div className={styles["breakdown-row"]} key={item.name}>
              <span>
                <i
                  className={ui["legend-dot"]}
                  style={{
                    background: item.color
                  }}
                />
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

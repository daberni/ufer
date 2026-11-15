"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./spending-breakdown.module.css";
import { periodLabel } from "@/features/dashboard/presentation";
import { resultMask } from "@/features/dashboard/components/result-mask";
import { periodFromJson } from "@/features/dashboard/period";
import { money } from "@/lib/money";
import { Empty } from "@/components/ui/empty-state";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import { CategoryMarker } from "@/features/categorization/components/category-marker";

type Props = Pick<DashboardController, "currency" | "results" | "state" | "totalExpenses">;

export function SpendingBreakdown({
  currency,
  results,
  state,
  totalExpenses
}: Props) {
  if (!state) {
    return null;
  }

  const skeleton = resultMask(results.cashFlow);

  return (
    <section className={ui["panel"]} aria-busy={results.cashFlow === "loading"}>
      <div className={ui["card-heading"]}>
        <h2>Where your money goes</h2>
        <span className={clsx(ui["subtle"], skeleton)}>{periodLabel(periodFromJson(state.period))}</span>
      </div>
      {state.breakdown.length ? (
        <div className={styles["category-breakdown"]}>
          {state.breakdown.slice(0, 5).map(item => (
            <div className={clsx(styles["breakdown-row"], skeleton)} key={item.name}>
              <span>
                <CategoryMarker icon={item.icon} color={item.color} size="small" />
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
      ) : (
        <div className={skeleton}>
          <Empty title="No expenses yet" illustration={null}>Your spending breakdown appears here once transactions are available.</Empty>
        </div>
      )}
    </section>
  );
}

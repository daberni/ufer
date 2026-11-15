"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./cash-flow-chart.module.css";
import { monthLabel, monthRangeLabel } from "@/features/dashboard/presentation";
import { money } from "@/lib/money";
import type { DashboardController } from "@/features/dashboard/use-dashboard";

type Props = Pick<DashboardController, "currency" | "state" | "trend" | "trendMax">;

export function CashFlowChart({
  currency,
  state,
  trend,
  trendMax
}: Props) {
  if (!state) {
    return null;
  }

  return (
    <section className={ui["panel"]}>
      <div className={ui["card-heading"]}>
        <h2>Income & expenses</h2>
        <span className={ui["subtle"]}>{monthRangeLabel(trend.map(item => item.month))}</span>
      </div>
      <div className={styles["chart-legend"]}>
        <span>
          <i className={clsx(styles["legend-dot"], ui["liquid"])} />
          Income
        </span>
        <span>
          <i className={clsx(styles["legend-dot"], styles["expense-dot"])} />
          Expenses
        </span>
      </div>
      <div className={styles["bar-chart"]} role="img" aria-label={`Monthly income and expenses for ${trend.map(item => `${monthLabel(item.month)}: Income ${money(item.income, currency)}, Expenses ${money(item.expenses, currency)}`).join("; ")}`}>
        <div className={styles["chart-grid"]}>
          <span />
          <span />
          <span />
          <span />
        </div>
        {trend.map(item => (
          <div className={styles["bar-group"]} key={item.month}>
            <div className={styles["bars"]}>
              <span
                className={styles["income-bar"]}
                style={{
                  height: `${item.income / trendMax * 100}%`
                }}
                title={money(item.income, currency)}
              />
              <span
                className={styles["expense-bar"]}
                style={{
                  height: `${item.expenses / trendMax * 100}%`
                }}
                title={money(item.expenses, currency)}
              />
            </div>
            <span>{new Intl.DateTimeFormat("en-GB", {
              month: "short"
            }).format(new Date(`${item.month}-01`))}</span>
          </div>
        ))}
      </div>
      {trend.every(item => item.income === 0 && item.expenses === 0) && <p className={styles["chart-empty-note"]}>Your history appears here after the first import.</p>}
    </section>
  );
}

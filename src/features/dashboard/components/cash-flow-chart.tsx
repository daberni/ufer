"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import styles from "./cash-flow-chart.module.css";
import { monthRangeLabel } from "@/features/dashboard/presentation";
import { describeMonth } from "@/lib/date-format";
import { money } from "@/lib/money";
import { areaProps, valueMask } from "@/features/dashboard/components/result-presentation";
import type { AreaResult } from "@/features/dashboard/use-area-result";
import type { CashFlow } from "@/features/dashboard/types";

type Props = {
  cashFlow: AreaResult<CashFlow>;
};

export function CashFlowChart({ cashFlow }: Props) {
  const {
    currency,
    trend
  } = cashFlow.data;
  const trendMax = Math.max(1, ...trend.flatMap(item => [item.income, item.expenses]));
  const months = trend.map(item => Temporal.PlainYearMonth.from(item.month));
  const bars = trend.map((item, index) => ({
    ...item,
    display: describeMonth(months[index])
  }));

  return (
    <section className={ui["panel"]}>
      <div className={ui["card-heading"]}>
        <h2>Income & expenses</h2>
        <span className={clsx(ui["subtle"], valueMask(cashFlow.status))}>{monthRangeLabel(months)}</span>
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
      <div {...areaProps(cashFlow.status, styles["bar-chart"])} role="img" aria-label={`Monthly income and expenses for ${bars.map(item => `${item.display.title}: Income ${money(item.income, currency)}, Expenses ${money(item.expenses, currency)}`).join("; ")}`}>
        <div className={styles["chart-grid"]}>
          <span />
          <span />
          <span />
          <span />
        </div>
        {bars.map(item => (
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
            <span>{item.display.label}</span>
          </div>
        ))}
      </div>
      {trend.every(item => item.income === 0 && item.expenses === 0) && <p className={clsx(styles["chart-empty-note"], valueMask(cashFlow.status))}>Your history appears here after the first import.</p>}
    </section>
  );
}

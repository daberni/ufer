"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId } from "react";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import styles from "./cash-flow-chart.module.css";
import { monthRangeLabel } from "@/features/dashboard/presentation";
import { groupSpending, type SpendingGroup } from "@/features/dashboard/spending-groups";
import { useMonthDetails } from "@/features/dashboard/use-month-details";
import { describeMonth } from "@/lib/date-format";
import { money } from "@/lib/money";
import { describeSpending, SpendingRows } from "@/features/dashboard/components/spending-rows";
import { areaProps, valueMask } from "@/features/dashboard/components/result-presentation";
import type { AreaResult } from "@/features/dashboard/use-area-result";
import type { CashFlow } from "@/features/dashboard/types";

type Props = {
  cashFlow: AreaResult<CashFlow>;
};

type MonthBar = {
  month: string;
  income: number;
  expenses: number;
  groups: SpendingGroup[];
  label: string;
  title: string;
};

export function CashFlowChart({ cashFlow }: Props) {
  const descriptionPrefix = useId();
  const {
    activeMonth,
    chartProps,
    monthProps
  } = useMonthDetails();
  const {
    currency,
    trend
  } = cashFlow.data;
  const trendMax = Math.max(1, ...trend.flatMap(item => [item.income, item.expenses]));
  const months = trend.map(item => Temporal.PlainYearMonth.from(item.month));
  const bars: MonthBar[] = trend.map((item, index) => {
    const display = describeMonth(months[index]);

    return {
      month: item.month,
      income: item.income,
      expenses: item.expenses,
      groups: groupSpending(item.breakdown),
      label: display.label,
      title: display.title
    };
  });
  const activeIndex = cashFlow.status === "ready" ? bars.findIndex(item => item.month === activeMonth) : -1;
  const activeBar = activeIndex >= 0 ? bars[activeIndex] : null;
  // The details cover the half of the chart away from the month they describe.
  const detailsSide = activeIndex >= bars.length / 2 ? "start" : "end";

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
          Expenses by category
        </span>
      </div>
      <div
        {...areaProps(cashFlow.status, styles["bar-chart"])}
        {...chartProps}
        role="group"
        aria-label={`Monthly income and expenses, ${monthRangeLabel(months)}`}
        data-active={activeBar ? "" : undefined}
      >
        <div className={styles["chart-grid"]} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        {bars.map(item => (
          <button
            type="button"
            className={styles["bar-group"]}
            key={item.month}
            aria-label={`${item.title}: income ${money(item.income, currency)}, expenses ${money(item.expenses, currency)}`}
            aria-describedby={`${descriptionPrefix}-${item.month}`}
            data-active={item.month === activeBar?.month ? "" : undefined}
            {...monthProps(item.month)}
          >
            <span className={styles["bars"]} aria-hidden="true">
              <span
                className={styles["income-bar"]}
                style={{
                  height: `${item.income / trendMax * 100}%`
                }}
              />
              <span
                className={styles["expense-bar"]}
                style={{
                  height: `${item.expenses / trendMax * 100}%`
                }}
              >
                {item.groups.map(group => (
                  <span
                    key={group.key}
                    style={{
                      height: `${group.share * 100}%`,
                      background: group.color
                    }}
                  />
                ))}
              </span>
            </span>
            <span className={styles["month-label"]} aria-hidden="true">{item.label}</span>
            <span id={`${descriptionPrefix}-${item.month}`} hidden>{`Spending by category: ${describeSpending(item.groups, currency)}`}</span>
          </button>
        ))}
        {activeBar && <MonthDetails bar={activeBar} currency={currency} side={detailsSide} />}
      </div>
      {trend.every(item => item.income === 0 && item.expenses === 0) && <p className={clsx(styles["chart-empty-note"], valueMask(cashFlow.status))}>Your history appears here after the first import.</p>}
    </section>
  );
}

type MonthDetailsProps = {
  bar: MonthBar;
  currency: string;
  side: "start" | "end";
};

// Visual only: each month button already describes the same breakdown to assistive technology.
function MonthDetails({
  bar,
  currency,
  side
}: MonthDetailsProps) {
  return (
    <div className={styles["month-details"]} data-side={side} aria-hidden="true">
      <div className={styles["details-heading"]}>
        <strong>{bar.title}</strong>
        <span>{`Income ${money(bar.income, currency)} · Expenses ${money(bar.expenses, currency)}`}</span>
      </div>
      {bar.groups.length ? <SpendingRows className={styles["details-rows"]} groups={bar.groups} currency={currency} /> : <p className={styles["details-empty"]}>No expenses this month.</p>}
    </div>
  );
}

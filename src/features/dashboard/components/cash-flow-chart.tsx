"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId } from "react";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import styles from "./cash-flow-chart.module.css";
import { monthRangeLabel } from "@/features/dashboard/presentation";
import { groupByCategory, type CategoryGroup } from "@/features/dashboard/category-groups";
import { useChartDetails } from "@/features/dashboard/use-chart-details";
import { describeMonth } from "@/lib/date-format";
import { money } from "@/lib/money";
import { CategoryRows, describeCategoryGroups } from "@/features/dashboard/components/category-rows";
import { areaProps, valueMask } from "@/features/dashboard/components/result-presentation";
import type { AreaResult } from "@/features/dashboard/use-area-result";
import type { CashFlow } from "@/features/dashboard/types";

type Props = {
  cashFlow: AreaResult<CashFlow>;
};

type Flow = "income" | "expenses";

const flowPresentation: Record<Flow, {
  label: string;
  breakdownLabel: string;
  empty: string;
}> = {
  income: {
    label: "Income",
    breakdownLabel: "Income by category",
    empty: "No income this month."
  },
  expenses: {
    label: "Expenses",
    breakdownLabel: "Spending by category",
    empty: "No expenses this month."
  }
};

type ChartBar = {
  key: string;
  flow: Flow;
  total: number;
  groups: CategoryGroup[];
};

type ChartMonth = {
  month: string;
  label: string;
  title: string;
  /** In the later half of the window; an overlay for it then covers the chart's start side. */
  late: boolean;
  bars: ChartBar[];
};

export function CashFlowChart({ cashFlow }: Props) {
  const descriptionPrefix = useId();
  const {
    activeKey,
    chartProps,
    targetProps
  } = useChartDetails();
  const {
    currency,
    trend
  } = cashFlow.data;
  const trendMax = Math.max(1, ...trend.flatMap(item => [item.income, item.expenses]));
  const months = trend.map(item => Temporal.PlainYearMonth.from(item.month));
  const chartMonths: ChartMonth[] = trend.map((item, index) => {
    const display = describeMonth(months[index]);

    return {
      month: item.month,
      label: display.label,
      title: display.title,
      late: index >= trend.length / 2,
      bars: [{
        key: `${item.month}-income`,
        flow: "income",
        total: item.income,
        groups: groupByCategory(item.incomeBreakdown)
      }, {
        key: `${item.month}-expenses`,
        flow: "expenses",
        total: item.expenses,
        groups: groupByCategory(item.expenseBreakdown)
      }]
    };
  });
  const shownKey = cashFlow.status === "ready" ? activeKey : null;
  const activeMonth = chartMonths.find(item => item.bars.some(bar => bar.key === shownKey));
  const activeBar = activeMonth?.bars.find(bar => bar.key === shownKey);
  const hasHistory = trend.some(item => item.income !== 0 || item.expenses !== 0);

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
      <div className={styles["plot"]} {...chartProps}>
        <div
          {...areaProps(cashFlow.status, styles["bar-chart"])}
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
          {chartMonths.map(item => (
            <div className={styles["bar-group"]} key={item.month} data-active={item === activeMonth ? "" : undefined}>
              <div className={styles["bars"]}>
                {item.bars.map(bar => {
                  const active = bar === activeBar;
                  const presentation = flowPresentation[bar.flow];
                  const descriptionId = `${descriptionPrefix}-${bar.key}`;

                  return (
                    <button
                      type="button"
                      className={styles["bar-target"]}
                      key={bar.key}
                      aria-label={`${item.title} ${presentation.label.toLowerCase()}: ${money(bar.total, currency)}`}
                      aria-describedby={descriptionId}
                      data-flow={bar.flow}
                      data-active={active ? "" : undefined}
                      {...targetProps(bar.key)}
                    >
                      <span
                        className={clsx(styles["bar"], bar.flow === "income" ? styles["income-bar"] : styles["expense-bar"])}
                        style={{
                          height: `${bar.total / trendMax * 100}%`
                        }}
                      >
                        {active && bar.groups.map(group => (
                          <span
                            key={group.key}
                            style={{
                              height: `${group.share * 100}%`,
                              background: group.color
                            }}
                          />
                        ))}
                      </span>
                      <span id={descriptionId} hidden>{`${presentation.breakdownLabel}: ${describeCategoryGroups(bar.groups, currency)}`}</span>
                    </button>
                  );
                })}
              </div>
              <span className={styles["month-label"]} aria-hidden="true">{item.label}</span>
            </div>
          ))}
        </div>
        {hasHistory && (
          <div className={styles["details-slot"]} data-side={activeMonth?.late ? "start" : "end"}>
            {activeMonth && activeBar ? <BarDetails month={activeMonth} bar={activeBar} currency={currency} /> : <p className={styles["details-hint"]}>Select a bar to see its categories.</p>}
          </div>
        )}
      </div>
      {!hasHistory && <p className={clsx(styles["chart-empty-note"], valueMask(cashFlow.status))}>Your history appears here after the first import.</p>}
    </section>
  );
}

type BarDetailsProps = {
  month: ChartMonth;
  bar: ChartBar;
  currency: string;
};

// Visual only: each bar button already describes the same breakdown to assistive technology. Wide layouts show it as an overlay on the chart, narrower ones in a fixed area below the bars.
function BarDetails({
  month,
  bar,
  currency
}: BarDetailsProps) {
  const presentation = flowPresentation[bar.flow];

  return (
    <div className={styles["bar-details"]} aria-hidden="true">
      <div className={styles["details-heading"]}>
        <strong>{month.title}</strong>
        <span>{`${presentation.label} ${money(bar.total, currency)}`}</span>
      </div>
      {bar.groups.length ? <CategoryRows groups={bar.groups} currency={currency} compact /> : <p className={styles["details-empty"]}>{presentation.empty}</p>}
    </div>
  );
}

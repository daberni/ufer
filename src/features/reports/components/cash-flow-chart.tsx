"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import styles from "./cash-flow-chart.module.css";
import { groupByCategory, type CategoryGroup } from "@/features/reports/category-groups";
import type { useChartDetails } from "@/features/reports/use-chart-details";
import { categoryBarColor, themedColor } from "@/features/categorization/category-colors";
import { describeMonth, monthRangeLabel } from "@/lib/date-format";
import { money } from "@/lib/money";
import { describeCategoryGroups } from "@/features/reports/components/category-rows";
import { areaProps, valueMask } from "@/components/ui/result-presentation";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { currentMonth, trendMonths } from "@/lib/period";
import { chartMonthCount, minimumChartMonths } from "@/features/reports/chart-months";
import { usePeriod } from "@/client/use-app-url";
import type { Area, AreaResult, PendingArea } from "@/components/ui/use-area-result";
import type { CashFlow } from "@/features/reports/types";
import { flowPresentation, type CashFlowDirection, type CashFlowSelection } from "@/features/reports/cash-flow-selection";

type Props = {
  cashFlow: Area<CashFlow>;
  selection: CashFlowSelection | null;
  targetProps: ReturnType<typeof useChartDetails>["targetProps"];
  detailsId: string;
};

type ChartBar = {
  key: string;
  flow: CashFlowDirection;
  total: number;
  groups: CategoryGroup[];
};

type ChartMonth = {
  month: string;
  label: string;
  title: string;
  bars: ChartBar[];
};

export function CashFlowChart({
  cashFlow,
  selection,
  targetProps,
  detailsId
}: Props) {
  const period = usePeriod();
  const plotRef = useRef<HTMLDivElement>(null);
  const monthCount = useChartMonthCount(plotRef);
  // The trend's months follow from the selected period, so the heading and month labels are known before the figures.
  const trend = cashFlow.status === "pending" ? trendMonths(period, currentMonth()) : cashFlow.data.trend.map(item => Temporal.PlainYearMonth.from(item.month));
  const months = trend.slice(-monthCount);
  const rangeMask = cashFlow.status === "pending" ? "" : valueMask(cashFlow.status);

  return (
    <section className={clsx(ui["panel"], styles["chart-panel"])}>
      <div className={ui["card-heading"]}>
        <h2>Income & expenses</h2>
        <span className={clsx(ui["subtle"], rangeMask)}>{monthRangeLabel(months)}</span>
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
      <div className={styles["plot"]} ref={plotRef}>
        {cashFlow.status === "pending" ? <ChartSkeleton area={cashFlow} months={months} /> : (
          <ChartPlot
            cashFlow={cashFlow}
            months={months}
            selection={selection}
            targetProps={targetProps}
            detailsId={detailsId}
          />
        )}
      </div>
    </section>
  );
}

/** How many of the latest months fit the plot's current width, measured before paint so a resize never shows a squeezed chart. */
function useChartMonthCount(plotRef: RefObject<HTMLDivElement | null>) {
  const [count, setCount] = useState(minimumChartMonths);

  useLayoutEffect(() => {
    const plot = plotRef.current;

    if (!plot) {
      return;
    }

    const measure = () => setCount(chartMonthCount(plot.clientWidth));
    const observer = new ResizeObserver(measure);

    measure();
    observer.observe(plot);

    return () => observer.disconnect();
  }, [plotRef]);

  return count;
}

// Relative bar heights of the skeleton: income and expenses for each month of the trend.
const skeletonBars = [[0.55, 0.4], [0.7, 0.5], [0.45, 0.6], [0.8, 0.55], [0.6, 0.35], [0.75, 0.65]];

function ChartSkeleton({
  area,
  months
}: {
  area: PendingArea;
  months: Temporal.PlainYearMonth[];
}) {
  return (
    <AreaPlaceholder area={area} subject="Income and expenses">
      <div className={styles["bar-chart"]}>
        <div className={styles["chart-grid"]}>
          <span />
          <span />
          <span />
          <span />
        </div>
        {months.map((month, index) => (
          <div className={styles["bar-group"]} key={month.toString()}>
            <div className={styles["bars"]}>
              {skeletonBars[index % skeletonBars.length].map((height, bar) => (
                <span className={styles["bar-target"]} data-flow={bar === 0 ? "income" : "expenses"} key={bar}>
                  <span
                    className={clsx(styles["bar"], ui["skeleton"])}
                    style={{
                      height: `${height * 100}%`
                    }}
                  />
                </span>
              ))}
            </div>
            <span className={styles["month-label"]}>{describeMonth(month).label}</span>
          </div>
        ))}
      </div>
    </AreaPlaceholder>
  );
}

function ChartPlot({
  cashFlow,
  months,
  selection,
  targetProps,
  detailsId
}: Omit<Props, "cashFlow"> & {
  cashFlow: AreaResult<CashFlow>;
  months: Temporal.PlainYearMonth[];
}) {
  const descriptionPrefix = useId();
  const {
    currency
  } = cashFlow.data;
  // The chart shows the latest of the trend's months that fit its width.
  const trend = cashFlow.data.trend.slice(-months.length);
  const trendMax = Math.max(1, ...trend.flatMap(item => [item.income, item.expenses]));
  const chartMonths: ChartMonth[] = trend.map((item, index) => {
    const display = describeMonth(months[index]);

    return {
      month: item.month,
      label: display.label,
      title: display.title,
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
  const shownKey = selection?.key ?? null;
  const activeMonth = chartMonths.find(item => item.bars.some(bar => bar.key === shownKey));
  const activeBar = activeMonth?.bars.find(bar => bar.key === shownKey);
  const hasHistory = trend.some(item => item.income !== 0 || item.expenses !== 0);

  return (
    <>
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
                    aria-controls={detailsId}
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
                            background: themedColor(scheme => categoryBarColor(group.color, scheme))
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
      {!hasHistory && <p className={clsx(styles["chart-empty-note"], valueMask(cashFlow.status))}>Your history appears here after the first import.</p>}
    </>
  );
}

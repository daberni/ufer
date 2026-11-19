"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
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
import { barSpan, cashFlowScale, scaleOffset, type CashFlowScale } from "@/features/reports/cash-flow-scale";
import { formatSavingsRate, netFlow, trendCashFlow, type CashFlowSelection } from "@/features/reports/cash-flow-selection";

type Props = {
  cashFlow: Area<CashFlow>;
  selection: CashFlowSelection | null;
  targetProps: ReturnType<typeof useChartDetails>["targetProps"];
  detailsId: string;
};

type Flow = "income" | "expenses";

type ChartMonth = {
  month: string;
  label: string;
  title: string;
  income: number;
  expenses: number;
  net: number;
  savingsRate: number | null;
  incomeGroups: CategoryGroup[];
  expenseGroups: CategoryGroup[];
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
  const rateMask = cashFlow.status === "pending" ? ui["skeleton"] : rangeMask;
  // The rate covers exactly the months the chart shows.
  const visibleRate = cashFlow.status === "pending" ? null : trendCashFlow(cashFlow.data.trend.slice(-months.length)).savingsRate;

  return (
    <section className={clsx(ui["panel"], styles["chart-panel"])}>
      <div className={ui["card-heading"]}>
        <h2>Income & expenses</h2>
        <span className={clsx(ui["subtle"], rangeMask)}>{monthRangeLabel(months)}</span>
      </div>
      <div className={styles["chart-legend"]}>
        <span>
          <i className={clsx(styles["legend-dot"], styles["income-dot"])} />
          Income
        </span>
        <span>
          <i className={clsx(styles["legend-dot"], styles["expense-dot"])} />
          Expenses
        </span>
        <span>
          <i className={styles["legend-line"]} />
          Net
        </span>
        <span className={styles["savings-rate"]}>
          Savings rate <strong className={rateMask}>{formatSavingsRate(visibleRate)}</strong>
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

function percent(value: number) {
  return `${value * 100}%`;
}

/** A flow's bar from the zero line: income upward and expenses downward, each reversed when its amount is negative. */
function signedAmount(flow: Flow, amount: number) {
  return flow === "income" ? amount : -amount;
}

function barPosition(flow: Flow, amount: number, scale: CashFlowScale): CSSProperties {
  const span = barSpan(signedAmount(flow, amount), scale);

  return {
    top: percent(span.top),
    height: percent(span.height)
  };
}

function ZeroLine({ scale }: {
  scale: CashFlowScale;
}) {
  return (
    <span className={styles["plot-area"]} aria-hidden="true">
      <span
        className={styles["zero-line"]}
        style={{
          top: percent(scale.zero)
        }}
      />
    </span>
  );
}

// Relative income and expense heights of the skeleton for each month of the trend.
const skeletonFlows = [[0.55, 0.4], [0.7, 0.5], [0.45, 0.6], [0.8, 0.55], [0.6, 0.35], [0.75, 0.65]];

function ChartSkeleton({
  area,
  months
}: {
  area: PendingArea;
  months: Temporal.PlainYearMonth[];
}) {
  const scale = {
    zero: 0.5,
    extent: 2
  };

  return (
    <AreaPlaceholder area={area} subject="Income and expenses">
      <div className={styles["bar-chart"]}>
        <ZeroLine scale={scale} />
        {months.map((month, index) => {
          const [income, expenses] = skeletonFlows[index % skeletonFlows.length];

          return (
            <div className={styles["month"]} key={month.toString()}>
              <span className={styles["bars"]}>
                <span className={clsx(styles["bar"], ui["skeleton"])} style={barPosition("income", income, scale)} />
                <span className={clsx(styles["bar"], ui["skeleton"])} style={barPosition("expenses", expenses, scale)} />
              </span>
              <span className={styles["month-label"]}>{describeMonth(month).label}</span>
            </div>
          );
        })}
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
  const scale = cashFlowScale(trend);
  const chartMonths: ChartMonth[] = trend.map((item, index) => {
    const display = describeMonth(months[index]);

    return {
      month: item.month,
      label: display.label,
      title: display.title,
      income: item.income,
      expenses: item.expenses,
      ...netFlow(item.income, item.expenses),
      incomeGroups: groupByCategory(item.incomeBreakdown),
      expenseGroups: groupByCategory(item.expenseBreakdown)
    };
  });
  const activeMonth = chartMonths.find(item => item.month === selection?.month);
  const hasHistory = trend.some(item => item.income !== 0 || item.expenses !== 0);
  // Month columns share the width equally, so their centres lie at even steps of a 0–100 coordinate space that stretches with the plot.
  const netPoints = chartMonths.map((item, index) => `${(index + 0.5) / chartMonths.length * 100},${scaleOffset(item.net, scale) * 100}`).join(" ");

  return (
    <>
      <div
        {...areaProps(cashFlow.status, styles["bar-chart"])}
        role="group"
        aria-label={`Monthly income, expenses and net, ${monthRangeLabel(months)}`}
        data-active={activeMonth ? "" : undefined}
      >
        <ZeroLine scale={scale} />
        {hasHistory && (
          <span className={styles["plot-area"]} aria-hidden="true">
            <svg className={styles["net-line"]} viewBox="0 0 100 100" preserveAspectRatio="none">
              {/* A halo in the panel colour keeps the line legible where it crosses bars. */}
              <polyline className={styles["net-halo"]} points={netPoints} vectorEffect="non-scaling-stroke" />
              <polyline points={netPoints} vectorEffect="non-scaling-stroke" />
            </svg>
          </span>
        )}
        {chartMonths.map(item => {
          const active = item === activeMonth;
          const descriptionId = `${descriptionPrefix}-${item.month}`;
          const description = `Income by category: ${describeCategoryGroups(item.incomeGroups, currency)} Spending by category: ${describeCategoryGroups(item.expenseGroups, currency)}`;

          return (
            <button
              type="button"
              className={styles["month"]}
              key={item.month}
              aria-label={`${item.title}: income ${money(item.income, currency)}, expenses ${money(item.expenses, currency)}, net ${money(item.net, currency)}, savings rate ${formatSavingsRate(item.savingsRate)}`}
              aria-describedby={descriptionId}
              aria-controls={detailsId}
              data-active={active ? "" : undefined}
              {...targetProps(item.month)}
            >
              <span className={styles["bars"]}>
                <FlowBar
                  flow="income"
                  shared={sharesDirection(item)}
                  amount={item.income}
                  groups={active ? item.incomeGroups : []}
                  scale={scale}
                />
                <FlowBar
                  flow="expenses"
                  shared={sharesDirection(item)}
                  amount={item.expenses}
                  groups={active ? item.expenseGroups : []}
                  scale={scale}
                />
                {hasHistory && (
                  <span
                    className={styles["net-point"]}
                    style={{
                      top: percent(scaleOffset(item.net, scale))
                    }}
                  />
                )}
              </span>
              <span className={styles["month-label"]}>{item.label}</span>
              <span id={descriptionId} hidden>{description}</span>
            </button>
          );
        })}
      </div>
      {!hasHistory && <p className={clsx(styles["chart-empty-note"], valueMask(cashFlow.status))}>Your history appears here after the first import.</p>}
    </>
  );
}

/** Whether a month's income and expense bars extend to the same side of the zero line, as when refunds exceed spending; they are then drawn next to each other instead of on top of each other. */
function sharesDirection(month: {
  income: number;
  expenses: number;
}) {
  return month.income * -month.expenses > 0;
}

/** A month's income above or expenses below the zero line (reversed for a negative amount); while its month is selected, a positive total splits into category segments stacked outward from the zero line. */
function FlowBar({
  flow,
  shared,
  amount,
  groups,
  scale
}: {
  flow: Flow;
  shared: boolean;
  amount: number;
  groups: CategoryGroup[];
  scale: CashFlowScale;
}) {
  if (amount === 0) {
    return null;
  }

  const direction = signedAmount(flow, amount) > 0 ? "up" : "down";
  // The category breakdown only lists categories with a positive amount, so it cannot split a negative total correctly.
  const segments = amount > 0 ? groups : [];

  return (
    <span
      className={clsx(styles["bar"], flow === "income" ? styles["income-bar"] : styles["expense-bar"])}
      data-flow={flow}
      data-direction={direction}
      data-shared={shared ? "" : undefined}
      style={barPosition(flow, amount, scale)}
    >
      {segments.map(group => (
        <span
          key={group.key}
          style={{
            height: percent(group.share),
            background: themedColor(scheme => categoryBarColor(group.color, scheme))
          }}
        />
      ))}
    </span>
  );
}

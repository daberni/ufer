"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
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
import { useMonthTransactionsHref, usePeriod } from "@/client/use-app-url";
import type { Area, AreaResult, PendingArea } from "@/components/ui/use-area-result";
import type { CashFlow } from "@/features/reports/types";
import { barSpan, cashFlowScale, scaleOffset, type CashFlowScale } from "@/features/reports/cash-flow-scale";
import { edgeNet, formatSavingsRate, isNegativeRate, netFlow, trendCashFlow, type CashFlowSelection } from "@/features/reports/cash-flow-selection";

type Props = {
  cashFlow: Area<CashFlow>;
  selection: CashFlowSelection | null;
  targetProps: ReturnType<typeof useChartDetails>["targetProps"];
  detailsId: string;
  /** Called when the selected month is no longer among the months that fit, so the panel does not describe a hidden month. */
  onSelectionHidden: () => void;
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
  detailsId,
  onSelectionHidden
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
      <div className={clsx(ui["card-heading"], styles["heading"])}>
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
          <i className={styles["legend-area"]} />
          Net
        </span>
        <span className={styles["savings-rate"]}>
          Savings rate <strong className={clsx(isNegativeRate(visibleRate) && styles["negative"], rateMask)}>{formatSavingsRate(visibleRate)}</strong>
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
            onSelectionHidden={onSelectionHidden}
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

/** Each bar is anchored at the zero line, so a minimum height for tiny bars grows away from it. */
function barPosition(flow: Flow, amount: number, scale: CashFlowScale): CSSProperties {
  const signed = signedAmount(flow, amount);
  const span = barSpan(signed, scale);

  if (signed > 0) {
    return {
      bottom: percent(1 - scale.zero),
      height: percent(span.height)
    };
  }

  return {
    top: percent(scale.zero),
    height: percent(span.height)
  };
}

function ZeroLine({ scale }: {
  scale: CashFlowScale;
}) {
  const lineRef = useRef<HTMLSpanElement>(null);

  useDevicePixelTop(lineRef, scale.zero);

  return (
    <span className={clsx(styles["plot-area"], styles["zero-layer"])} aria-hidden="true">
      <span
        className={styles["zero-line"]}
        ref={lineRef}
        style={{
          top: percent(scale.zero)
        }}
      />
    </span>
  );
}

/** Places a hairline (one device pixel tall) at a fraction of its container's height, rounded to a device pixel row, so it is drawn crisp and identical over everything beneath it. */
function useDevicePixelTop(lineRef: RefObject<HTMLSpanElement | null>, fraction: number) {
  useLayoutEffect(() => {
    const line = lineRef.current;
    const container = line?.parentElement;

    if (!line || !container) {
      return;
    }

    const place = () => {
      const ratio = window.devicePixelRatio || 1;
      const box = container.getBoundingClientRect();
      const target = Math.round((box.top + fraction * box.height) * ratio) / ratio;

      line.style.top = `${target - box.top}px`;
      line.style.height = `${1 / ratio}px`;
    };
    const observer = new ResizeObserver(place);

    place();
    observer.observe(container);
    window.addEventListener("scroll", place, {
      passive: true
    });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", place);
    };
  }, [lineRef, fraction]);
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
  detailsId,
  onSelectionHidden
}: Omit<Props, "cashFlow"> & {
  cashFlow: AreaResult<CashFlow>;
  months: Temporal.PlainYearMonth[];
}) {
  const descriptionPrefix = useId();
  const clipPrefix = useId();
  const router = useRouter();
  const monthTransactionsHref = useMonthTransactionsHref();
  const {
    currency
  } = cashFlow.data;
  // The chart shows the latest of the trend's months that fit its width.
  const trend = cashFlow.data.trend.slice(-months.length);
  const leftEdgeNet = edgeNet(cashFlow.data, trend.length);
  const scale = cashFlowScale(trend, leftEdgeNet === null ? [] : [leftEdgeNet]);
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
  const selectionHidden = selection !== null && activeMonth === undefined;

  useEffect(() => {
    if (selectionHidden) {
      onSelectionHidden();
    }
  }, [selectionHidden, onSelectionHidden]);
  const hasHistory = trend.some(item => item.income !== 0 || item.expenses !== 0);
  // Month columns share the width equally, so their centres lie at even steps of a 0–100 coordinate space that stretches with the plot.
  const centre = (index: number) => (index + 0.5) / chartMonths.length * 100;
  const zero = scale.zero * 100;
  const monthPoints = chartMonths.map((item, index) => `${centre(index)},${scaleOffset(item.net, scale) * 100}`);
  // The area starts at the left edge on the way from the previous month's net, so it reads as continuing beyond the visible months; it ends at the last month, after which there is no data.
  const startX = leftEdgeNet === null ? centre(0) : 0;
  const netPoints = [...leftEdgeNet === null ? [] : [`0,${scaleOffset(leftEdgeNet, scale) * 100}`], ...monthPoints].join(" ");
  // The area closes along the zero line; clipping splits it into a surplus tone above and a deficit tone below.
  const netArea = `${startX},${zero} ${netPoints} ${centre(chartMonths.length - 1)},${zero}`;
  const surplusClip = `${clipPrefix}-surplus`;
  const deficitClip = `${clipPrefix}-deficit`;

  return (
    <>
      <div
        {...areaProps(cashFlow.status, styles["bar-chart"])}
        role="group"
        aria-label={`Monthly income, expenses and net, ${monthRangeLabel(months)}`}
        data-active={activeMonth ? "" : undefined}
      >
        {/* The selected month's column is highlighted behind the net area, so the area stays continuous across all months. */}
        {activeMonth && (
          <span
            className={styles["column-highlight"]}
            aria-hidden="true"
            style={{
              left: percent(chartMonths.indexOf(activeMonth) / chartMonths.length),
              width: percent(1 / chartMonths.length)
            }}
          />
        )}
        {hasHistory && (
          <span className={styles["plot-area"]} aria-hidden="true">
            <svg className={styles["net-area"]} viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <clipPath id={surplusClip}>
                  <rect
                    x="0"
                    y="0"
                    width="100"
                    height={zero}
                  />
                </clipPath>
                <clipPath id={deficitClip}>
                  <rect
                    x="0"
                    y={zero}
                    width="100"
                    height={100 - zero}
                  />
                </clipPath>
              </defs>
              <polygon className={styles["net-surplus"]} points={netArea} clipPath={`url(#${surplusClip})`} />
              <polygon className={styles["net-deficit"]} points={netArea} clipPath={`url(#${deficitClip})`} />
              <polyline className={styles["net-outline"]} points={netPoints} vectorEffect="non-scaling-stroke" />
            </svg>
          </span>
        )}
        {/* Drawn after the highlight and the net area, so the zero line runs uninterrupted beneath the bars. */}
        <ZeroLine scale={scale} />
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
              {...targetProps(item.month, () => router.push(monthTransactionsHref(item.month)))}
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
                {active && (
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

/** Segments show the categories of a positive total only when every category is positive: negative categories (corrections or net refunds) reduce the total, and stacking the others would overstate it. */
function splitsIntoSegments(amount: number, groups: CategoryGroup[]) {
  const shareSum = groups.reduce((sum, group) => sum + group.share, 0);

  return amount > 0 && groups.every(group => group.amount > 0) && Math.abs(shareSum - 1) < 1e-9;
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
  const segments = splitsIntoSegments(amount, groups) ? groups : [];

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

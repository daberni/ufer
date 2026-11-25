"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useEffect, useId, useRef } from "react";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import styles from "../../reports/components/cash-flow-chart.module.css";
import own from "./insights-chart.module.css";
import { FlowBar, sharesDirection, useChartMonthCount, useDevicePixelRatioProperty, ZeroLine } from "@/features/reports/components/cash-flow-chart";
import { describeCategoryGroups } from "@/features/reports/components/category-rows";
import { groupByCategory } from "@/features/reports/category-groups";
import { cashFlowScale, scaleOffset } from "@/features/reports/cash-flow-scale";
import { formatSavingsRate, isNegativeRate, netFlow } from "@/features/reports/cash-flow-selection";
import { skeletonMonthBreakpoints } from "@/features/reports/chart-months";
import type { useChartDetails } from "@/features/reports/use-chart-details";
import { columnRanges, insightsColumns, type InsightsColumn } from "@/features/insights/insights-columns";
import { columnsLabel, rangeLabel, rangeTitle } from "@/features/insights/range-format";
import { selectRange } from "@/features/insights/insights-location";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { areaProps, valueMask } from "@/components/ui/result-presentation";
import { money } from "@/lib/money";
import { cssPercent } from "@/lib/percent";
import { useLocale } from "@/client/locale-provider";
import type { Area, AreaResult } from "@/components/ui/use-area-result";
import type { PeriodRange } from "@/lib/period-range";
import type { Insights } from "@/features/insights/types";

type Props = {
  range: PeriodRange;
  insights: Area<Insights>;
  activeKey: string | null;
  targetProps: ReturnType<typeof useChartDetails>["targetProps"];
  detailsId: string;
  /** Called when the active column is no longer among the columns that fit, so the breakdown does not describe a hidden column. */
  onSelectionHidden: () => void;
};

/**
 * The overview's income and expenses panel with one column per interval of the selected range: the range itself rightmost and highlighted, the intervals before it as comparison. Hovering, focusing or tapping a column shows its categories beside it; activating it selects that interval.
 */
export function InsightsChart({
  range,
  insights,
  activeKey,
  targetProps,
  detailsId,
  onSelectionHidden
}: Props) {
  const t = useTranslations("reports.chart");
  const locale = useLocale();
  const plotRef = useRef<HTMLDivElement>(null);
  const count = useChartMonthCount(plotRef);
  const ranges = columnRanges(range).slice(-count);
  const rangeMask = insights.status === "pending" ? "" : valueMask(insights.status);
  const visible = insights.status === "pending" ? [] : insightsColumns(insights.data).slice(-count);
  const visibleRate = insights.status === "pending" ? null : netFlow(visible.reduce((sum, column) => sum + column.income, 0), visible.reduce((sum, column) => sum + column.expenses, 0)).savingsRate;
  const rateMask = insights.status === "pending" ? ui["skeleton"] : rangeMask;

  return (
    <section className={clsx(ui["panel"], styles["chart-panel"], own["chart"])}>
      <div className={clsx(ui["card-heading"], styles["heading"])}>
        <div className={styles["title"]}>
          <h2>{t("title")}</h2>
          <span className={clsx(ui["subtle"], rangeMask)}>{columnsLabel(ranges, locale)}</span>
        </div>
      </div>
      <div className={styles["chart-legend"]}>
        <span>
          <i className={clsx(styles["legend-dot"], styles["income-dot"])} />
          {t("income")}
        </span>
        <span>
          <i className={clsx(styles["legend-dot"], styles["expense-dot"])} />
          {t("expenses")}
        </span>
        <span>
          <i className={styles["legend-area"]} />
          {t("net")}
        </span>
        <span className={styles["savings-rate"]}>
          {t("savingsRate")} <strong className={clsx(isNegativeRate(visibleRate, locale) && styles["negative"], rateMask)}>{formatSavingsRate(visibleRate, locale)}</strong>
        </span>
      </div>
      <div className={styles["plot"]} ref={plotRef}>
        {insights.status === "pending" ? (
          <AreaPlaceholder area={insights} failureTitle={t("failure")}>
            <ChartSkeleton ranges={columnRanges(range)} />
          </AreaPlaceholder>
        ) : (
          <ChartPlot
            insights={insights}
            columns={visible}
            activeKey={activeKey}
            targetProps={targetProps}
            detailsId={detailsId}
            onSelectionHidden={onSelectionHidden}
          />
        )}
      </div>
    </section>
  );
}

// The skeleton lays out every column and these container queries show the ones that fit, so it matches the loaded chart before the page's script measures the width.
const skeletonColumnStyles = skeletonMonthBreakpoints().map(({
  belowWidth,
  hiddenMonths
}) => `@container (width < ${belowWidth}px) { [data-skeleton-months] > :nth-child(-n + ${hiddenMonths} of .${styles["month"]}) { display: none; } }`).join("\n");

const skeletonFlows = [[0.55, 0.4], [0.7, 0.5], [0.45, 0.6], [0.8, 0.55], [0.6, 0.35], [0.75, 0.65]];

function ChartSkeleton({ ranges }: {
  ranges: PeriodRange[];
}) {
  const locale = useLocale();
  const scale = {
    zero: 0.5,
    extent: 2
  };

  return (
    <div className={styles["bar-chart"]} data-skeleton-months>
      <style>{skeletonColumnStyles}</style>
      <ZeroLine scale={scale} />
      {ranges.map((columnRange, index) => {
        const [income, expenses] = skeletonFlows[index % skeletonFlows.length];

        return (
          <div className={styles["month"]} key={columnRange.start.toString()} data-current={index === ranges.length - 1 ? "" : undefined}>
            <span className={styles["bars"]}>
              <span
                className={clsx(styles["bar"], ui["skeleton"])}
                style={{
                  bottom: "50%",
                  height: cssPercent(income / 2)
                }}
              />
              <span
                className={clsx(styles["bar"], ui["skeleton"])}
                style={{
                  top: "50%",
                  height: cssPercent(expenses / 2)
                }}
              />
            </span>
            <span className={styles["month-label"]}>{rangeLabel(columnRange, locale)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ChartPlot({
  insights,
  columns,
  activeKey,
  targetProps,
  detailsId,
  onSelectionHidden
}: Omit<Props, "insights" | "range"> & {
  insights: AreaResult<Insights>;
  columns: InsightsColumn[];
}) {
  const t = useTranslations("insights.chart");
  const tCategories = useTranslations("reports.categories");
  const tReports = useTranslations("reports.chart");
  const locale = useLocale();
  const groupWords = {
    none: tCategories("none"),
    more: (count: string) => tCategories("more", {
      count
    })
  };
  const descriptionPrefix = useId();
  const clipPrefix = useId();
  const chartRef = useDevicePixelRatioProperty();
  const { currency } = insights.data;
  const scale = cashFlowScale(columns);
  const selectedKey = columns.at(-1)?.key;
  const activeColumn = columns.find(column => column.key === activeKey);
  const selectionHidden = activeKey !== null && activeColumn === undefined;

  useEffect(() => {
    if (selectionHidden) {
      onSelectionHidden();
    }
  }, [selectionHidden, onSelectionHidden]);

  const hasFlows = columns.some(column => column.income !== 0 || column.expenses !== 0);
  const centre = (index: number) => (index + 0.5) / columns.length * 100;
  const zero = scale.zero * 100;
  const nets = columns.map(column => netFlow(column.income, column.expenses));
  const netPoints = nets.map((net, index) => `${centre(index)},${scaleOffset(net.net, scale) * 100}`).join(" ");
  const netArea = `${centre(0)},${zero} ${netPoints} ${centre(columns.length - 1)},${zero}`;
  const surplusClip = `${clipPrefix}-surplus`;
  const deficitClip = `${clipPrefix}-deficit`;
  const interval = columns[0]?.range.interval ?? "month";

  return (
    <>
      <div
        {...areaProps(insights.status, styles["bar-chart"])}
        ref={chartRef}
        role="group"
        aria-label={t("plotLabel", {
          interval: t(`intervals.${interval}`),
          range: columnsLabel(columns.map(column => column.range), locale)
        })}
        data-active={activeColumn ? "" : undefined}
      >
        {activeColumn && (
          <span
            className={styles["column-highlight"]}
            aria-hidden="true"
            style={{
              left: cssPercent(columns.indexOf(activeColumn) / columns.length),
              width: cssPercent(1 / columns.length)
            }}
          />
        )}
        {hasFlows && (
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
        <ZeroLine scale={scale} />
        {columns.map((column, index) => {
          const active = column === activeColumn;
          const selected = column.key === selectedKey;
          const incomeGroups = groupByCategory(column.incomeBreakdown);
          const expenseGroups = groupByCategory(column.expenseBreakdown);
          const descriptionId = `${descriptionPrefix}-${column.key}`;
          const figures = {
            period: rangeTitle(column.range, locale),
            income: money(column.income, currency, locale),
            expenses: money(column.expenses, currency, locale),
            net: money(nets[index].net, currency, locale),
            rate: formatSavingsRate(nets[index].savingsRate, locale)
          };

          return (
            <button
              type="button"
              className={styles["month"]}
              key={column.key}
              aria-label={selected ? t("selectedColumnLabel", figures) : t("columnLabel", figures)}
              aria-describedby={descriptionId}
              aria-controls={detailsId}
              data-active={active ? "" : undefined}
              data-current={selected ? "" : undefined}
              {...targetProps(column.key, () => selectRange(column.range))}
            >
              <span className={styles["bars"]}>
                <FlowBar
                  flow="income"
                  shared={sharesDirection(column)}
                  amount={column.income}
                  groups={active ? incomeGroups : []}
                  scale={scale}
                />
                <FlowBar
                  flow="expenses"
                  shared={sharesDirection(column)}
                  amount={column.expenses}
                  groups={active ? expenseGroups : []}
                  scale={scale}
                />
                {active && (
                  <span
                    className={styles["net-point"]}
                    style={{
                      top: cssPercent(scaleOffset(nets[index].net, scale))
                    }}
                  />
                )}
              </span>
              <span className={styles["month-label"]}>{rangeLabel(column.range, locale)}</span>
              <span id={descriptionId} hidden>{tReports("monthDescription", {
                income: describeCategoryGroups(incomeGroups, currency, locale, groupWords),
                expenses: describeCategoryGroups(expenseGroups, currency, locale, groupWords)
              })}</span>
            </button>
          );
        })}
      </div>
      {!hasFlows && <p className={clsx(styles["chart-empty-note"], valueMask(insights.status))}>{tReports("empty")}</p>}
    </>
  );
}

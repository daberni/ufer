"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useEffect, useId, useRef } from "react";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import styles from "../../reports/components/cash-flow-chart.module.css";
import own from "./insights-chart.module.css";
import { ChartHeading, ChartSkeleton, ColumnBars, NetArea, usePlotColumns, useDevicePixelRatioProperty, ZeroLine } from "@/features/reports/components/cash-flow-chart";
import { describeCategoryGroups } from "@/features/reports/components/category-rows";
import { groupByCategory } from "@/features/reports/category-groups";
import { cashFlowScale } from "@/features/reports/cash-flow-scale";
import { formatSavingsRate, netFlow } from "@/features/reports/cash-flow-selection";
import type { useChartDetails } from "@/features/reports/use-chart-details";
import { columnRanges, insightsColumns, type InsightsColumn } from "@/features/insights/insights-columns";
import { columnsLabel, rangeLabel, rangeTitle } from "@/features/insights/range-format";
import { selectRange } from "@/features/insights/insights-location";
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
 * The overview's income and expenses panel with one column per interval of the selected range: the range itself rightmost and highlighted, as many intervals before it as fit. Hovering, focusing or tapping a column shows its categories beside it; activating it selects that interval.
 */
export function InsightsChart({
  range,
  insights,
  activeKey,
  targetProps,
  detailsId,
  onSelectionHidden
}: Props) {
  const locale = useLocale();
  const plotRef = useRef<HTMLDivElement>(null);
  const { count } = usePlotColumns(plotRef);
  const ranges = columnRanges(range);
  const visible = insights.status === "pending" ? [] : insightsColumns(insights.data).slice(-count);
  const rangeMask = insights.status === "pending" ? "" : valueMask(insights.status);
  const rateMask = insights.status === "pending" ? ui["skeleton"] : rangeMask;
  const visibleRate = netFlow(visible.reduce((sum, column) => sum + column.income, 0), visible.reduce((sum, column) => sum + column.expenses, 0)).savingsRate;

  return (
    <section className={clsx(ui["panel"], styles["chart-panel"], own["chart"])}>
      <ChartHeading
        range={columnsLabel(ranges.slice(-count), locale)}
        rangeMask={rangeMask}
        rate={insights.status === "pending" ? null : visibleRate}
        rateMask={rateMask}
      />
      <div className={styles["plot"]} ref={plotRef}>
        {insights.status === "pending" ? (
          <ChartSkeleton
            area={insights}
            columns={ranges.map((columnRange, index) => ({
              key: columnRange.start.toString(),
              label: rangeLabel(columnRange, locale),
              current: index === ranges.length - 1
            }))}
          />
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
  const nets = columns.map(column => netFlow(column.income, column.expenses));
  const interval = columns[0]?.range.interval ?? "month";

  return (
    <>
      {/* The overview's scroll viewport, so the plot lays out like the overview's; the columns always fit, so it never scrolls. */}
      <div className={styles["viewport"]}>
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
          {hasFlows && <NetArea nets={nets.map(net => net.net)} leftEdgeNet={null} scale={scale} />}
          <ZeroLine scale={scale} />
          {columns.map((column, index) => {
            const incomeGroups = groupByCategory(column.incomeBreakdown);
            const expenseGroups = groupByCategory(column.expenseBreakdown);
            const descriptionId = `${descriptionPrefix}-${column.key}`;
            const selected = column.key === selectedKey;
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
                data-active={column === activeColumn ? "" : undefined}
                data-current={selected ? "" : undefined}
                {...targetProps(column.key, () => selectRange(column.range))}
              >
                <ColumnBars
                  column={{
                    income: column.income,
                    expenses: column.expenses,
                    net: nets[index].net
                  }}
                  incomeGroups={incomeGroups}
                  expenseGroups={expenseGroups}
                  active={column === activeColumn}
                  scale={scale}
                />
                <span className={styles["month-label"]}>{rangeLabel(column.range, locale)}</span>
                <span id={descriptionId} hidden>{tReports("monthDescription", {
                  income: describeCategoryGroups(incomeGroups, currency, locale, groupWords),
                  expenses: describeCategoryGroups(expenseGroups, currency, locale, groupWords)
                })}</span>
              </button>
            );
          })}
        </div>
      </div>
      {!hasFlows && <p className={clsx(styles["chart-empty-note"], valueMask(insights.status))}>{tReports("empty")}</p>}
    </>
  );
}

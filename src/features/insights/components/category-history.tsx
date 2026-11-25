"use client";

import ui from "../../../components/ui/primitives.module.css";

import { useId, useRef, useState } from "react";
import { clsx } from "clsx";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import chart from "../../reports/components/cash-flow-chart.module.css";
import panel from "../../transactions/components/transactions-panel.module.css";
import styles from "./category-history.module.css";
import { ChartSkeleton, ColumnBars, usePlotColumns, useDevicePixelRatioProperty, ZeroLine } from "@/features/reports/components/cash-flow-chart";
import { TransactionPagination } from "@/features/transactions/components/transactions-panel";
import { TransactionList, TransactionListSkeleton } from "@/features/transactions/components/transaction-list";
import { TransactionRuleProvider } from "@/features/transactions/components/transaction-rule-provider";
import { CategoryLabel } from "@/features/categorization/components/category-label";
import { useCategories } from "@/features/categorization/queries";
import { groupByCategory } from "@/features/reports/category-groups";
import { cashFlowScale, scaleOffset } from "@/features/reports/cash-flow-scale";
import { useChartDetails } from "@/features/reports/use-chart-details";
import { averageAmount, categoryHistory, historyCategory, type HistoryColumn, type HistoryFlow } from "@/features/insights/category-history";
import { columnRanges, insightsColumns } from "@/features/insights/insights-columns";
import { columnsLabel, rangeLabel, rangeTitle } from "@/features/insights/range-format";
import { clearCategory, selectRange } from "@/features/insights/insights-location";
import { useCategoryTransactions } from "@/features/insights/queries";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { Empty } from "@/components/ui/empty-state";
import { areaProps, valueMask } from "@/components/ui/result-presentation";
import { pendingTogether, useAreaResult, type Area } from "@/components/ui/use-area-result";
import { money } from "@/lib/money";
import { cssPercent } from "@/lib/percent";
import { transactionPageSize } from "@/lib/pagination";
import { useLocale } from "@/client/locale-provider";
import { useCurrency } from "@/client/use-app-url";
import type { PeriodRange } from "@/lib/period-range";
import type { Category } from "@/features/categorization/types";
import type { CategoryAmount } from "@/features/reports/types";
import type { Insights } from "@/features/insights/types";

type Props = {
  range: PeriodRange;
  insights: Area<Insights>;
  category: string;
  flow: HistoryFlow;
};

/** One category's income or expenses per interval up to the selected range, their average and the range's matching transactions. */
export function CategoryHistory({
  range,
  insights,
  category,
  flow
}: Props) {
  const categories = useAreaResult(useCategories());

  return (
    <>
      <HistoryChart
        range={range}
        insights={insights}
        category={category}
        flow={flow}
        categories={categories.data ?? []}
      />
      {/* A new range or category starts at the first page of its transactions. */}
      <HistoryTransactions
        key={`${category}:${flow}`}
        range={range}
        category={category}
        flow={flow}
        categories={categories}
      />
    </>
  );
}

/** The category as the chips show it: from the loaded breakdowns, otherwise from the category list, so a category without amounts still has its name. */
function displayCategory(found: CategoryAmount | null, category: string, categories: Category[]) {
  if (category === "uncategorized") {
    return "uncategorized" as const;
  }

  const listed = categories.find(item => item.id === category);
  const source = found ?? listed;

  return source ? {
    name: source.name,
    color: source.color,
    icon: source.icon
  } : null;
}

/** A column's signed bar: income above the zero line, expenses below it, as in the income and expenses chart. */
function columnFlows(amount: number, flow: HistoryFlow) {
  return flow === "income" ? {
    income: amount,
    expenses: 0,
    net: amount
  } : {
    income: 0,
    expenses: amount,
    net: -amount
  };
}

function HistoryChart({
  range,
  insights,
  category,
  flow,
  categories
}: Props & {
  categories: Category[];
}) {
  const t = useTranslations("insights.history");
  const locale = useLocale();
  const plotRef = useRef<HTMLDivElement>(null);
  const { count } = usePlotColumns(plotRef);
  const ranges = columnRanges(range);
  const columns = insights.status === "pending" ? [] : insightsColumns(insights.data).slice(-count);
  const history = categoryHistory(columns, category, flow);
  const found = historyCategory(columns, category, flow);
  const shown = displayCategory(found, category, categories);
  const mask = insights.status === "pending" ? ui["skeleton"] : valueMask(insights.status);
  const currency = insights.status === "pending" ? "" : insights.data.currency;
  const average = averageAmount(history);
  const titleId = useId();

  return (
    <section className={clsx(ui["panel"], chart["chart-panel"])} aria-labelledby={titleId}>
      <div className={clsx(ui["card-heading"], chart["heading"])}>
        <div className={chart["title"]}>
          <h2 id={titleId}>{t(flow === "income" ? "incomeTitle" : "expensesTitle")}</h2>
          <span className={clsx(ui["subtle"], insights.status !== "pending" && mask)}>{columnsLabel(ranges.slice(-count), locale)}</span>
        </div>
        <button type="button" className={ui["text-button"]} onClick={clearCategory}>
          <X size={15} aria-hidden="true" />
          {t("clear")}
        </button>
      </div>
      <div className={clsx(chart["chart-legend"], styles["legend"])}>
        {shown ? <CategoryLabel category={shown} /> : <span className={ui["skeleton"]}>{t("loadingCategory")}</span>}
        <span className={styles["average"]}>
          <i className={styles["average-key"]} aria-hidden="true" />
          {t("average")} <strong className={mask}>{insights.status === "pending" ? "€000.00" : money(average, currency, locale)}</strong>
        </span>
      </div>
      <div className={chart["plot"]} ref={plotRef}>
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
          <HistoryPlot
            history={history}
            found={found}
            flow={flow}
            average={average}
            currency={currency}
            status={insights.status}
          />
        )}
      </div>
    </section>
  );
}

function HistoryPlot({
  history,
  found,
  flow,
  average,
  currency,
  status
}: {
  history: HistoryColumn[];
  found: CategoryAmount | null;
  flow: HistoryFlow;
  average: number;
  currency: string;
  status: Exclude<Area<Insights>["status"], "pending">;
}) {
  const t = useTranslations("insights.history");
  const tChart = useTranslations("insights.chart");
  const locale = useLocale();
  const chartRef = useDevicePixelRatioProperty();
  const {
    activeKey,
    regionProps,
    targetProps
  } = useChartDetails();
  const flows = history.map(column => columnFlows(column.amount, flow));
  const averageFlow = columnFlows(average, flow);
  const scale = cashFlowScale([...flows, averageFlow]);
  const selectedKey = history.at(-1)?.key;
  const activeColumn = history.find(column => column.key === activeKey);
  const hasAmounts = history.some(column => column.amount !== 0);
  const interval = history[0]?.range.interval ?? "month";
  let detail = hasAmounts ? t("hint") : t("empty");

  if (activeColumn) {
    detail = t("detail", {
      period: rangeTitle(activeColumn.range, locale),
      amount: money(activeColumn.amount, currency, locale)
    });
  }

  return (
    <div {...regionProps}>
      <div className={chart["viewport"]}>
        <div
          {...areaProps(status, chart["bar-chart"])}
          ref={chartRef}
          role="group"
          aria-label={t("plotLabel", {
            interval: tChart(`intervals.${interval}`),
            range: columnsLabel(history.map(column => column.range), locale)
          })}
          data-active={activeColumn ? "" : undefined}
        >
          {activeColumn && (
            <span
              className={chart["column-highlight"]}
              aria-hidden="true"
              style={{
                left: cssPercent(history.indexOf(activeColumn) / history.length),
                width: cssPercent(1 / history.length)
              }}
            />
          )}
          <ZeroLine scale={scale} />
          {hasAmounts && (
            <span className={clsx(chart["plot-area"], styles["average-layer"])} aria-hidden="true">
              <span
                className={styles["average-line"]}
                style={{
                  top: cssPercent(scaleOffset(averageFlow.net, scale))
                }}
              />
            </span>
          )}
          {history.map((column, index) => {
            const selected = column.key === selectedKey;
            const active = column === activeColumn;
            const groups = found && column.amount !== 0 ? groupByCategory([{
              ...found,
              amount: column.amount
            }]) : [];
            const figures = {
              period: rangeTitle(column.range, locale),
              amount: money(column.amount, currency, locale)
            };

            return (
              <button
                type="button"
                className={chart["month"]}
                key={column.key}
                aria-label={selected ? t("selectedColumnLabel", figures) : t("columnLabel", figures)}
                data-active={active ? "" : undefined}
                data-current={selected ? "" : undefined}
                {...targetProps(column.key, () => selectRange(column.range))}
              >
                <ColumnBars
                  column={flows[index]}
                  incomeGroups={flow === "income" ? groups : []}
                  expenseGroups={flow === "expense" ? groups : []}
                  active={active}
                  scale={scale}
                />
                <span className={chart["month-label"]}>{rangeLabel(column.range, locale)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className={clsx(styles["detail"], valueMask(status))} aria-live="polite">{detail}</p>
    </div>
  );
}

function HistoryTransactions({
  range,
  category,
  flow,
  categories
}: Omit<Props, "insights"> & {
  categories: Area<Category[]>;
}) {
  const t = useTranslations("insights.history");
  const locale = useLocale();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [paging, setPaging] = useState({
    range,
    page: 1
  });
  // Another range starts at its first page.
  const page = paging.range === range ? paging.page : 1;
  const currency = useCurrency();
  const list = useAreaResult(useCategoryTransactions(range, currency, category, flow, page));
  const pending = pendingTogether(list, categories);

  return (
    <section className={clsx(ui["panel"], panel["transaction-panel"])}>
      <div className={panel["card-heading"]}>
        <h2 ref={headingRef} tabIndex={-1}>{t("transactions", {
          period: rangeTitle(range, locale)
        })}</h2>
      </div>
      <TransactionRuleProvider fallbackFocus={headingRef}>
        {list.status === "pending" || categories.status === "pending" ? (
          <AreaPlaceholder area={pending} failureTitle={t("transactionsFailure")}>
            <TransactionListSkeleton rows={Math.min(transactionPageSize, 8)} />
          </AreaPlaceholder>
        ) : (
          <>
            <div {...areaProps(list.status)}>
              {list.data.transactions.length ? <TransactionList categories={categories.data} transactions={list.data.transactions} /> : <Empty title={t("noTransactionsTitle")}>{t("noTransactions")}</Empty>}
            </div>
            <TransactionPagination
              list={list}
              page={page}
              onPage={next => {
                setPaging({
                  range,
                  page: next
                });
                headingRef.current?.focus();
              }}
            />
          </>
        )}
      </TransactionRuleProvider>
    </section>
  );
}

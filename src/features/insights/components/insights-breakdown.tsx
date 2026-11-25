"use client";

import ui from "../../../components/ui/primitives.module.css";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import styles from "../../reports/components/category-breakdown.module.css";
import { categoryRowLink, FlowColumn, FlowColumnSkeleton } from "@/features/reports/components/category-breakdown";
import type { CategoryRowLink } from "@/features/reports/components/category-rows";
import type { CategoryGroup } from "@/features/reports/category-groups";
import { formatSavingsRate, isNegativeRate, netFlow } from "@/features/reports/cash-flow-selection";
import { compareCategories } from "@/features/insights/category-comparison";
import { insightsColumns, previousFlows, reservedComparisonRows, type InsightsColumn } from "@/features/insights/insights-columns";
import { daySpanLabel, rangeTitle } from "@/features/insights/range-format";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { areaProps, valueMask } from "@/components/ui/result-presentation";
import { monthPeriod } from "@/lib/period";
import { money, signedMoney } from "@/lib/money";
import { useCurrency, useMonthTransactionsHref } from "@/client/use-app-url";
import { useLocale } from "@/client/locale-provider";
import type { Area } from "@/components/ui/use-area-result";
import { shiftRange, type PeriodRange } from "@/lib/period-range";
import type { CategoryAmount } from "@/features/reports/types";
import type { Insights } from "@/features/insights/types";

type Props = {
  range: PeriodRange;
  insights: Area<Insights>;
  /** The hovered, focused or tapped column; without one, the selected range. */
  activeKey: string | null;
  id: string;
};

/** Every income and expense category of the active column, each with its change against the span that column is compared with. */
export function InsightsBreakdown({
  range,
  insights,
  activeKey,
  id
}: Props) {
  const t = useTranslations("reports.breakdown");
  const tInsights = useTranslations("insights.breakdown");
  const locale = useLocale();
  const selectedCurrency = useCurrency();
  const monthTransactionsHref = useMonthTransactionsHref();

  if (insights.status === "pending") {
    return (
      <section className={clsx(ui["panel"], styles["panel"])} id={id}>
        <div className={clsx(ui["card-heading"], styles["heading"])}>
          <div className={styles["title"]}>
            <h2>{t("title")}</h2>
            <span className={ui["subtle"]}>{rangeTitle(range, locale)}</span>
          </div>
        </div>
        <div className={styles["summary"]}>
          <span>
            {t("net")} <strong className={ui["skeleton"]}>€0,000.00</strong>
          </span>
          <span className={styles["savings-rate"]}>
            {t("savingsRate")} <strong className={ui["skeleton"]}>00%</strong>
          </span>
        </div>
        <AreaPlaceholder area={insights} failureTitle={t("failure")}>
          <div className={styles["columns"]}>
            <FlowColumnSkeleton label={t("income")} />
            <FlowColumnSkeleton label={t("expenses")} />
          </div>
        </AreaPlaceholder>
      </section>
    );
  }

  const { data } = insights;
  const mask = valueMask(insights.status);
  const currency = data.currency || selectedCurrency;
  const columns = insightsColumns(data);
  const found = columns.findIndex(column => column.key === activeKey);
  const index = found === -1 ? columns.length - 1 : found;
  const column = columns[index];
  const previous = previousFlows(data, columns, index);
  const comparedWith = comparisonName(data, columns, index, locale);
  const context = rangeTitle(column.range, locale);
  const net = netFlow(column.income, column.expenses);
  const reserved = reservedComparisonRows(data, columns);
  // The transaction list filters by month, so only month columns link to their transactions.
  const month = column.range.interval === "month" ? column.range.start.toPlainYearMonth() : null;
  const rowLink = (type: "income" | "expense", label: (category: string) => string) => month ? categoryRowLink(monthPeriod(month), currency, type, label) : undefined;

  return (
    <section className={clsx(ui["panel"], styles["panel"])} id={id}>
      <div className={clsx(ui["card-heading"], styles["heading"])}>
        <div className={styles["title"]}>
          <h2>{t("title")}</h2>
          <span className={clsx(ui["subtle"], mask)}>{context}</span>
        </div>
        {month && (
          <Link
            className={ui["text-button"]}
            href={monthTransactionsHref(month.toString())}
            aria-label={t("viewTransactionsLabel", {
              context
            })}
          >
            {t("viewTransactions")}
            <ChevronRight className={styles["link-icon"]} size={16} />
          </Link>
        )}
      </div>
      <div className={styles["summary"]}>
        <span>
          {t("net")} <strong className={clsx(net.net < 0 && styles["negative"], mask)}>{money(net.net, currency, locale)}</strong>
        </span>
        <span className={styles["savings-rate"]}>
          {t("savingsRate")} <strong className={clsx(isNegativeRate(net.savingsRate, locale) && styles["negative"], mask)}>{formatSavingsRate(net.savingsRate, locale)}</strong>
        </span>
      </div>
      <div {...areaProps(insights.status, styles["columns"])}>
        <ComparisonColumn
          label={t("income")}
          total={column.income}
          current={column.incomeBreakdown}
          previous={previous?.incomeBreakdown ?? null}
          rising="better"
          comparedWith={comparedWith}
          reservedRows={reserved.income}
          currency={currency}
          rowLink={rowLink("income", category => t("viewIncomeIn", {
            category,
            context
          }))}
          empty={tInsights("noIncome")}
        />
        <ComparisonColumn
          label={t("expenses")}
          total={column.expenses}
          current={column.expenseBreakdown}
          previous={previous?.expenseBreakdown ?? null}
          rising="worse"
          comparedWith={comparedWith}
          reservedRows={reserved.expenses}
          currency={currency}
          rowLink={rowLink("expense", category => t("viewExpensesIn", {
            category,
            context
          }))}
          empty={tInsights("noExpenses")}
        />
      </div>
    </section>
  );
}

/** The name of the span a column is compared with: the selected range's comparison days while it runs, otherwise the previous column. */
function comparisonName(data: Insights, columns: InsightsColumn[], index: number, locale: string) {
  const previous = previousFlows(data, columns, index);

  if (previous === null) {
    return "";
  }

  if (index === columns.length - 1 && data.comparison.partial) {
    return daySpanLabel(previous, locale);
  }

  return rangeTitle(shiftRange(columns[index].range, -1), locale);
}

function changeTone(change: number, rising: "better" | "worse") {
  return (change > 0) === (rising === "better") ? ui["positive"] : ui["negative"];
}

function ComparisonColumn({
  label,
  total,
  current,
  previous,
  rising,
  comparedWith,
  reservedRows,
  currency,
  rowLink,
  empty
}: {
  label: string;
  total: number;
  current: CategoryAmount[];
  previous: CategoryAmount[] | null;
  /** Whether more of this flow than before is good news. */
  rising: "better" | "worse";
  comparedWith: string;
  reservedRows: number;
  currency: string;
  rowLink?: (group: CategoryGroup) => CategoryRowLink | null;
  empty: string;
}) {
  const t = useTranslations("insights.breakdown");
  const locale = useLocale();
  const {
    groups,
    changes
  } = compareCategories(current, previous);

  function detail(group: CategoryGroup) {
    const change = changes?.get(group.key);

    if (change === undefined) {
      return null;
    }

    const tone = change === 0 ? undefined : changeTone(change, rising);

    return (
      <span className={tone}>
        <span aria-hidden="true">{signedMoney(change, currency, locale)}</span>
        <span className={ui["visually-hidden"]}>{t("changeLabel", {
          amount: signedMoney(change, currency, locale),
          period: comparedWith
        })}</span>
      </span>
    );
  }

  return (
    <FlowColumn
      label={label}
      total={total}
      groups={groups}
      reservedRows={reservedRows}
      currency={currency}
      rowLink={rowLink}
      detail={changes ? detail : undefined}
      empty={empty}
    />
  );
}

"use client";

import ui from "../../../components/ui/primitives.module.css";

import Link from "next/link";
import { useId, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import styles from "../../reports/components/category-breakdown.module.css";
import choiceStyles from "./insights-breakdown.module.css";
import { breakdownRowLink, FlowColumn, FlowColumnSkeleton } from "@/features/reports/components/category-breakdown";
import type { CategoryRowLink } from "@/features/reports/components/category-rows";
import type { CategoryGroup } from "@/features/reports/category-groups";
import { formatSavingsRate, isNegativeRate, netFlow } from "@/features/reports/cash-flow-selection";
import { compareCategories } from "@/features/insights/category-comparison";
import { breakdownOf, insightsColumns, previousFlows, reservedComparisonRows, type InsightsColumn } from "@/features/insights/insights-columns";
import { daySpanLabel, rangeTitle } from "@/features/insights/range-format";
import { clearCategory } from "@/features/insights/insights-location";
import { categoryRangeHref } from "@/client/app-location";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { areaProps, valueMask } from "@/components/ui/result-presentation";
import { monthPeriod } from "@/lib/period";
import { money, signedMoney } from "@/lib/money";
import { useCurrency, useMonthTransactionsHref } from "@/client/use-app-url";
import { useLocale } from "@/client/locale-provider";
import type { Area } from "@/components/ui/use-area-result";
import { shiftRange } from "@/lib/period-range";
import type { BreakdownGrouping, CategoryAmount } from "@/features/reports/types";
import type { Insights } from "@/features/insights/types";

type Props = {
  insights: Area<Insights>;
  /** The hovered, focused or tapped column; without one, the selected range. */
  activeKey: string | null;
  id: string;
  /** The category the insights are narrowed to; the breakdown then lists only it and offers to show all categories again. */
  category: string | null;
};

const groupings: BreakdownGrouping[] = ["category", "account"];

/** Every income and expense category or account of the active column, each with its change against the span that column is compared with. */
export function InsightsBreakdown({
  insights,
  activeKey,
  id,
  category
}: Props) {
  const t = useTranslations("reports.breakdown");
  const tInsights = useTranslations("insights.breakdown");
  const locale = useLocale();
  const selectedCurrency = useCurrency();
  const monthTransactionsHref = useMonthTransactionsHref();
  const [chosenGrouping, setGrouping] = useState<BreakdownGrouping>("category");
  // Account rows cannot be narrowed to a category, so a category filter always lists categories.
  const grouping = category ? "category" : chosenGrouping;
  const title = grouping === "account" ? tInsights("byAccount") : t("title");
  const choice = category ? (
    <button type="button" className={ui["text-button"]} onClick={clearCategory}>
      <X size={15} aria-hidden="true" />
      {tInsights("allCategories")}
    </button>
  ) : <GroupingChoice grouping={grouping} onChange={setGrouping} />;

  if (insights.status === "pending") {
    return (
      <section className={clsx(ui["panel"], styles["panel"])} id={id}>
        <div className={clsx(ui["card-heading"], styles["heading"], choiceStyles["heading"])}>
          <div className={styles["title"]}>
            <h2>{title}</h2>
          </div>
          {choice}
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
  const current = breakdownOf(column, grouping);
  const previousFlow = previousFlows(data, columns, index);
  const previous = previousFlow ? breakdownOf(previousFlow, grouping) : null;
  const comparedWith = comparisonName(data, columns, index, locale);
  const context = rangeTitle(column.range, locale);
  const net = netFlow(column.income, column.expenses);
  const reserved = reservedComparisonRows(data, columns, grouping);
  // The transaction list filters by month, so only month columns link to their transactions; category rows narrow the insights over any interval.
  const month = column.range.interval === "month" ? column.range.start.toPlainYearMonth() : null;
  const rowLink = (type: "income" | "expense", label: (name: string) => string) => {
    if (grouping === "category") {
      return (group: CategoryGroup): CategoryRowLink | null => group.key === "remainder" ? null : {
        href: categoryRangeHref(column.range, currency, group.key),
        label: label(group.name)
      };
    }

    return month ? breakdownRowLink(grouping, monthPeriod(month), currency, type, label) : undefined;
  };

  return (
    <section className={clsx(ui["panel"], styles["panel"])} id={id}>
      <div className={clsx(ui["card-heading"], styles["heading"], choiceStyles["heading"])}>
        <div className={styles["title"]}>
          <h2>{title}</h2>
        </div>
        {choice}
        {/* A category filter lists its transactions below the panels. */}
        {month && !category && (
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
          current={current.income}
          previous={previous?.income ?? null}
          rising="better"
          comparedWith={comparedWith}
          reservedRows={reserved.income}
          currency={currency}
          rowLink={rowLink("income", name => t(grouping === "category" ? "showIncomeIn" : "viewIncomeIn", {
            category: name,
            context
          }))}
          empty={tInsights("noIncome")}
        />
        <ComparisonColumn
          label={t("expenses")}
          total={column.expenses}
          current={current.expenses}
          previous={previous?.expenses ?? null}
          rising="worse"
          comparedWith={comparedWith}
          reservedRows={reserved.expenses}
          currency={currency}
          rowLink={rowLink("expense", name => t(grouping === "category" ? "showExpensesIn" : "viewExpensesIn", {
            category: name,
            context
          }))}
          empty={tInsights("noExpenses")}
        />
      </div>
    </section>
  );
}

/** Switches the breakdown between categories and accounts, in the period bar's segmented style. */
function GroupingChoice({
  grouping,
  onChange
}: {
  grouping: BreakdownGrouping;
  onChange: (grouping: BreakdownGrouping) => void;
}) {
  const t = useTranslations("insights.breakdown");
  const name = useId();

  return (
    <fieldset className={choiceStyles["groupings"]}>
      <legend className={ui["visually-hidden"]}>{t("grouping")}</legend>
      {groupings.map(option => (
        <label className={choiceStyles["grouping"]} key={option}>
          <input
            className={choiceStyles["grouping-input"]}
            type="radio"
            name={name}
            value={option}
            checked={grouping === option}
            onChange={() => onChange(option)}
          />
          {t(option)}
        </label>
      ))}
    </fieldset>
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

/** Green for good news and red for bad news; an unchanged amount stays neutral. */
function changeTone(change: number, rising: "better" | "worse") {
  if (change === 0) {
    return undefined;
  }

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

    const tone = changeTone(change, rising);

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

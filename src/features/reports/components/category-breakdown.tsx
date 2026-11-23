"use client";

import ui from "../../../components/ui/primitives.module.css";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import styles from "./category-breakdown.module.css";
import { describeMonth, periodLabel } from "@/lib/date-format";
import { monthPeriod, periodFromJson, type Period } from "@/lib/period";
import { money } from "@/lib/money";
import { categoryRowLimit, type CategoryGroup } from "@/features/reports/category-groups";
import { formatSavingsRate, isNegativeRate, periodCashFlow, reservedCategoryRows, type CashFlowSelection, type CashFlowSummary } from "@/features/reports/cash-flow-selection";
import { CategoryRows, CategoryRowsSkeleton, type CategoryRowLink } from "@/features/reports/components/category-rows";
import { categoryTransactionsHref } from "@/client/app-location";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { areaProps, valueMask } from "@/components/ui/result-presentation";
import { useCurrency, useMonthTransactionsHref, usePeriod, useViewHref } from "@/client/use-app-url";
import type { Area } from "@/components/ui/use-area-result";
import type { CashFlow } from "@/features/reports/types";
import { useLocale } from "@/client/locale-provider";
import { useTranslations } from "next-intl";

type Props = {
  cashFlow: Area<CashFlow>;
  selection: CashFlowSelection | null;
  id: string;
};

const emptySummary: CashFlowSummary = {
  income: 0,
  expenses: 0,
  net: 0,
  savingsRate: null,
  incomeGroups: [],
  expenseGroups: []
};

/** Income and expenses by category for the selected month, or the whole period without a selection, side by side. */
export function CategoryBreakdown({
  cashFlow,
  selection,
  id
}: Props) {
  const t = useTranslations("reports.breakdown");
  const locale = useLocale();
  const selectedPeriod = usePeriod();
  const selectedCurrency = useCurrency();
  const pending = cashFlow.status === "pending";
  const period = pending ? selectedPeriod : periodFromJson(cashFlow.data.period);
  const mask = pending ? ui["skeleton"] : valueMask(cashFlow.status);
  const currency = pending ? selectedCurrency : cashFlow.data.currency;
  const viewHref = useViewHref();
  const monthTransactionsHref = useMonthTransactionsHref();
  const shownMonth = selection?.month ?? (period.kind === "month" ? period.month.toString() : null);
  const transactionsHref = shownMonth ? monthTransactionsHref(shownMonth) : viewHref("transactions");
  const summary = selection ?? (pending ? emptySummary : periodCashFlow(cashFlow.data));
  const context = selection ? describeMonth(Temporal.PlainYearMonth.from(selection.month), locale).title : periodLabel(period, locale, t("allMonths"));
  const shownPeriod = selection ? monthPeriod(Temporal.PlainYearMonth.from(selection.month)) : period;
  const reserved = pending ? {
    income: categoryRowLimit,
    expenses: categoryRowLimit
  } : reservedCategoryRows(cashFlow.data);

  return (
    <section className={clsx(ui["panel"], styles["panel"])} id={id}>
      <div className={clsx(ui["card-heading"], styles["heading"])}>
        <div className={styles["title"]}>
          <h2>{t("title")}</h2>
          <span className={clsx(ui["subtle"], pending ? "" : mask)}>{context}</span>
        </div>
        <Link
          className={ui["text-button"]}
          href={transactionsHref}
          aria-label={t("viewTransactionsLabel", {
            context
          })}
        >
          {t("viewTransactions")}
          <ChevronRight className={styles["link-icon"]} size={16} />
        </Link>
      </div>
      <div className={styles["summary"]}>
        <span>
          {t("net")} <strong className={clsx(summary.net < 0 && styles["negative"], mask)}>{money(summary.net, currency, locale)}</strong>
        </span>
        <span className={styles["savings-rate"]}>
          {t("savingsRate")} <strong className={clsx(isNegativeRate(summary.savingsRate, locale) && styles["negative"], mask)}>{formatSavingsRate(summary.savingsRate, locale)}</strong>
        </span>
      </div>
      {pending ? (
        <AreaPlaceholder area={cashFlow} failureTitle={t("failure")}>
          <div className={styles["columns"]}>
            <FlowColumnSkeleton label={t("income")} />
            <FlowColumnSkeleton label={t("expenses")} />
          </div>
        </AreaPlaceholder>
      ) : (
        <div {...areaProps(cashFlow.status, styles["columns"])}>
          <FlowColumn
            label={t("income")}
            total={summary.income}
            groups={summary.incomeGroups}
            reservedRows={reserved.income}
            currency={currency}
            rowLink={categoryRowLink(shownPeriod, currency, "income", category => t("viewIncomeIn", {
              category,
              context
            }))}
            empty={selection ? t("noIncomeMonth") : t("noIncomePeriod")}
          />
          <FlowColumn
            label={t("expenses")}
            total={summary.expenses}
            groups={summary.expenseGroups}
            reservedRows={reserved.expenses}
            currency={currency}
            rowLink={categoryRowLink(shownPeriod, currency, "expense", category => t("viewExpensesIn", {
              category,
              context
            }))}
            empty={selection ? t("noExpensesMonth") : t("noExpensesPeriod")}
          />
        </div>
      )}
    </section>
  );
}

/**
 * Each category row opens its income or expense transactions in the shown month or period and currency. The combined "+N more" row stays plain: the list filters one category at a time, and the period's whole list is already linked from the panel.
 */
export function categoryRowLink(period: Period, currency: string, type: "income" | "expense", label: (category: string) => string) {
  return (group: CategoryGroup): CategoryRowLink | null => {
    if (group.key === "remainder") {
      return null;
    }

    return {
      href: categoryTransactionsHref({
        period,
        currency,
        category: group.key,
        type
      }),
      label: label(group.name)
    };
  };
}

function FlowColumn({
  label,
  total,
  groups,
  reservedRows,
  currency,
  rowLink,
  empty
}: {
  label: string;
  total: number;
  groups: CategoryGroup[];
  reservedRows: number;
  currency: string;
  rowLink: (group: CategoryGroup) => CategoryRowLink | null;
  empty: string;
}) {
  const locale = useLocale();

  return (
    <div className={styles["column"]}>
      <h3 className={styles["column-heading"]}>
        {label}
        <strong>{money(total, currency, locale)}</strong>
      </h3>
      <div className={styles["rows-frame"]}>
        {/* Invisible rows reserve the column's height, so the panel stays still as selections with fewer categories come and go. */}
        <div className={styles["reserved-rows"]} aria-hidden="true">
          <CategoryRowsSkeleton rows={reservedRows} />
        </div>
        <div className={styles["shown-rows"]}>
          {groups.length ? <CategoryRows groups={groups} currency={currency} rowLink={rowLink} /> : <p className={ui["subtle"]}>{empty}</p>}
        </div>
      </div>
    </div>
  );
}

function FlowColumnSkeleton({ label }: {
  label: string;
}) {
  return (
    <div className={styles["column"]}>
      <h3 className={styles["column-heading"]}>
        {label}
        <strong className={ui["skeleton"]}>€0,000.00</strong>
      </h3>
      <CategoryRowsSkeleton rows={categoryRowLimit} />
    </div>
  );
}

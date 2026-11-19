"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import styles from "./category-breakdown.module.css";
import { describeMonth, periodLabel } from "@/lib/date-format";
import { periodFromJson } from "@/lib/period";
import { money } from "@/lib/money";
import { categoryRowLimit, type CategoryGroup } from "@/features/reports/category-groups";
import { formatSavingsRate, periodCashFlow, type CashFlowSelection, type CashFlowSummary } from "@/features/reports/cash-flow-selection";
import { CategoryRows, CategoryRowsSkeleton } from "@/features/reports/components/category-rows";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { areaProps, valueMask } from "@/components/ui/result-presentation";
import { useCurrency, usePeriod } from "@/client/use-app-url";
import type { Area } from "@/components/ui/use-area-result";
import type { CashFlow } from "@/features/reports/types";

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
  const selectedPeriod = usePeriod();
  const selectedCurrency = useCurrency();
  const pending = cashFlow.status === "pending";
  const period = pending ? selectedPeriod : periodFromJson(cashFlow.data.period);
  const mask = pending ? ui["skeleton"] : valueMask(cashFlow.status);
  const currency = pending ? selectedCurrency : cashFlow.data.currency;
  const summary = selection ?? (pending ? emptySummary : periodCashFlow(cashFlow.data));
  const context = selection ? describeMonth(Temporal.PlainYearMonth.from(selection.month)).title : periodLabel(period);
  const emptyNote = selection ? "this month" : "in this period";

  return (
    <section className={clsx(ui["panel"], styles["panel"])} id={id}>
      <div className={clsx(ui["card-heading"], styles["heading"])}>
        <h2>By category</h2>
        <span className={clsx(ui["subtle"], pending ? "" : mask)}>{context}</span>
      </div>
      <p className={clsx(ui["subtle"], styles["summary"])}>
        <span>
          Net <strong className={mask}>{money(summary.net, currency)}</strong>
        </span>
        <span>
          Savings rate <strong className={mask}>{formatSavingsRate(summary.savingsRate)}</strong>
        </span>
      </p>
      {pending ? (
        <AreaPlaceholder area={cashFlow} subject="Income and spending by category">
          <div className={styles["columns"]}>
            <FlowColumnSkeleton label="Income" />
            <FlowColumnSkeleton label="Expenses" />
          </div>
        </AreaPlaceholder>
      ) : (
        <div {...areaProps(cashFlow.status, styles["columns"])}>
          <FlowColumn
            label="Income"
            total={summary.income}
            groups={summary.incomeGroups}
            currency={currency}
            empty={`No income ${emptyNote}.`}
          />
          <FlowColumn
            label="Expenses"
            total={summary.expenses}
            groups={summary.expenseGroups}
            currency={currency}
            empty={`No expenses ${emptyNote}.`}
          />
        </div>
      )}
    </section>
  );
}

function FlowColumn({
  label,
  total,
  groups,
  currency,
  empty
}: {
  label: string;
  total: number;
  groups: CategoryGroup[];
  currency: string;
  empty: string;
}) {
  return (
    <div className={styles["column"]}>
      <h3 className={styles["column-heading"]}>
        {label}
        <strong>{money(total, currency)}</strong>
      </h3>
      <div className={styles["rows-frame"]}>
        {/* Invisible full-length rows reserve the column's height, so the panel stays still as selections with fewer categories come and go. */}
        <div className={styles["reserved-rows"]} aria-hidden="true">
          <CategoryRowsSkeleton rows={categoryRowLimit} />
        </div>
        <div className={styles["shown-rows"]}>
          {groups.length ? <CategoryRows groups={groups} currency={currency} /> : <p className={ui["subtle"]}>{empty}</p>}
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

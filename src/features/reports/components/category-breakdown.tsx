"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { Temporal } from "temporal-polyfill";
import styles from "./category-breakdown.module.css";
import { describeMonth, periodLabel } from "@/lib/date-format";
import { periodFromJson } from "@/lib/period";
import { money } from "@/lib/money";
import { groupByCategory } from "@/features/reports/category-groups";
import { flowPresentation, type CashFlowSelection } from "@/features/reports/cash-flow-selection";
import { Empty } from "@/components/ui/empty-state";
import { CategoryRows, CategoryRowsSkeleton } from "@/features/reports/components/category-rows";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { areaProps, valueMask } from "@/components/ui/result-presentation";
import { useCurrency, usePeriod } from "@/client/use-app-url";
import type { Area, AreaResult } from "@/components/ui/use-area-result";
import type { CashFlow } from "@/features/reports/types";

type Props = {
  cashFlow: Area<CashFlow>;
  selection: CashFlowSelection | null;
  id: string;
};

export function CategoryBreakdown({
  cashFlow,
  selection,
  id
}: Props) {
  const selectedPeriod = usePeriod();
  const selectedCurrency = useCurrency();
  const period = cashFlow.status === "pending" ? selectedPeriod : periodFromJson(cashFlow.data.period);
  const mask = cashFlow.status === "pending" ? ui["skeleton"] : valueMask(cashFlow.status);
  const currency = cashFlow.status === "pending" ? selectedCurrency : cashFlow.data.currency;
  const total = selection?.total ?? (cashFlow.status === "pending" ? 0 : cashFlow.data.expenses);
  const presentation = selection ? flowPresentation[selection.flow] : flowPresentation.expenses;
  const context = selection ? describeMonth(Temporal.PlainYearMonth.from(selection.month)).title : periodLabel(period);

  return (
    <section className={ui["panel"]} id={id}>
      <div className={ui["card-heading"]}>
        <h2>{selection ? presentation.breakdownLabel : "Where your money goes"}</h2>
        <span className={clsx(ui["subtle"], cashFlow.status === "pending" ? "" : mask)}>{context}</span>
      </div>
      <p className={clsx(ui["subtle"], mask)}>{presentation.label} {money(total, currency)}</p>
      {cashFlow.status === "pending" ? (
        <AreaPlaceholder area={cashFlow} subject="Your spending">
          <CategoryRowsSkeleton className={styles["rows"]} rows={5} />
        </AreaPlaceholder>
      ) : <BreakdownRows cashFlow={cashFlow} selection={selection} />}
    </section>
  );
}

function BreakdownRows({ cashFlow, selection }: {
  cashFlow: AreaResult<CashFlow>;
  selection: CashFlowSelection | null;
}) {
  const {
    breakdown,
    currency
  } = cashFlow.data;
  const groups = selection?.groups ?? groupByCategory(breakdown);
  const empty = selection ? <p className={ui["subtle"]}>{flowPresentation[selection.flow].empty}</p> : <Empty title="No expenses yet" illustration={null}>Your spending breakdown appears here once transactions are available.</Empty>;

  return (
    <div {...areaProps(cashFlow.status)}>
      {groups.length ? <CategoryRows className={styles["rows"]} groups={groups} currency={currency} /> : empty}
    </div>
  );
}

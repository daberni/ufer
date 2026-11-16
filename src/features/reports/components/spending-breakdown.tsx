"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./spending-breakdown.module.css";
import { periodLabel } from "@/lib/date-format";
import { periodFromJson } from "@/lib/period";
import { groupByCategory } from "@/features/reports/category-groups";
import { Empty } from "@/components/ui/empty-state";
import { CategoryRows, CategoryRowsSkeleton } from "@/features/reports/components/category-rows";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { areaProps, valueMask } from "@/components/ui/result-presentation";
import { usePeriod } from "@/client/use-dashboard-url";
import type { Area, AreaResult } from "@/components/ui/use-area-result";
import type { CashFlow } from "@/features/reports/types";

type Props = {
  cashFlow: Area<CashFlow>;
};

export function SpendingBreakdown({ cashFlow }: Props) {
  const selectedPeriod = usePeriod();
  const period = cashFlow.status === "pending" ? selectedPeriod : periodFromJson(cashFlow.data.period);
  const periodMask = cashFlow.status === "pending" ? "" : valueMask(cashFlow.status);

  return (
    <section className={ui["panel"]}>
      <div className={ui["card-heading"]}>
        <h2>Where your money goes</h2>
        <span className={clsx(ui["subtle"], periodMask)}>{periodLabel(period)}</span>
      </div>
      {cashFlow.status === "pending" ? (
        <AreaPlaceholder area={cashFlow} subject="Your spending">
          <CategoryRowsSkeleton className={styles["rows"]} rows={5} />
        </AreaPlaceholder>
      ) : <SpendingRows cashFlow={cashFlow} />}
    </section>
  );
}

function SpendingRows({ cashFlow }: {
  cashFlow: AreaResult<CashFlow>
}) {
  const {
    breakdown,
    currency
  } = cashFlow.data;

  return (
    <div {...areaProps(cashFlow.status)}>
      {breakdown.length ? <CategoryRows className={styles["rows"]} groups={groupByCategory(breakdown)} currency={currency} /> : <Empty title="No expenses yet" illustration={null}>Your spending breakdown appears here once transactions are available.</Empty>}
    </div>
  );
}

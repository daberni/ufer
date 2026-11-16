"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./spending-breakdown.module.css";
import { periodLabel } from "@/features/dashboard/presentation";
import { periodFromJson } from "@/features/dashboard/period";
import { groupByCategory } from "@/features/dashboard/category-groups";
import { Empty } from "@/components/ui/empty-state";
import { CategoryRows } from "@/features/dashboard/components/category-rows";
import { areaProps, valueMask } from "@/features/dashboard/components/result-presentation";
import type { AreaResult } from "@/features/dashboard/use-area-result";
import type { CashFlow } from "@/features/dashboard/types";

type Props = {
  cashFlow: AreaResult<CashFlow>;
};

export function SpendingBreakdown({ cashFlow }: Props) {
  const {
    breakdown,
    currency,
    period
  } = cashFlow.data;

  return (
    <section className={ui["panel"]}>
      <div className={ui["card-heading"]}>
        <h2>Where your money goes</h2>
        <span className={clsx(ui["subtle"], valueMask(cashFlow.status))}>{periodLabel(periodFromJson(period))}</span>
      </div>
      <div {...areaProps(cashFlow.status)}>
        {breakdown.length ? <CategoryRows className={styles["rows"]} groups={groupByCategory(breakdown)} currency={currency} /> : <Empty title="No expenses yet" illustration={null}>Your spending breakdown appears here once transactions are available.</Empty>}
      </div>
    </section>
  );
}

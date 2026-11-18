"use client";

import { useId } from "react";
import styles from "./cash-flow-insights.module.css";
import { CashFlowChart } from "./cash-flow-chart";
import { CategoryBreakdown } from "./category-breakdown";
import { selectedCashFlow } from "@/features/reports/cash-flow-selection";
import { useChartDetails } from "@/features/reports/use-chart-details";
import { useCurrency, usePeriod } from "@/client/use-app-url";
import { serializePeriod } from "@/lib/period";
import type { Area } from "@/components/ui/use-area-result";
import type { CashFlow } from "@/features/reports/types";

type Props = {
  cashFlow: Area<CashFlow>;
};

/** The period and currency own the selection's lifetime; changing either starts from the period's spending again. */
export function CashFlowInsights({ cashFlow }: Props) {
  const period = usePeriod();
  const currency = useCurrency();

  return <InsightPanels key={`${serializePeriod(period)}:${currency}`} cashFlow={cashFlow} />;
}

function InsightPanels({ cashFlow }: Props) {
  const detailsId = useId();
  const {
    activeKey,
    regionProps,
    targetProps
  } = useChartDetails();
  const selection = cashFlow.status === "ready" ? selectedCashFlow(cashFlow.data, activeKey) : null;

  return (
    <div className={styles["analytics-grid"]} {...regionProps}>
      <CashFlowChart
        cashFlow={cashFlow}
        selection={selection}
        targetProps={targetProps}
        detailsId={detailsId}
      />
      <CategoryBreakdown cashFlow={cashFlow} selection={selection} id={detailsId} />
    </div>
  );
}

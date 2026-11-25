"use client";

import { useId } from "react";
import styles from "./cash-flow-insights.module.css";
import { CashFlowChart } from "./cash-flow-chart";
import { CategoryBreakdown } from "./category-breakdown";
import { selectedCashFlow } from "@/features/reports/cash-flow-selection";
import { useChartDetails } from "@/features/reports/use-chart-details";
import { useEarlierMonths } from "@/features/reports/use-earlier-months";
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

  return <InsightPanels key={`${serializePeriod(period)}:${currency}`} cashFlow={cashFlow} currency={currency} />;
}

function InsightPanels({
  cashFlow,
  currency
}: Props & {
  currency: string;
}) {
  const detailsId = useId();
  const history = useEarlierMonths(cashFlow, currency);
  const {
    activeKey,
    clear,
    regionProps,
    targetProps
  } = useChartDetails();
  // Earlier months only extend the chart and its selection; the category panel keeps the rows it reserves for the period and trend, so loading them never resizes it.
  const selection = history.cashFlow.status === "ready" ? selectedCashFlow(history.cashFlow.data, activeKey) : null;

  return (
    <div className={styles["analytics-grid"]} {...regionProps}>
      <CashFlowChart
        cashFlow={history.cashFlow}
        earlier={history.earlier}
        selection={selection}
        targetProps={targetProps}
        detailsId={detailsId}
        onSelectionHidden={clear}
      />
      <CategoryBreakdown cashFlow={cashFlow} selection={selection} id={detailsId} />
    </div>
  );
}

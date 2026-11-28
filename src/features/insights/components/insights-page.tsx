"use client";

import { useId } from "react";
import styles from "../../reports/components/cash-flow-insights.module.css";
import { PeriodBar } from "./period-bar";
import { InsightsSummary } from "./insights-summary";
import { InsightsChart } from "./insights-chart";
import { InsightsBreakdown } from "./insights-breakdown";
import { CategoryTransactions } from "./category-transactions";
import { useInsightsCategory, useInsightsRange } from "@/features/insights/insights-location";
import { useInsights, useNetWorthChange } from "@/features/insights/queries";
import { accountGroups, useAccounts } from "@/features/accounts/queries";
import { useChartDetails } from "@/features/reports/use-chart-details";
import { useCurrency } from "@/client/use-app-url";
import { mapArea, useAreaResult, type Area } from "@/components/ui/use-area-result";
import { serializeRange, type PeriodRange } from "@/lib/period-range";
import { filterInsights } from "@/features/insights/category-filter";
import type { Insights } from "@/features/insights/types";

/** The insights view: one period bar drives the summary, the interval columns and the breakdown that follows the active column. A category narrows the columns and breakdown to it and lists its transactions. */
export function InsightsPage() {
  const range = useInsightsRange();
  const category = useInsightsCategory();
  const currency = useCurrency();
  const accounts = useAreaResult(useAccounts());
  const currencies = mapArea(accounts, data => accountGroups(data, currency).currencies);
  const insights = useAreaResult(useInsights(range, currency));
  const netWorthChange = useAreaResult(useNetWorthChange(range, currency));

  return (
    <>
      <PeriodBar range={range} currencies={currencies} />
      <InsightsSummary insights={insights} netWorthChange={netWorthChange} />
      {/* The range, currency and category own the column selection's lifetime; changing any starts from the selected range again. */}
      <InsightsPanels
        key={`${serializeRange(range)}:${currency}:${category ?? ""}`}
        range={range}
        insights={category ? mapArea(insights, data => filterInsights(data, category)) : insights}
        category={category}
      />
      {category && <CategoryTransactions key={category} range={range} category={category} />}
    </>
  );
}

function InsightsPanels({
  range,
  insights,
  category
}: {
  range: PeriodRange;
  insights: Area<Insights>;
  category: string | null;
}) {
  const detailsId = useId();
  const {
    activeKey,
    clear,
    regionProps,
    targetProps
  } = useChartDetails();

  return (
    <div className={styles["analytics-grid"]} {...regionProps}>
      <InsightsChart
        range={range}
        insights={insights}
        activeKey={activeKey}
        targetProps={targetProps}
        detailsId={detailsId}
        onSelectionHidden={clear}
      />
      <InsightsBreakdown
        range={range}
        insights={insights}
        activeKey={activeKey}
        id={detailsId}
        category={category}
      />
    </div>
  );
}

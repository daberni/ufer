"use client";

import { useId } from "react";
import styles from "../../reports/components/cash-flow-insights.module.css";
import { PeriodBar } from "./period-bar";
import { InsightsSummary } from "./insights-summary";
import { InsightsChart } from "./insights-chart";
import { InsightsBreakdown } from "./insights-breakdown";
import { CategoryHistory } from "./category-history";
import { useInsightsCategory, useInsightsRange } from "@/features/insights/insights-location";
import { useInsights, useNetWorthChange } from "@/features/insights/queries";
import { accountGroups, useAccounts } from "@/features/accounts/queries";
import { useChartDetails } from "@/features/reports/use-chart-details";
import { useCurrency } from "@/client/use-app-url";
import { mapArea, useAreaResult, type Area } from "@/components/ui/use-area-result";
import { serializeRange, type PeriodRange } from "@/lib/period-range";
import type { Insights } from "@/features/insights/types";

/** The insights view: one period bar drives the summary and either the interval columns with the category breakdown that follows the active column, or one category's history. */
export function InsightsPage() {
  const range = useInsightsRange();
  const history = useInsightsCategory();
  const currency = useCurrency();
  const accounts = useAreaResult(useAccounts());
  const currencies = mapArea(accounts, data => accountGroups(data, currency).currencies);
  const insights = useAreaResult(useInsights(range, currency));
  const netWorthChange = useAreaResult(useNetWorthChange(range, currency));

  return (
    <>
      <PeriodBar range={range} currencies={currencies} />
      <InsightsSummary insights={insights} netWorthChange={netWorthChange} />
      {history ? (
        <CategoryHistory
          range={range}
          insights={insights}
          category={history.category}
          flow={history.flow}
        />
      ) : (
        // The range and currency own the column selection's lifetime; changing either starts from the selected range again.
        <InsightsPanels key={`${serializeRange(range)}:${currency}`} range={range} insights={insights} />
      )}
    </>
  );
}

function InsightsPanels({
  range,
  insights
}: {
  range: PeriodRange;
  insights: Area<Insights>;
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
      />
    </div>
  );
}

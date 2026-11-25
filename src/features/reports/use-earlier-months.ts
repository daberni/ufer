"use client";

import { useState } from "react";
import { useCashFlowHistory } from "@/features/reports/queries";
import type { Area } from "@/components/ui/use-area-result";
import type { CashFlow } from "@/features/reports/types";

/** Earlier months the chart can scroll to: whether more may exist before the loaded ones, and how to ask for the next batch. */
export type EarlierMonths = {
  hasEarlier: boolean;
  load: () => void;
};

/**
 * Extends the trend with earlier months, loaded in batches as the chart asks for them. The first batch is only requested once the chart scrolls towards its start; later batches follow while counted transactions remain before the oldest loaded month.
 */
export function useEarlierMonths(cashFlow: Area<CashFlow>, currency: string): {
  cashFlow: Area<CashFlow>;
  earlier: EarlierMonths;
} {
  const [requested, setRequested] = useState(false);
  const firstMonth = cashFlow.data?.trend[0]?.month;
  const history = useCashFlowHistory(firstMonth ?? "", currency, requested && firstMonth !== undefined);
  const pages = history.data?.pages ?? [];
  // Pages run backwards in time: each one ends before the previous one starts.
  const olderFirst = [...pages].reverse();
  const oldest = olderFirst.find(page => page.trend.length > 0);
  const hasEarlier = !requested || history.data === undefined || history.hasNextPage;

  function load() {
    if (!requested) {
      setRequested(true);
    } else if (history.isFetching) {
      return;
    } else if (history.data === undefined) {
      void history.refetch();
    } else if (history.hasNextPage) {
      void history.fetchNextPage();
    }
  }

  const extended: Area<CashFlow> = cashFlow.status === "pending" || !oldest ? cashFlow : {
    ...cashFlow,
    data: {
      ...cashFlow.data,
      leadIn: oldest.leadIn,
      trend: [...olderFirst.flatMap(page => page.trend), ...cashFlow.data.trend]
    }
  };

  return {
    cashFlow: extended,
    earlier: {
      hasEarlier,
      load
    }
  };
}

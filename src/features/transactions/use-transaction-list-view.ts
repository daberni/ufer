"use client";

import { useEffect } from "react";
import { lastPage } from "@/features/dashboard/pagination";
import { useAreaResult } from "@/features/dashboard/use-area-result";
import type { DashboardQuery } from "@/features/dashboard/dashboard-location";
import { useTransactionList } from "./queries";

/**
 * The transaction list for the URL's filters. A page past the last one, from a bookmark or after the matching count shrank, is replaced by the last available page once the list for these filters has loaded.
 */
export function useTransactionListView(query: DashboardQuery, replacePage: (page: number) => void) {
  const list = useTransactionList(query);
  const area = useAreaResult(list);
  const current = list.isPlaceholderData ? undefined : list.data;
  const page = current ? Math.min(query.page, lastPage(current.transactionCount)) : query.page;

  useEffect(() => {
    if (page < query.page) {
      replacePage(page);
    }
  }, [page, query.page, replacePage]);

  return {
    ...area,
    /** Whether the data is the response for the URL's filters rather than a placeholder from earlier ones. */
    current: current !== undefined,
    page
  };
}

"use client";

import { useEffect } from "react";
import { lastPage } from "@/lib/pagination";
import { useAreaResult, type Area } from "@/components/ui/use-area-result";
import type { DashboardQuery } from "@/client/dashboard-location";
import type { TransactionPage } from "@/features/transactions/types";
import { useTransactionList } from "./queries";

/**
 * The transaction list for the URL's filters. A page past the last one, from a bookmark or after the matching count shrank, is replaced by the last available page once the list for these filters has loaded.
 */
type TransactionListView = Area<TransactionPage> & {
  /** Whether the data is the response for the URL's filters rather than a placeholder from earlier ones. */
  current: boolean;
  /** The page shown, after correcting a page past the last one. */
  page: number;
};

export function useTransactionListView(query: DashboardQuery, replacePage: (page: number) => void): TransactionListView {
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
    current: current !== undefined,
    page
  };
}

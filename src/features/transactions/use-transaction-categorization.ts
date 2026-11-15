"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { CategorySaveDependencies, CategorySaves } from "./category-saves";
import type { Transaction } from "@/features/dashboard/types";

/**
 * Shows each transaction row's selection immediately while its save runs, the server's answer when it completes,
 * and on failure the last stored category with an error at that row.
 */
export function useTransactionCategorization(saves: CategorySaves, {
  load,
  setState
}: CategorySaveDependencies) {
  const statuses = useSyncExternalStore(saves.subscribe, saves.statuses, saves.statuses);

  const changeCategory = useCallback((transaction: Transaction, categoryId: string | null) => saves.change(transaction, categoryId, {
    load,
    setState
  }), [saves, load, setState]);

  const categoryFor = useCallback((transaction: Transaction) => {
    const status = statuses.get(transaction.id);

    if (status?.kind === "saving") {
      return status.categoryId;
    }

    return transaction.category_id;
  }, [statuses]);

  const statusFor = useCallback((transaction: Transaction) => statuses.get(transaction.id), [statuses]);

  return {
    categoryFor,
    statusFor,
    changeCategory
  };
}

export type TransactionCategorization = ReturnType<typeof useTransactionCategorization>;

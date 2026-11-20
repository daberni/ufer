"use client";

import { useEffect, useState } from "react";
import { useMutation, useMutationState, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, toFailure, type Failure } from "@/client/api";
import { invalidate } from "@/client/invalidate";
import { queryKeys } from "@/client/query-keys";
import type { Transaction, TransactionPage } from "@/features/transactions/types";

export type CategoryAssignment = Pick<Transaction, "id" | "category_id" | "category_source" | "category_rule_id">;

export type CategorizationStatus = {
  kind: "saving";
} | {
  kind: "saved";
} | {
  kind: "failed";
  failure: Failure;
};

const savedIndicatorDuration = 2000;

const categoryMutations = ["transactions", "category"] as const;

function categoryMutationKey(transactionId: string) {
  return [...categoryMutations, transactionId] as const;
}

// Stores the server's assignment in every cached list page that contains the transaction; other transaction queries, such as transfer options, have a different shape.
function storeAssignment(queryClient: QueryClient, assignment: CategoryAssignment) {
  queryClient.setQueriesData<TransactionPage>({
    queryKey: queryKeys.transactions.lists()
  }, page => {
    if (!page?.transactions.some(transaction => transaction.id === assignment.id)) {
      return page;
    }

    return {
      ...page,
      transactions: page.transactions.map(transaction => transaction.id === assignment.id ? {
        ...transaction,
        category_id: assignment.category_id,
        category_source: assignment.category_source,
        category_rule_id: assignment.category_rule_id
      } : transaction)
    };
  });
}

/**
 * A transaction row's category. A change shows at once while it is saved; changes to one transaction are saved one after another, also across views and remounts, so the latest selection is stored last. Without a pending change the row shows the stored category, so a failed save falls back to it with an error at the row.
 */
export function useTransactionCategory(transaction: Transaction) {
  const queryClient = useQueryClient();
  const mutationKey = categoryMutationKey(transaction.id);

  const mutation = useMutation({
    mutationKey,
    // Mutations with the same scope run in order, each after the previous one has settled.
    scope: {
      id: `transaction-category:${transaction.id}`
    },
    mutationFn: (categoryId: string | null) => api<CategoryAssignment>(`transactions/${encodeURIComponent(transaction.id)}`, {
      category_id: categoryId
    }, "PATCH"),
    onSuccess: assignment => storeAssignment(queryClient, assignment),
    onSettled: () => {
      // Totals, filtered lists and rule-preview counts depend on assignments; refresh after this row's last save settles.
      // The settling change itself still counts as pending here.
      if (queryClient.isMutating({
        mutationKey
      }) <= 1) {
        void invalidate(queryClient, [queryKeys.transactions.all(), queryKeys.reports.cashFlow(), queryKeys.rules()]);
      }
    },
    // A settled result is only shown briefly once the row is no longer on screen; pending changes are never collected.
    gcTime: savedIndicatorDuration
  });

  const changes = useMutationState({
    filters: {
      mutationKey
    },
    select: change => ({
      id: change.mutationId,
      status: change.state.status,
      categoryId: change.state.variables as string | null,
      error: change.state.error
    })
  });

  const pending = changes.filter(change => change.status === "pending").at(-1);
  const latest = changes.at(-1);
  const savedChange = latest?.status === "success" ? latest.id : undefined;
  const [expiredSave, setExpiredSave] = useState<number>();

  useEffect(() => {
    if (savedChange === undefined) {
      return;
    }

    const timer = setTimeout(() => setExpiredSave(savedChange), savedIndicatorDuration);

    return () => clearTimeout(timer);
  }, [savedChange]);

  return {
    categoryId: pending ? pending.categoryId : transaction.category_id,
    status: categorizationStatus(pending !== undefined, latest, savedChange !== undefined && savedChange !== expiredSave),
    change: (categoryId: string | null) => mutation.mutate(categoryId),
    /** Saves a category like change, settling once stored; for a form that closes only after its save. */
    assign: (categoryId: string | null) => mutation.mutateAsync(categoryId)
  };
}

function categorizationStatus(saving: boolean, latest: {
  status: string;
  error: Error | null;
} | undefined, saved: boolean): CategorizationStatus | undefined {
  if (saving) {
    return {
      kind: "saving"
    };
  }

  if (latest?.status === "error") {
    return {
      kind: "failed",
      failure: toFailure(latest.error)
    };
  }

  return saved ? {
    kind: "saved"
  } : undefined;
}

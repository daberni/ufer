"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/client/api";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import type { Transaction } from "@/features/dashboard/types";

export type CategoryAssignment = Pick<Transaction, "id" | "category_id" | "category_source">;

export type CategorizationStatus = {
  kind: "saving";
  categoryId: string | null;
} | {
  kind: "saved";
} | {
  kind: "failed";
  message: string;
};

type Save = {
  desired: string | null;
};

type Dependencies = Pick<DashboardController, "load" | "setError" | "setState">;

const savedIndicatorDuration = 2000;

/**
 * Saves category changes per transaction row: the row shows the selection immediately, the server's answer
 * replaces it, and a failure restores the last stored category with an error at that row.
 */
export function useTransactionCategorization({
  load,
  setError,
  setState
}: Dependencies) {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, CategorizationStatus>>(() => new Map());
  const saves = useRef(new Map<string, Save>());
  const savedTimers = useRef(new Map<string, number>());

  useEffect(() => {
    const timers = savedTimers.current;

    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const updateStatus = useCallback((id: string, status: CategorizationStatus | null) => {
    setStatuses(current => {
      const next = new Map(current);

      if (status) {
        next.set(id, status);
      } else {
        next.delete(id);
      }

      return next;
    });
  }, []);

  const setStatus = useCallback((id: string, status: CategorizationStatus) => {
    window.clearTimeout(savedTimers.current.get(id));
    savedTimers.current.delete(id);
    updateStatus(id, status);

    if (status.kind === "saved") {
      const timer = window.setTimeout(() => {
        savedTimers.current.delete(id);
        updateStatus(id, null);
      }, savedIndicatorDuration);

      savedTimers.current.set(id, timer);
    }
  }, [updateStatus]);

  const applyAssignment = useCallback((assignment: CategoryAssignment) => {
    setState(current => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        transactions: current.transactions.map(transaction => transaction.id === assignment.id ? {
          ...transaction,
          category_id: assignment.category_id,
          category_source: assignment.category_source
        } : transaction)
      };
    });
  }, [setState]);

  // Totals and spending depend on categories. The refresh keeps the current figures visible until it completes.
  const refreshInBackground = useCallback(() => {
    load().catch(error => {
      if (error.name !== "AbortError") {
        setError(error.message);
      }
    });
  }, [load, setError]);

  const changeCategory = useCallback(async (transaction: Transaction, categoryId: string | null) => {
    const running = saves.current.get(transaction.id);

    setStatus(transaction.id, {
      kind: "saving",
      categoryId
    });

    // Requests for one row are sent one after another, so the server stores the latest selection last.
    if (running) {
      running.desired = categoryId;

      return;
    }

    const save: Save = {
      desired: categoryId
    };
    let confirmed: CategoryAssignment | undefined;
    let failure: unknown;
    let requested: string | null;

    saves.current.set(transaction.id, save);

    do {
      requested = save.desired;

      try {
        confirmed = await api<CategoryAssignment>(`transactions/${encodeURIComponent(transaction.id)}`, {
          category_id: requested
        }, "PATCH");
        failure = undefined;
      } catch (error) {
        failure = error;
      }
    } while (save.desired !== requested);

    saves.current.delete(transaction.id);

    if (confirmed) {
      applyAssignment(confirmed);
      refreshInBackground();
    }

    if (failure) {
      setStatus(transaction.id, {
        kind: "failed",
        message: failure instanceof Error ? failure.message : "Request failed."
      });

      return;
    }

    setStatus(transaction.id, {
      kind: "saved"
    });
  }, [applyAssignment, refreshInBackground, setStatus]);

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

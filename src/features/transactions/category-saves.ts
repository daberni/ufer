import type { Dispatch, SetStateAction } from "react";
import { api, failureMessage } from "@/client/api";
import type { State, Transaction } from "@/features/dashboard/types";

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

export type CategorySaveDependencies = {
  load: () => Promise<void>;
  setState: Dispatch<SetStateAction<State | null>>;
};

type Save = {
  desired: string | null;
  dependencies: CategorySaveDependencies;
};

const savedIndicatorDuration = 2000;

/**
 * Per-transaction category saves for one dashboard. It outlives the views that show transactions, so a row
 * changed again after leaving and returning to a view still waits for its earlier request.
 */
export function createCategorySaves() {
  let statuses: ReadonlyMap<string, CategorizationStatus> = new Map();
  const listeners = new Set<() => void>();
  const saves = new Map<string, Save>();
  const savedTimers = new Map<string, number>();

  function updateStatus(id: string, status: CategorizationStatus | null) {
    const next = new Map(statuses);

    if (status) {
      next.set(id, status);
    } else {
      next.delete(id);
    }

    statuses = next;

    for (const listener of listeners) {
      listener();
    }
  }

  function setStatus(id: string, status: CategorizationStatus) {
    window.clearTimeout(savedTimers.get(id));
    savedTimers.delete(id);
    updateStatus(id, status);

    if (status.kind === "saved") {
      const timer = window.setTimeout(() => {
        savedTimers.delete(id);
        updateStatus(id, null);
      }, savedIndicatorDuration);

      savedTimers.set(id, timer);
    }
  }

  function applyAssignment(assignment: CategoryAssignment, { setState }: CategorySaveDependencies) {
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
  }

  async function change(transaction: Transaction, categoryId: string | null, dependencies: CategorySaveDependencies) {
    const running = saves.get(transaction.id);

    setStatus(transaction.id, {
      kind: "saving",
      categoryId
    });

    // Requests for one row are sent one after another, so the server stores the latest selection last.
    if (running) {
      running.desired = categoryId;
      running.dependencies = dependencies;

      return;
    }

    const save: Save = {
      desired: categoryId,
      dependencies
    };
    let confirmed: CategoryAssignment | undefined;
    let failure: unknown;
    let requested: string | null;

    saves.set(transaction.id, save);

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

    saves.delete(transaction.id);

    if (confirmed) {
      applyAssignment(confirmed, save.dependencies);
      // Totals and spending depend on categories. The refresh keeps the current figures visible and reports its own failures.
      void save.dependencies.load();
    }

    if (failure) {
      setStatus(transaction.id, {
        kind: "failed",
        message: failureMessage(failure)
      });

      return;
    }

    setStatus(transaction.id, {
      kind: "saved"
    });
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    statuses: () => statuses,
    change
  };
}

export type CategorySaves = ReturnType<typeof createCategorySaves>;

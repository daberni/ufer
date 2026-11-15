"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiError, failureMessage } from "@/client/api";
import { currentMonthPeriod, serializePeriod, type Period } from "./period";
import type { State } from "./types";

/** The request parameters that select a dashboard response, in their query form. */
type DashboardQuery = {
  period: string;
  currency: string;
  page: string;
  search: string;
  account: string;
  category: string;
};

/**
 * Whether a result area shows values for the selected filters, is loading them, or could not load them. Each area depends only on the filters that change its server result.
 */
export type ResultStatus = "ready" | "loading" | "unavailable";

export type DashboardResults = {
  netWorth: ResultStatus;
  cashFlow: ResultStatus;
  transactions: ResultStatus;
};

const queryKeys: (keyof DashboardQuery)[] = ["period", "currency", "page", "search", "account", "category"];

// Responses faster than this replace the previous values without showing a skeleton first.
const skeletonDelay = 250;

export function useDashboardData() {
  const [loaded, setLoaded] = useState<{
    state: State;
    query: DashboardQuery;
  } | null>(null);

  const [loadError, setLoadError] = useState("");

  // The selection whose latest request failed; its outdated areas are unavailable rather than loading.
  const [failedQuery, setFailedQuery] = useState<DashboardQuery | null>(null);

  const [period, setPeriod] = useState<Period>(() => currentMonthPeriod());

  const [currency, setCurrency] = useState("EUR");

  const [search, setSearch] = useState("");

  const [accountFilter, setAccountFilter] = useState("");

  const [categoryFilter, setCategoryFilter] = useState("");

  const [page, setPage] = useState(1);

  const [locked, updateLocked] = useState(false);
  const lockedRef = useRef(false);
  const requestVersion = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const selected: DashboardQuery = {
    period: serializePeriod(period),
    currency,
    page: String(page),
    search,
    account: accountFilter,
    category: categoryFilter
  };
  const query = new URLSearchParams(selected).toString();
  const latestSelection = useRef(selected);

  useEffect(() => {
    latestSelection.current = selected;
  });

  const state = loaded?.state ?? null;
  const stale = staleAreas(loaded?.query, selected);
  // The transaction list depends on every filter, so it is stale whenever any area is.
  const slow = useDelayedActivity(stale.transactions, skeletonDelay);
  const failed = failedQuery !== null && !differs(failedQuery, selected, queryKeys);
  const results: DashboardResults = {
    netWorth: resultStatus(stale.netWorth, slow, failed),
    cashFlow: resultStatus(stale.cashFlow, slow, failed),
    transactions: resultStatus(stale.transactions, slow, failed)
  };

  // A different period selects a different result set, so pagination restarts.
  const selectPeriod = useCallback((next: Period) => {
    setPeriod(next);
    setPage(1);
  }, []);

  const invalidateRequests = useCallback(() => {
    requestVersion.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
  }, []);

  const setLocked = useCallback((next: boolean) => {
    lockedRef.current = next;
    invalidateRequests();
    updateLocked(next);

    if (next) {
      setLoaded(null);
    }
  }, [invalidateRequests]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (lockedRef.current || signal?.aborted) {
      return;
    }

    invalidateRequests();
    const version = requestVersion.current;
    // An action may finish after filters change; refresh the current view, not its earlier snapshot.
    const requested = latestSelection.current;
    const controller = new AbortController();

    setFailedQuery(null);
    const abort = () => controller.abort();

    activeRequest.current = controller;
    signal?.addEventListener("abort", abort, {
      once: true
    });

    try {
      const response = await fetch(`/api/state?${new URLSearchParams(requested)}`, {
        cache: "no-store",
        signal: controller.signal
      });
      const data = await response.json();

      if (controller.signal.aborted || version !== requestVersion.current || lockedRef.current) {
        return;
      }

      if (response.status === 401) {
        setLocked(true);

        return;
      }

      if (!response.ok) {
        throw apiError(data, response.status);
      }

      setLoaded({
        state: data,
        query: requested
      });
      setLoadError("");
    } catch (error) {
      // Failures stay visible until a later load succeeds; callers do not handle them separately.
      if (!controller.signal.aborted && version === requestVersion.current && !lockedRef.current) {
        setLoadError(failureMessage(error));
        setFailedQuery(requested);
      }
    } finally {
      signal?.removeEventListener("abort", abort);

      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    }
  }, [invalidateRequests, setLocked]);

  useEffect(() => {
    if (locked) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void load(controller.signal);
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
      invalidateRequests();
    };
  }, [query, load, locked, invalidateRequests]);

  return {
    state,
    results,
    loadError,
    period,
    selectPeriod,
    currency,
    setCurrency,
    search,
    setSearch,
    accountFilter,
    setAccountFilter,
    categoryFilter,
    setCategoryFilter,
    page,
    setPage,
    locked,
    setLocked,
    load
  };
}

function differs(loaded: DashboardQuery | undefined, selected: DashboardQuery, keys: (keyof DashboardQuery)[]) {
  return !loaded || keys.some(key => loaded[key] !== selected[key]);
}

function staleAreas(loaded: DashboardQuery | undefined, selected: DashboardQuery) {
  return {
    netWorth: differs(loaded, selected, ["currency"]),
    cashFlow: differs(loaded, selected, ["currency", "period"]),
    transactions: differs(loaded, selected, queryKeys)
  };
}

function resultStatus(stale: boolean, slow: boolean, failed: boolean): ResultStatus {
  if (!stale) {
    return "ready";
  }

  // Outdated values are masked at once after a failure; the load error banner offers a retry.
  if (failed) {
    return "unavailable";
  }

  return slow ? "loading" : "ready";
}

/** True once `active` has stayed true for `delay` milliseconds, until it becomes false again. */
function useDelayedActivity(active: boolean, delay: number) {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) {
      return;
    }

    const timer = setTimeout(() => setElapsed(true), delay);

    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [active, delay]);

  return active && elapsed;
}

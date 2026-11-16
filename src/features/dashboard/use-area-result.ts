"use client";

import { useEffect, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";

/**
 * Whether an area shows results for the selected filters, is loading them, or could not load them.
 */
export type ResultStatus = "ready" | "loading" | "unavailable";

/** Results that arrive faster than this replace the previous ones without a loading state first. */
export const loadingDelay = 250;

/**
 * Presents a filter-keyed query for one dashboard area. While results for new filters load, the previous results stay in place: unmarked at first, then marked as loading. A failed request ends loading and keeps them only as an unavailable placeholder, so the layout does not jump.
 */
export function useAreaResult<T>(query: Pick<UseQueryResult<T>, "data" | "isPlaceholderData" | "isError" | "isFetching">) {
  const [shown, setShown] = useState(query.data);

  if (query.data !== undefined && query.data !== shown) {
    setShown(query.data);
  }

  const current = query.data !== undefined && !query.isPlaceholderData;
  const slow = useDelayedActivity(!current, loadingDelay);

  return {
    data: query.data ?? shown,
    status: resultStatus(current, slow, query.isError && !query.isFetching)
  };
}

function resultStatus(current: boolean, slow: boolean, failed: boolean): ResultStatus {
  if (current) {
    return "ready";
  }

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

/** An area's results as the components render them: loaded data and whether it matches the selected filters. */
export type AreaResult<T> = {
  data: T;
  status: ResultStatus;
};

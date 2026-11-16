"use client";

import { useEffect, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { toFailure, type Failure } from "@/client/api";

/**
 * Whether an area shows results for the selected filters, is loading them, or could not load them.
 */
export type ResultStatus = "ready" | "loading" | "unavailable";

/** Results that arrive faster than this replace the previous ones without a loading state first. */
export const loadingDelay = 250;

/** A failed first load as its area reports it. */
export type LoadFailure = Failure & {
  retry: () => void;
};

/** An area before its first results: it shows a skeleton of its final layout, or the failure with a retry. */
export type PendingArea = {
  status: "pending";
  data?: undefined;
  failure: LoadFailure | null;
};

/** An area's results as the components render them: loaded data and whether it matches the selected filters. */
export type AreaResult<T> = {
  data: T;
  status: ResultStatus;
};

export type Area<T> = AreaResult<T> | PendingArea;

type AreaQuery<T> = Pick<UseQueryResult<T>, "data" | "error" | "isPlaceholderData" | "isError" | "isFetching" | "refetch">;

/**
 * Presents a query for one dashboard area. Before the first results the area is pending. While results for new filters load, the previous results stay in place: unmarked at first, then marked as loading. A failed request ends loading and keeps them only as an unavailable placeholder, so the layout does not jump.
 */
export function useAreaResult<T>(query: AreaQuery<T>): Area<T> {
  const [shown, setShown] = useState(query.data);

  if (query.data !== undefined && query.data !== shown) {
    setShown(query.data);
  }

  const current = query.data !== undefined && !query.isPlaceholderData;
  const slow = useDelayedActivity(!current, loadingDelay);
  const failed = query.isError && !query.isFetching;
  const data = query.data ?? shown;

  if (data === undefined) {
    return {
      status: "pending",
      failure: failed ? {
        ...toFailure(query.error),
        retry: () => void query.refetch()
      } : null
    };
  }

  return {
    data,
    status: resultStatus(current, slow, failed)
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

/** Derives the part of an area's results a component shows, keeping the area's state. */
export function mapArea<T, U>(area: Area<T>, select: (data: T) => U): Area<U> {
  if (area.status === "pending") {
    return area;
  }

  return {
    data: select(area.data),
    status: area.status
  };
}

/** Several areas that render as one before all of them have results; it reports the first failure and retries every failed load. */
export function pendingTogether(...areas: Area<unknown>[]): PendingArea {
  const failures = areas.flatMap(area => area.status === "pending" && area.failure ? [area.failure] : []);

  if (!failures.length) {
    return {
      status: "pending",
      failure: null
    };
  }

  return {
    status: "pending",
    failure: {
      message: failures[0].message,
      traceId: failures[0].traceId,
      retry: () => {
        for (const failure of failures) {
          failure.retry();
        }
      }
    }
  };
}

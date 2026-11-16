"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { toFailure } from "@/client/api";

// The query cache clears the error of a query without data when it is fetched again; the banner keeps the last failure until a load succeeds.
const lastErrors = new WeakMap<Query, unknown>();

// Failed more recently than it loaded: true from a failure until the next successful load, including while a retry runs.
function failedOnScreen(query: Query) {
  return query.isActive() && query.state.errorUpdatedAt > query.state.dataUpdatedAt;
}

/**
 * The failure of a query shown on screen, reported once for the dashboard with a retry. It stays visible while a retry runs and disappears when the failed queries load successfully or leave the screen.
 */
export function useLoadError() {
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache();

  useEffect(() => cache.subscribe(event => {
    if (event.type === "updated" && event.action.type === "error") {
      lastErrors.set(event.query, event.action.error);
    }
  }), [cache]);

  const subscribe = useCallback((listener: () => void) => cache.subscribe(listener), [cache]);

  // The error object itself is the snapshot: it keeps its identity between reads, unlike a derived failure.
  const error = useSyncExternalStore(subscribe, () => {
    const failed = cache.findAll({
      predicate: failedOnScreen
    })[0];

    return failed ? failed.state.error ?? lastErrors.get(failed) ?? null : null;
  }, () => null);

  const retry = useCallback(() => {
    void queryClient.refetchQueries({
      predicate: failedOnScreen
    });
  }, [queryClient]);

  return {
    failure: error ? toFailure(error) : null,
    retry
  };
}

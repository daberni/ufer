"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { toFailure } from "@/client/api";

// The query cache clears the error of a query without data when it is fetched again; the banner keeps the last failure until a load succeeds.
const lastErrors = new WeakMap<Query, unknown>();

// Whether a query's area showed results, its own or those kept from earlier filters, when its latest fetch started. Queries fetched before the dashboard subscribed are first loads.
const keptResults = new WeakMap<Query, boolean>();

function showsResults(query: Query) {
  return query.observers.some(observer => observer.getCurrentResult().data !== undefined);
}

// Failed more recently than it loaded: true from a failure until the next successful load, including while a retry runs.
function failed(query: Query) {
  return query.state.errorUpdatedAt > query.state.dataUpdatedAt;
}

// An area that keeps earlier results reports its failure in the banner; an area without results reports it in place, where its skeleton was.
function failedOnScreen(query: Query) {
  return query.isActive() && failed(query) && keptResults.get(query) === true;
}

function awaitsFirstResults(query: Query) {
  return query.isActive() && keptResults.get(query) !== true && !showsResults(query);
}

/**
 * The dashboard's load status. A failed query whose area keeps earlier results is reported once with a retry; it stays visible while a retry runs and disappears when the failed queries load successfully or leave the screen. Areas without results show skeletons hidden from assistive technology, so a single polite announcement reports that they are loading or that some could not be loaded.
 */
export function useLoadError() {
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache();

  useEffect(() => cache.subscribe(event => {
    if (event.type !== "updated") {
      return;
    }

    if (event.action.type === "fetch") {
      keptResults.set(event.query, showsResults(event.query));
    }

    if (event.action.type === "error") {
      lastErrors.set(event.query, event.action.error);
    }
  }), [cache]);

  const subscribe = useCallback((listener: () => void) => cache.subscribe(listener), [cache]);

  // The error object itself is the snapshot: it keeps its identity between reads, unlike a derived failure.
  const error = useSyncExternalStore(subscribe, () => {
    const failedQuery = cache.findAll({
      predicate: failedOnScreen
    })[0];

    return failedQuery ? failedQuery.state.error ?? lastErrors.get(failedQuery) ?? null : null;
  }, () => null);

  const announcement = useSyncExternalStore(subscribe, () => {
    const waiting = cache.findAll({
      predicate: awaitsFirstResults
    });

    if (waiting.some(query => query.state.status === "error")) {
      return "Some of your data could not be loaded.";
    }

    return waiting.length ? "Loading your data …" : "";
  }, () => "");

  const retry = useCallback(() => {
    void queryClient.refetchQueries({
      predicate: failedOnScreen
    });
  }, [queryClient]);

  return {
    failure: error ? toFailure(error) : null,
    retry,
    announcement
  };
}

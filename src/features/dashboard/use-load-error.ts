"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { failureMessage } from "@/client/api";

function failedOnScreen(query: Query) {
  return query.state.status === "error" && query.isActive();
}

/**
 * The failure of a query shown on screen, reported once for the dashboard with a retry. It stays until the failed queries load successfully or leave the screen.
 */
export function useLoadError() {
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache();

  const subscribe = useCallback((listener: () => void) => cache.subscribe(listener), [cache]);

  const message = useSyncExternalStore(subscribe, () => {
    const failed = cache.findAll({
      predicate: failedOnScreen
    })[0];

    return failed ? failureMessage(failed.state.error) : "";
  }, () => "");

  const retry = useCallback(() => {
    void queryClient.refetchQueries({
      predicate: failedOnScreen
    });
  }, [queryClient]);

  return {
    message,
    retry
  };
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorStatus } from "@/client/api";

/**
 * Whether the dashboard shows the sign-in form. A read rejected with 401 locks it; locking drops all cached financial data and cancels running requests, so a late response cannot restore it. Only a successful sign-in unlocks.
 */
export function useDashboardLock() {
  const queryClient = useQueryClient();

  const [locked, setLocked] = useState(false);

  const lock = useCallback(() => {
    queryClient.clear();
    setLocked(true);
  }, [queryClient]);

  const unlock = useCallback(() => {
    setLocked(false);
  }, []);

  useEffect(() => queryClient.getQueryCache().subscribe(event => {
    if (event.type === "updated" && event.action.type === "error" && errorStatus(event.action.error) === 401) {
      lock();
    }
  }), [queryClient, lock]);

  return {
    locked,
    lock,
    unlock
  };
}

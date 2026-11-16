"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient, type Mutation } from "@tanstack/react-query";
import { errorStatus } from "@/client/api";
import { endSessionEpoch } from "@/client/session-epoch";

/** Marks a mutation that signs in: its 401 means wrong credentials, shown in its form, not an ended session. */
export const signInMeta = {
  signIn: true
};

function endsSession(error: unknown) {
  return errorStatus(error) === 401;
}

function signsIn(mutation: Mutation<unknown, unknown, unknown, unknown>) {
  return mutation.meta?.signIn === true;
}

/**
 * Whether the dashboard shows the sign-in form. Any read or write rejected with 401 locks it; locking drops all cached financial data and pending changes and cancels running requests, so a late response cannot restore them. Only a successful sign-in unlocks.
 */
export function useDashboardLock() {
  const queryClient = useQueryClient();

  const [locked, setLocked] = useState(false);

  const lock = useCallback(() => {
    endSessionEpoch();
    queryClient.clear();
    setLocked(true);
  }, [queryClient]);

  const unlock = useCallback(() => {
    setLocked(false);
  }, []);

  useEffect(() => {
    const unsubscribeQueries = queryClient.getQueryCache().subscribe(event => {
      if (event.type === "updated" && event.action.type === "error" && endsSession(event.action.error)) {
        lock();
      }
    });
    const unsubscribeMutations = queryClient.getMutationCache().subscribe(event => {
      if (event.type === "updated" && event.action.type === "error" && endsSession(event.action.error) && !signsIn(event.mutation)) {
        lock();
      }
    });

    return () => {
      unsubscribeQueries();
      unsubscribeMutations();
    };
  }, [queryClient, lock]);

  return {
    locked,
    lock,
    unlock
  };
}

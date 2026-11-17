"use client";

import { useCallback, useEffect } from "react";
import { useQueryClient, type Mutation } from "@tanstack/react-query";
import { errorStatus } from "@/client/api";
import { endSessionEpoch } from "@/client/session-epoch";
import { useAppStore, useAppStoreApi } from "./app-store";

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

/** Shows the sign-in form, which unmounts the dashboard and any open dialog. Locking drops all cached financial data and pending changes and cancels running requests, so a late response cannot restore them. */
export function useLockSession() {
  const queryClient = useQueryClient();
  const store = useAppStoreApi();

  return useCallback(() => {
    endSessionEpoch();
    queryClient.clear();
    store.getState().lock();
  }, [queryClient, store]);
}

/**
 * Whether the dashboard shows the sign-in form. Any read or write rejected with 401 locks it; only a successful sign-in unlocks. Used once, by the dashboard layout.
 */
export function useSessionLock() {
  const queryClient = useQueryClient();
  const locked = useAppStore(state => state.locked);
  const unlock = useAppStore(state => state.unlock);
  const lock = useLockSession();

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

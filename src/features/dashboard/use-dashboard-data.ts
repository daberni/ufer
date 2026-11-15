"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiError } from "@/client/api";
import { serializePeriod } from "./period";
import type { DashboardQuery } from "./dashboard-location";
import type { State } from "./types";

/** Loads the dashboard state for the query that the current URL describes. */
export function useDashboardData(filters: DashboardQuery, onError: (message: string) => void) {
  const [state, setState] = useState<State | null>(null);

  const [locked, updateLocked] = useState(false);
  const lockedRef = useRef(false);
  const requestVersion = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const query = new URLSearchParams({
    period: serializePeriod(filters.period),
    currency: filters.currency,
    page: String(filters.page),
    search: filters.search,
    account: filters.account,
    category: filters.category
  }).toString();
  const latestQuery = useRef(query);

  useEffect(() => {
    latestQuery.current = query;
  }, [query]);

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
      setState(null);
    }
  }, [invalidateRequests]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (lockedRef.current || signal?.aborted) {
      return;
    }

    invalidateRequests();
    const version = requestVersion.current;
    // An action may finish after filters change; refresh the current view, not its earlier snapshot.
    const currentQuery = latestQuery.current;
    const controller = new AbortController();
    const abort = () => controller.abort();

    activeRequest.current = controller;
    signal?.addEventListener("abort", abort, {
      once: true
    });

    try {
      const response = await fetch(`/api/state?${currentQuery}`, {
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

      setState(data);
    } catch (error) {
      if (!controller.signal.aborted && version === requestVersion.current && !lockedRef.current) {
        throw error;
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
      load(controller.signal).catch(error => {
        if (error.name !== "AbortError") {
          onError(error.message);
        }
      });
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
      invalidateRequests();
    };
  }, [query, load, onError, locked, invalidateRequests]);

  return {
    state,
    setState,
    locked,
    setLocked,
    load
  };
}

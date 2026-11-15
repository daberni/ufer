"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { viennaMonth } from "@/lib/money";
import { apiError, failureMessage } from "@/client/api";
import type { State } from "./types";

export function useDashboardData() {
  const [state, setState] = useState<State | null>(null);

  const [loadError, setLoadError] = useState("");

  const [month, setMonth] = useState(viennaMonth());

  const [currency, setCurrency] = useState("EUR");

  const [search, setSearch] = useState("");

  const [accountFilter, setAccountFilter] = useState("");

  const [categoryFilter, setCategoryFilter] = useState("");

  const [allMonths, setAllMonths] = useState(false);

  const [page, setPage] = useState(1);

  const [locked, updateLocked] = useState(false);
  const lockedRef = useRef(false);
  const requestVersion = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const query = new URLSearchParams({
    month,
    currency,
    page: String(page),
    search,
    account: accountFilter,
    category: categoryFilter,
    allMonths: allMonths ? "1" : "0"
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
      setLoadError("");
    } catch (error) {
      // Failures stay visible until a later load succeeds; callers do not handle them separately.
      if (!controller.signal.aborted && version === requestVersion.current && !lockedRef.current) {
        setLoadError(failureMessage(error));
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
    setState,
    loadError,
    month,
    setMonth,
    currency,
    setCurrency,
    search,
    setSearch,
    accountFilter,
    setAccountFilter,
    categoryFilter,
    setCategoryFilter,
    allMonths,
    setAllMonths,
    page,
    setPage,
    locked,
    setLocked,
    load
  };
}

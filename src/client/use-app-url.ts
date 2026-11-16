"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAppStore, useAppStoreApi } from "./app-store";
import { viewQuery, isPeriodAware, periodScope, viewFromPathname, viewHref, viewPaths, withQueryChanges, type ViewQuery, type ViewQueryChanges, type View } from "./app-location";
import type { Period } from "@/lib/period";

/*
 * Typed access to the dashboard URL. Hooks read single parameters for rendering; setters are plain functions that read window.location when called, so components that only change the URL do not subscribe to it. Next.js integrates pushState and replaceState into its router, so the hooks follow these writes as well as links and Back/Forward.
 */

export function useView(): View {
  return viewFromPathname(usePathname());
}

/** The period and currency parameters: the URL's on views that have them, otherwise the last ones selected. */
export function usePeriodScope() {
  const view = useView();
  const searchParams = useSearchParams();
  const remembered = useAppStore(state => state.periodScope);

  return isPeriodAware(view) ? periodScope(searchParams) : remembered;
}

/** Every parameter the current view's data depends on; the transaction list filters are empty outside the transactions view. */
export function useViewQuery(): ViewQuery {
  const view = useView();
  const scope = usePeriodScope();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  return useMemo(() => viewQuery(view, scope, new URLSearchParams(search)), [view, scope, search]);
}

function useViewParameter<K extends keyof ViewQuery>(key: K): ViewQuery[K] {
  return useViewQuery()[key];
}

export function usePeriod() {
  return useViewParameter("period");
}

export function useCurrency() {
  return useViewParameter("currency");
}

export function useSearchFilter() {
  return useViewParameter("search");
}

export function useAccountFilter() {
  return useViewParameter("account");
}

export function useCategoryFilter() {
  return useViewParameter("category");
}

export function useSyncRunFilter() {
  return useViewParameter("syncRun");
}

export function usePage() {
  return useViewParameter("page");
}

/** Links to other views carry the period of the views that have one. */
export function useViewHref() {
  const scope = usePeriodScope();

  return useCallback((view: View) => viewHref(view, scope), [scope]);
}

/** A run's transactions; the period stays in the URL so clearing the run returns to it. */
export function useSyncRunHref() {
  const scope = usePeriodScope();

  return useCallback((id: string) => withQueryChanges(viewPaths.transactions, scope, {
    syncRun: id
  }), [scope]);
}

/** Navigates to another view with the current period, without subscribing the caller to the URL. */
export function useChangeView() {
  const router = useRouter();
  const store = useAppStoreApi();

  return useCallback((view: View) => {
    const current = viewFromPathname(window.location.pathname);
    const scope = isPeriodAware(current) ? periodScope(new URLSearchParams(window.location.search)) : store.getState().periodScope;

    router.push(viewHref(view, scope));
  }, [router, store]);
}

// Filter and page changes stay on the current view; typing a search replaces its history entry instead of adding one per keystroke.
function updateQuery(changes: ViewQueryChanges, entry: "push" | "replace") {
  const current = `${window.location.pathname}${window.location.search}`;
  const next = withQueryChanges(window.location.pathname, window.location.search, changes);

  if (next === current) {
    return;
  }

  if (entry === "push") {
    window.history.pushState(null, "", next);
  } else {
    window.history.replaceState(null, "", next);
  }
}

export function selectPeriod(period: Period) {
  updateQuery({
    period,
    page: 1
  }, "push");
}

export function setCurrency(currency: string) {
  updateQuery({
    currency,
    page: 1
  }, "push");
}

export function setSearch(search: string) {
  updateQuery({
    search,
    page: 1
  }, "replace");
}

export function setAccountFilter(account: string) {
  updateQuery({
    account,
    page: 1
  }, "push");
}

export function setCategoryFilter(category: string) {
  updateQuery({
    category,
    page: 1
  }, "push");
}

export function setSyncRun(syncRun: string) {
  updateQuery({
    syncRun,
    page: 1
  }, "push");
}

export function setPage(page: number) {
  updateQuery({
    page
  }, "push");
}

/** Corrects a page past the last one, from a bookmark or after the matching count shrank, in place. */
export function replacePage(page: number) {
  updateQuery({
    page
  }, "replace");
}

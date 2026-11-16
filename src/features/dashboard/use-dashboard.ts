"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDashboardLock } from "./use-dashboard-lock";
import { failureMessage } from "@/client/api";
import type { ImportMode } from "@/features/imports/mutations";
import { useActionFeedback, type Feedback } from "@/components/ui/use-action-feedback";
import { navigation } from "./presentation";
import { monthPeriod, type Period } from "./period";
import { dashboardQuery, isPeriodAware, periodScope, viewFromPathname, viewHref as hrefForView, viewPaths, withQueryChanges, type DashboardQueryChanges } from "./dashboard-location";
import type { Account, Category, View, Modal, Connection } from "./types";
import { callbackFailureMessage, parseCallbackResult, type CallbackResult } from "@/features/banking/callback-result";

export type ActionResult<T> = {
  ok: true;
  value: T;
} | {
  ok: false;
  message: string;
};

/** Waits for an action, such as a mutation, and turns its failure into a message for the place where the action was started. */
export async function settle<T>(action: Promise<T>): Promise<ActionResult<T>> {
  try {
    return {
      ok: true,
      value: await action
    };
  } catch (error) {
    return {
      ok: false,
      message: failureMessage(error)
    };
  }
}

export function useDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = viewFromPathname(pathname);
  const urlScope = periodScope(searchParams);

  const [rememberedScope, setRememberedScope] = useState(urlScope);

  // Overview and transactions share the period; other views keep the last one for their links back and their data request.
  if (isPeriodAware(view) && urlScope !== rememberedScope) {
    setRememberedScope(urlScope);
  }

  const scope = isPeriodAware(view) ? urlScope : rememberedScope;
  const query = dashboardQuery(view, scope, searchParams);

  const [openModal, setOpenModal] = useState<{
    modal: Modal;
    pathname: string;
  }>({
    modal: null,
    pathname
  });

  // A dialog belongs to the view it was opened on; navigating away, including with Back, closes it.
  if (openModal.modal && openModal.pathname !== pathname) {
    setOpenModal({
      modal: null,
      pathname
    });
  }

  const modal = openModal.modal;

  const setModal = useCallback((next: Modal) => {
    setOpenModal({
      modal: next,
      pathname
    });
  }, [pathname]);

  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);

  // Page-level overlay for feedback without a surviving trigger, such as a bank callback result. Navigating to another view, including with Back or Forward, drops it.
  const {
    feedback,
    report: reportFeedback,
    dismiss: dismissFeedback
  } = useActionFeedback(pathname);

  const {
    locked,
    lock,
    unlock
  } = useDashboardLock();
  const [importMode, setImportMode] = useState<ImportMode>("balances");

  // The bank callback returns to the connections view with its result, which is shown once and removed from the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = parseCallbackResult(params.get("banking"));

    if (!params.has("banking")) {
      return;
    }

    if (result) {
      reportFeedback(bankingCallbackFeedback(result));
    }

    params.delete("banking");
    const rest = params.toString();

    router.replace(rest ? `${window.location.pathname}?${rest}` : window.location.pathname, {
      scroll: false
    });
  }, [reportFeedback, router]);

  // Filter and page changes stay on the current view; typing a search replaces its history entry instead of adding one per keystroke.
  const updateQuery = useCallback((changes: DashboardQueryChanges, entry: "push" | "replace") => {
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
  }, []);

  const selectPeriod = useCallback((next: Period) => {
    updateQuery({
      period: next,
      page: 1
    }, "push");
  }, [updateQuery]);

  const setCurrency = useCallback((next: string) => {
    updateQuery({
      currency: next,
      page: 1
    }, "push");
  }, [updateQuery]);

  const setSearch = useCallback((next: string) => {
    updateQuery({
      search: next,
      page: 1
    }, "replace");
  }, [updateQuery]);

  const setAccountFilter = useCallback((next: string) => {
    updateQuery({
      account: next,
      page: 1
    }, "push");
  }, [updateQuery]);

  const setCategoryFilter = useCallback((next: string) => {
    updateQuery({
      category: next,
      page: 1
    }, "push");
  }, [updateQuery]);

  const setSyncRun = useCallback((next: string) => {
    updateQuery({
      syncRun: next,
      page: 1
    }, "push");
  }, [updateQuery]);

  const setPage = useCallback((next: number) => {
    updateQuery({
      page: next
    }, "push");
  }, [updateQuery]);

  // A page past the last one, from a bookmark or after the matching count shrank, is corrected in place.
  const replacePage = useCallback((next: number) => {
    updateQuery({
      page: next
    }, "replace");
  }, [updateQuery]);

  function viewHref(next: View) {
    return hrefForView(next, scope);
  }

  // The run's transactions; the remembered period stays in the URL so clearing the run returns to it.
  function syncRunHref(id: string) {
    return withQueryChanges(viewPaths.transactions, scope, {
      syncRun: id
    });
  }

  function changeView(next: View) {
    router.push(viewHref(next));
  }

  function moveMonth(delta: number) {
    const period = query.period;

    if (period.kind !== "month") {
      return;
    }

    selectPeriod(monthPeriod(period.month.add({
      months: delta
    })));
  }

  function openBank(connection?: Connection) {
    setSelectedConnection(connection ?? null);
    setModal("bank");
  }

  function openConnectionRemoval(connection: Connection) {
    setSelectedConnection(connection);
    setModal("removeConnection");
  }


  const {
    period,
    currency,
    search,
    account: accountFilter,
    category: categoryFilter,
    syncRun,
    page
  } = query;

  const nav = navigation.find(item => item.id === view)!;

  return {
    view,
    viewHref,
    query,
    period,
    selectPeriod,
    currency,
    setCurrency,
    search,
    setSearch,
    accountFilter,
    setAccountFilter,
    categoryFilter,
    setCategoryFilter,
    syncRun,
    setSyncRun,
    syncRunHref,
    page,
    setPage,
    replacePage,
    modal,
    setModal,
    selectedAccount,
    setSelectedAccount,
    selectedCategory,
    setSelectedCategory,
    selectedConnection,
    feedback,
    reportFeedback,
    dismissFeedback,
    locked,
    lock,
    unlock,
    importMode,
    setImportMode,
    changeView,
    moveMonth,
    openBank,
    openConnectionRemoval,
    nav
  };
}

function bankingCallbackFeedback(result: CallbackResult): Feedback {
  if (result === "connected") {
    return {
      tone: "success",
      messages: ["Bank connected. Select “Sync” to retrieve balances and transactions for the first time."]
    };
  }

  return {
    tone: "problem",
    messages: [callbackFailureMessage(result)]
  };
}

export type DashboardController = ReturnType<typeof useDashboard>;

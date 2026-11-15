"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDashboardData } from "./use-dashboard-data";
import { useBankDirectory } from "@/features/banking/use-bank-directory";
import { failureMessage } from "@/client/api";
import { useActionFeedback, type Feedback } from "@/components/ui/use-action-feedback";
import { navigation } from "./presentation";
import { monthPeriod, type Period } from "./period";
import { lastPage } from "./pagination";
import { dashboardQuery, isPeriodAware, periodScope, viewFromPathname, viewHref as hrefForView, withQueryChanges, type DashboardQueryChanges } from "./dashboard-location";
import type { Account, Category, View, Modal, Connection } from "./types";

export type ActionResult<T> = {
  ok: true;
  value: T;
} | {
  ok: false;
  message: string;
};

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

  const [busy, setBusy] = useState(false);

  // Page-level overlay for feedback without a surviving trigger, such as a bank callback result. Navigating to another view, including with Back or Forward, drops it.
  const {
    feedback,
    report: reportFeedback,
    dismiss: dismissFeedback
  } = useActionFeedback(pathname);

  const {
    state,
    setState,
    stateIsCurrent,
    loadError,
    locked,
    setLocked,
    load
  } = useDashboardData(query);
  const {
    banks,
    setBanks,
    bankCountry,
    setBankCountry,
    bankSearch,
    setBankSearch,
    bankName,
    setBankName,
    banksLoading,
    setBanksLoading,
    banksError
  } = useBankDirectory(modal === "bank");

  const [importMode, setImportMode] = useState("balances");

  // The bank callback returns to the connections view with its result, which is shown once and removed from the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("banking");

    if (!result) {
      return;
    }

    reportFeedback(bankingCallbackFeedback(result));
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

  const setPage = useCallback((next: number) => {
    updateQuery({
      page: next
    }, "push");
  }, [updateQuery]);

  // A bookmarked page, or one left behind when the matching count shrinks, can lie past the last page; the URL is corrected in place.
  const availablePage = stateIsCurrent && state ? Math.min(query.page, lastPage(state.transactionCount)) : query.page;

  useEffect(() => {
    if (view === "transactions" && availablePage < query.page) {
      updateQuery({
        page: availablePage
      }, "replace");
    }
  }, [view, availablePage, query.page, updateQuery]);

  function viewHref(next: View) {
    return hrefForView(next, scope);
  }

  // Runs an action and refreshes the dashboard; the caller presents the result where the action happened.
  async function perform<T>(action: () => Promise<T>): Promise<ActionResult<T>> {
    let result: ActionResult<T>;

    setBusy(true);

    try {
      result = {
        ok: true,
        value: await action()
      };
    } catch (error) {
      result = {
        ok: false,
        message: failureMessage(error)
      };
    }

    // A failed action may still have changed server state, so the dashboard is refreshed either way.
    try {
      await load();
    } finally {
      setBusy(false);
    }

    return result;
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
    setBankName(connection?.bank_name || "");
    setBankSearch("");
    setBankCountry(connection?.bank_country || "AT");
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
    category: categoryFilter
  } = query;
  const page = availablePage;

  const currencies = [...new Set(["EUR", ...(state?.accounts.map(account => account.currency) || [])])];

  const selectedCurrencyAccounts = state?.accounts.filter(account => account.currency === currency) || [];

  const bankAccounts = state?.accounts.filter(account => account.provider === "enable_banking") || [];

  const expiring = bankAccounts.filter(account => account.valid_until && Date.parse(account.valid_until) - Date.now() < 7 * 86400_000);

  const visibleTransactions = view === "overview" ? state?.transactions.slice(0, 5) : state?.transactions;

  const nav = navigation.find(item => item.id === view)!;

  const trend = state?.trend || [];

  const trendMax = Math.max(1, ...trend.flatMap(item => [item.income, item.expenses]));

  const totalExpenses = state?.breakdown.reduce((sum, item) => sum + item.amount, 0) || 0;

  return {
    view,
    viewHref,
    state,
    setState,
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
    page,
    setPage,
    modal,
    setModal,
    selectedAccount,
    setSelectedAccount,
    selectedCategory,
    setSelectedCategory,
    selectedConnection,
    busy,
    setBusy,
    loadError,
    feedback,
    reportFeedback,
    dismissFeedback,
    locked,
    setLocked,
    banks,
    setBanks,
    bankCountry,
    setBankCountry,
    bankSearch,
    setBankSearch,
    bankName,
    setBankName,
    banksLoading,
    setBanksLoading,
    banksError,
    importMode,
    setImportMode,
    load,
    perform,
    changeView,
    moveMonth,
    openBank,
    openConnectionRemoval,
    currencies,
    selectedCurrencyAccounts,
    bankAccounts,
    expiring,
    visibleTransactions,
    nav,
    trend,
    trendMax,
    totalExpenses
  };
}

function bankingCallbackFeedback(result: string): Feedback {
  if (result === "connected") {
    return {
      tone: "success",
      messages: ["Bank connected. Select “Sync” to retrieve balances and transactions for the first time."]
    };
  }

  return {
    tone: "problem",
    messages: [result]
  };
}

export type DashboardController = ReturnType<typeof useDashboard>;

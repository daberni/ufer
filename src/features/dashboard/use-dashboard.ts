"use client";

import { useEffect, useState } from "react";
import { useDashboardData } from "./use-dashboard-data";
import { useBankDirectory } from "@/features/banking/use-bank-directory";
import { failureMessage } from "@/client/api";
import { useActionFeedback, type Feedback } from "@/components/ui/use-action-feedback";
import { navigation } from "./presentation";
import { monthPeriod } from "./period";
import type { Account, Category, View, Modal, Connection } from "./types";

export type ActionResult<T> = {
  ok: true;
  value: T;
} | {
  ok: false;
  message: string;
};

export function useDashboard() {
  const [view, setView] = useState<View>("overview");

  const [modal, setModal] = useState<Modal>(null);

  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);

  const [busy, setBusy] = useState(false);

  // Page-level overlay for feedback without a surviving trigger, such as a bank callback result.
  const {
    feedback,
    report: reportFeedback,
    dismiss: dismissFeedback
  } = useActionFeedback();

  const {
    state,
    setState,
    loadError,
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
    locked,
    setLocked,
    load
  } = useDashboardData();
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

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("banking");

    if (result) {
      setView("connections");
      reportFeedback(bankingCallbackFeedback(result));
      window.history.replaceState(null, "", "/");
    }
  }, [reportFeedback]);

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
    dismissFeedback();
    setView(next);
    setPage(1);
    window.scrollTo({
      top: 0,
      behavior: "instant"
    });
  }

  function moveMonth(delta: number) {
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
    setView,
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

"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useDashboardData } from "./use-dashboard-data";
import { useBankDirectory } from "@/features/banking/use-bank-directory";
import { api } from "@/client/api";
import { navigation } from "./presentation";
import { monthPeriod } from "./period";
import type { Account, Category, View, Modal, Connection, ConnectionRemoval } from "./types";

export function useDashboard() {
  const [view, setView] = useState<View>("overview");

  const [modal, setModal] = useState<Modal>(null);

  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState("");

  const {
    state,
    loading,
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
  } = useDashboardData(setError);
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
    setBanksLoading
  } = useBankDirectory(modal === "bank", setError);

  const [notice, setNotice] = useState("");

  const [importMode, setImportMode] = useState("balances");

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("banking");

    if (result) {
      setView("connections");

      if (result === "connected") {
        setNotice("Bank connected. Select “Sync” to retrieve balances and transactions for the first time.");
      } else {
        setError(result);
      }

      window.history.replaceState(null, "", "/");
    }
  }, []);

  async function perform(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError("");
    setNotice("");

    try {
      await action();
      await load();

      if (success) {
        setNotice(success);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  function changeView(next: View) {
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
    setError("");
    setBankName(connection?.bank_name || "");
    setBankSearch("");
    setBankCountry(connection?.bank_country || "AT");
    setModal("bank");
  }

  function openConnectionRemoval(connection: Connection) {
    setError("");
    setSelectedConnection(connection);
    setModal("removeConnection");
  }

  async function removeConnection(connection: Connection) {
    let message = "";

    await perform(async () => {
      const result = await api<ConnectionRemoval>(`banking/connections/${encodeURIComponent(connection.id)}`, undefined, "DELETE");

      message = connectionRemovalNotice(connection, result);
      setModal(null);
    });

    if (message) {
      setNotice(message);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>, action: (data: FormData) => Promise<void>, message: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    await perform(async () => {
      await action(data);
      setModal(null);
    }, message);
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
    loading,
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
    error,
    setError,
    notice,
    setNotice,
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
    importMode,
    setImportMode,
    load,
    perform,
    changeView,
    moveMonth,
    openBank,
    openConnectionRemoval,
    removeConnection,
    submit,
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

function connectionRemovalNotice(connection: Connection, result: ConnectionRemoval) {
  const removed = `${connection.bank_name} removed. ${result.retainedAccounts} account(s) and their history were kept and are no longer synced.`;

  if (result.providerRevocation === "not_revoked") {
    return `${removed} Enable Banking did not confirm revoking the authorization; it ends when it expires or when you withdraw it at your bank.`;
  }

  return removed;
}

export type DashboardController = ReturnType<typeof useDashboard>;

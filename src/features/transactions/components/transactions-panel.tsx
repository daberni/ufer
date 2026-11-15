"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./transactions-panel.module.css";
import { ArrowDownToLine, ArrowRight, Search } from "lucide-react";
import { Empty } from "@/components/ui/empty-state";
import { TransactionList } from "@/features/transactions/components/transaction-list";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import { Select } from "@/components/ui/select";
import { useTransactionCategorization } from "@/features/transactions/use-transaction-categorization";

type Props = Pick<DashboardController, "accountFilter" | "categoryFilter" | "changeView" | "load" | "page" | "search" | "selectedCurrencyAccounts" | "setAccountFilter" | "setCategoryFilter" | "setError" | "setImportMode" | "setModal" | "setPage" | "setSearch" | "setState" | "state" | "view" | "visibleTransactions">;

export function TransactionsPanel({
  accountFilter,
  categoryFilter,
  changeView,
  load,
  page,
  search,
  selectedCurrencyAccounts,
  setAccountFilter,
  setCategoryFilter,
  setError,
  setImportMode,
  setModal,
  setPage,
  setSearch,
  setState,
  state,
  view,
  visibleTransactions
}: Props) {
  const categorization = useTransactionCategorization({
    load,
    setError,
    setState
  });

  if (!state) {
    return null;
  }

  return (
    <section className={clsx(ui["panel"], styles["transaction-panel"])}>
      <div className={styles["card-heading"]}>
        <h2>{view === "overview" ? "Recent transactions" : "All transactions"}</h2>
        {view === "overview" ? (
          <button className={ui["text-button"]} onClick={() => changeView("transactions")}>
            View all <ArrowRight size={15} />
          </button>
        ) : (
          <button
            className={clsx(styles["button"], ui["small"])}
            onClick={() => {
              setImportMode("transactions");
              setModal("import");
            }}
          >
            <ArrowDownToLine size={14} />
            Import CSV
          </button>
        )}
      </div>
      {view === "transactions" && (
        <div className={styles["filters"]}>
          <label className={styles["search-field"]}>
            <Search size={16} />
            <input
              aria-label="Search transactions"
              placeholder="Payee or description …"
              value={search}
              onChange={event => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <Select
            aria-label="Account filter"
            value={accountFilter}
            onChange={event => {
              setAccountFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All accounts</option>
            {selectedCurrencyAccounts.map(account => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Category filter"
            value={categoryFilter}
            onChange={event => {
              setCategoryFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All categories</option>
            <option value="uncategorized">Uncategorized</option>
            {state.categories.map(category => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      {visibleTransactions?.length ? (
        <TransactionList
          categorization={categorization}
          state={state}
          visibleTransactions={visibleTransactions}
        />
      ) : <Empty title="Your financial history starts here.">Connect a bank account and sync, or import your existing transactions from CSV.</Empty>}
      {view === "transactions" && state.transactionCount > 50 && (
        <div className={styles["pagination"]}>
          <span>
            {(page - 1) * 50 + 1}–{Math.min(page * 50, state.transactionCount)} of {state.transactionCount}
          </span>
          <button className={clsx(styles["button"], ui["small"])} disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button className={clsx(styles["button"], ui["small"])} disabled={page * 50 >= state.transactionCount} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </section>
  );
}

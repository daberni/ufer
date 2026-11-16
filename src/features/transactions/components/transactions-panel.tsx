"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import styles from "./transactions-panel.module.css";
import { ArrowDownToLine, ArrowRight, Search } from "lucide-react";
import { Empty } from "@/components/ui/empty-state";
import { TransactionList } from "@/features/transactions/components/transaction-list";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import { Select } from "@/components/ui/select";
import { anyCategory, CategoryPicker, type CategoryPickerValue } from "@/features/categorization/components/category-picker";
import { useSearchDraft } from "@/features/transactions/use-search-draft";
import { transactionPageSize } from "@/features/dashboard/pagination";
import { areaProps, valueMask } from "@/features/dashboard/components/result-presentation";
import type { AreaResult } from "@/features/dashboard/use-area-result";
import type { Account, Category, TransactionPage } from "@/features/dashboard/types";

type Props = Pick<DashboardController, "accountFilter" | "categoryFilter" | "changeView" | "search" | "setAccountFilter" | "setCategoryFilter" | "setImportMode" | "setModal" | "setPage" | "setSearch" | "view"> & {
  categories: Category[];
  /** Accounts offered as a filter. */
  filterAccounts: Account[];
  list: AreaResult<TransactionPage>;
  /** Replaces the first-use empty state, such as for a selected sync run without listed transactions. */
  emptyState?: ReactNode;
  /** The page shown, after correcting a page past the last one. */
  page: number;
};

const recentTransactions = 5;

// The URL filter uses "" for all categories and "uncategorized" for transactions without one.
function categoryPickerValue(filter: string): CategoryPickerValue {
  if (filter === "") {
    return anyCategory;
  }

  return filter === "uncategorized" ? null : filter;
}

function categoryFilterValue(value: CategoryPickerValue) {
  if (value === anyCategory) {
    return "";
  }

  return value ?? "uncategorized";
}

export function TransactionsPanel({
  accountFilter,
  categories,
  categoryFilter,
  changeView,
  emptyState,
  filterAccounts,
  list,
  page,
  search,
  setAccountFilter,
  setCategoryFilter,
  setImportMode,
  setModal,
  setPage,
  setSearch,
  view
}: Props) {
  const [searchDraft, setSearchDraft] = useSearchDraft(search, setSearch);
  const {
    transactionCount,
    transactions
  } = list.data;
  const visibleTransactions = view === "overview" ? transactions.slice(0, recentTransactions) : transactions;

  // An empty page with matches elsewhere is a page past the end, which the list view corrects; it is not an empty history.
  const noMatches = transactionCount === 0;

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
              value={searchDraft}
              onChange={event => setSearchDraft(event.target.value)}
            />
          </label>
          <Select
            aria-label="Account filter"
            value={accountFilter}
            onChange={event => setAccountFilter(event.target.value)}
          >
            <option value="">All accounts</option>
            {filterAccounts.map(account => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
          <CategoryPicker
            className={styles["category-filter"]}
            aria-label="Category filter"
            categories={categories}
            value={categoryPickerValue(categoryFilter)}
            includeAll
            includeUncategorized
            onChange={value => setCategoryFilter(categoryFilterValue(value))}
          />
        </div>
      )}
      <div {...areaProps(list.status)}>
        {visibleTransactions.length ? <TransactionList categories={categories} transactions={visibleTransactions} /> : noMatches && (emptyState ?? <Empty title="Your financial history starts here.">Connect a bank account and sync, or import your existing transactions from CSV.</Empty>)}
      </div>
      {view === "transactions" && transactionCount > transactionPageSize && (
        <div className={styles["pagination"]}>
          <span className={valueMask(list.status)}>
            {(page - 1) * transactionPageSize + 1}–{Math.min(page * transactionPageSize, transactionCount)} of {transactionCount}
          </span>
          <button className={clsx(styles["button"], ui["small"])} disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button className={clsx(styles["button"], ui["small"])} disabled={page * transactionPageSize >= transactionCount} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </section>
  );
}

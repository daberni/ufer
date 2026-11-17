"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import styles from "./transactions-panel.module.css";
import { ArrowDownToLine, ArrowRight, Search } from "lucide-react";
import { Empty } from "@/components/ui/empty-state";
import { TransactionList, TransactionListSkeleton } from "@/features/transactions/components/transaction-list";
import { CsvImportDialog } from "@/features/imports/components/csv-import-form";
import { setAccountFilter, setCategoryFilter, setPage, setSearch, useAccountFilter, useCategoryFilter, useChangeView, useSearchFilter } from "@/client/use-app-url";
import { Select } from "@/components/ui/select";
import { anyCategory, CategoryPicker, type CategoryPickerValue } from "@/features/categorization/components/category-picker";
import { useSearchDraft } from "@/features/transactions/use-search-draft";
import { transactionPageSize } from "@/lib/pagination";
import { areaProps, valueMask } from "@/components/ui/result-presentation";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { pendingTogether, type Area, type AreaResult } from "@/components/ui/use-area-result";
import type { Account } from "@/features/accounts/types";
import type { Category } from "@/features/categorization/types";
import type { TransactionPage } from "@/features/transactions/types";

type Props = {
  view: "overview" | "transactions";
  categories: Area<Category[]>;
  /** Accounts offered as a filter. */
  filterAccounts: Area<Account[]>;
  list: Area<TransactionPage>;
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
  categories,
  emptyState,
  filterAccounts,
  list,
  page,
  view
}: Props) {
  const [importOpen, setImportOpen] = useState(false);
  const changeView = useChangeView();

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
            onClick={() => setImportOpen(true)}
          >
            <ArrowDownToLine size={14} />
            Import CSV
          </button>
        )}
      </div>
      {view === "transactions" && <TransactionFilters categories={categories.data ?? []} filterAccounts={filterAccounts.data ?? []} />}
      {list.status === "pending" || categories.status === "pending" ? (
        <AreaPlaceholder area={pendingTogether(list, categories)} subject="Your transactions">
          {view === "overview" ? <TransactionListSkeleton rows={recentTransactions} /> : <TransactionPageSkeleton />}
        </AreaPlaceholder>
      ) : (
        <TransactionPages
          categories={categories.data}
          emptyState={emptyState}
          list={list}
          page={page}
          view={view}
        />
      )}
      {importOpen && <CsvImportDialog initialMode="transactions" close={() => setImportOpen(false)} />}
    </section>
  );
}

function TransactionPages({
  categories,
  emptyState,
  list,
  page,
  view
}: Pick<Props, "emptyState" | "page" | "view"> & {
  categories: Category[];
  list: AreaResult<TransactionPage>;
}) {
  const {
    transactionCount,
    transactions
  } = list.data;
  const visibleTransactions = view === "overview" ? transactions.slice(0, recentTransactions) : transactions;

  // An empty page with matches elsewhere is a page past the end, which the list view corrects; it is not an empty history.
  const noMatches = transactionCount === 0;

  return (
    <>
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
    </>
  );
}

// Takes the place of a full page and its pagination; a period with fewer transactions ends earlier.
function TransactionPageSkeleton() {
  return (
    <>
      <TransactionListSkeleton rows={transactionPageSize} />
      <div className={styles["pagination"]}>
        <span className={ui["skeleton"]}>1–50 of 120</span>
        <button className={clsx(styles["button"], ui["small"], ui["skeleton"])} type="button" disabled>Previous</button>
        <button className={clsx(styles["button"], ui["small"], ui["skeleton"])} type="button" disabled>Next</button>
      </div>
    </>
  );
}

// Until categories and accounts load, the filters offer only "All" and keep the selection from the URL.
function TransactionFilters({
  categories,
  filterAccounts
}: {
  categories: Category[];
  filterAccounts: Account[];
}) {
  const accountFilter = useAccountFilter();
  const categoryFilter = useCategoryFilter();

  return (
    <div className={styles["filters"]}>
      <TransactionSearch />
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
        size="compact"
        aria-label="Category filter"
        categories={categories}
        value={categoryPickerValue(categoryFilter)}
        includeAll
        includeUncategorized
        onChange={value => setCategoryFilter(categoryFilterValue(value))}
      />
    </div>
  );
}

// Keystrokes change only this field's draft; the list follows once the committed search reaches the URL.
function TransactionSearch() {
  const [searchDraft, setSearchDraft] = useSearchDraft(useSearchFilter(), setSearch);

  return (
    <label className={styles["search-field"]}>
      <Search size={16} />
      <input
        aria-label="Search transactions"
        placeholder="Payee or description …"
        value={searchDraft}
        onChange={event => setSearchDraft(event.target.value)}
      />
    </label>
  );
}

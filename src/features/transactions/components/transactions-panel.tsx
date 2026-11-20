"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import Link from "next/link";
import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import styles from "./transactions-panel.module.css";
import { ArrowDownToLine, ArrowRight, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { Empty } from "@/components/ui/empty-state";
import { TransactionRuleProvider } from "./transaction-rule-provider";
import { TransactionList, TransactionListSkeleton } from "@/features/transactions/components/transaction-list";
import { ManualTransactionDialog } from "@/features/transactions/components/manual-transaction-dialog";
import { useAccounts } from "@/features/accounts/queries";
import { CsvFileDialog } from "@/features/imports/components/csv-file-dialog";
import { setAccountFilter, setCategoryFilter, setTypeFilter, setPage, setSearch, useAccountFilter, useCategoryFilter, useTypeFilter, useChangeView, useSearchFilter } from "@/client/use-app-url";
import { Select } from "@/components/ui/select";
import { anyCategory, CategoryPicker, type CategoryPickerValue } from "@/features/categorization/components/category-picker";
import { useSearchDraft } from "@/features/transactions/use-search-draft";
import { transactionPageSize } from "@/lib/pagination";
import { areaProps, valueMask } from "@/components/ui/result-presentation";
import { AreaPlaceholder } from "@/components/ui/area-placeholder";
import { pendingTogether, type Area, type AreaResult } from "@/components/ui/use-area-result";
import type { Account } from "@/features/accounts/types";
import type { Category } from "@/features/categorization/types";
import { transactionTypes, transactionTypeLabels } from "@/features/transactions/transaction-types";
import type { TransactionPage } from "@/features/transactions/types";

type Props = {
  categories: Area<Category[]>;
  list: Area<TransactionPage>;
  /** Replaces the first-use empty state, such as for a selected sync run without listed transactions. */
  emptyState?: ReactNode;
  /** The page shown, after correcting a page past the last one. */
  page: number;
} & ({
  view: "overview";
} | {
  view: "transactions";
  /** Accounts offered as a filter. */
  filterAccounts: Area<Account[]>;
} | {
  view: "account";
  /** The transactions view filtered to this account, which offers search and category filters. */
  filterHref: string;
});

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

const headings: Record<Props["view"], string> = {
  overview: "Recent transactions",
  transactions: "All transactions",
  account: "Transactions"
};

export function TransactionsPanel(props: Props) {
  const {
    categories,
    emptyState,
    list,
    page,
    view
  } = props;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const changeView = useChangeView();
  const manualAccounts = (useAccounts().data ?? []).filter(account => account.provider === "manual");

  return (
    <section className={clsx(ui["panel"], styles["transaction-panel"])}>
      <div className={styles["card-heading"]}>
        <h2 ref={headingRef} tabIndex={-1}>{headings[view]}</h2>
        {props.view === "overview" && (
          <button className={ui["text-button"]} onClick={() => changeView("transactions")}>
            View all <ArrowRight size={15} />
          </button>
        )}
        {props.view === "transactions" && (
          <div className={styles["heading-actions"]}>
            {manualAccounts.length > 0 && (
              <button
                className={clsx(styles["button"], ui["small"])}
                onClick={() => setEntryOpen(true)}
              >
                <Plus size={14} />
                Add transaction
              </button>
            )}
            <button className={clsx(styles["button"], ui["small"])} onClick={() => setImportOpen(true)}>
              <ArrowDownToLine size={14} />
              Import CSV
            </button>
          </div>
        )}
        {props.view === "account" && (
          <Link className={ui["text-button"]} href={props.filterHref}>
            <SlidersHorizontal size={14} />
            Search and filter
          </Link>
        )}
      </div>
      {props.view === "transactions" && <TransactionFilters categories={categories.data ?? []} filterAccounts={props.filterAccounts.data ?? []} />}
      <TransactionRuleProvider fallbackFocus={headingRef}>
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
      </TransactionRuleProvider>
      {importOpen && <CsvFileDialog close={() => setImportOpen(false)} />}
      {entryOpen && <ManualTransactionDialog accounts={manualAccounts} close={() => setEntryOpen(false)} />}
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
      {view !== "overview" && transactionCount > transactionPageSize && (
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
  const typeFilter = useTypeFilter();

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
      <Select aria-label="Transaction type filter" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}>
        <option value="">All types</option>
        {transactionTypes.map(type => <option key={type} value={type}>{transactionTypeLabels[type]}</option>)}
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
  const input = useRef<HTMLInputElement>(null);

  // Pointer presses on the field's padding or magnifier focus the input, as its label did.
  function focusInput(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element) || !event.target.closest("button, input")) {
      input.current?.focus();
    }
  }

  return (
    // A plain wrapper, since the clear button must not sit inside the input's label; the input has its own accessible name.
    <div className={styles["search-field"]} onClick={focusInput}>
      <Search size={16} aria-hidden="true" />
      <input
        ref={input}
        aria-label="Search transactions"
        placeholder="Payee or description …"
        value={searchDraft}
        onChange={event => setSearchDraft(event.target.value)}
      />
      {searchDraft && (
        <button
          type="button"
          className={styles["clear-search"]}
          aria-label="Clear search"
          onClick={() => {
            setSearchDraft("");
            input.current?.focus();
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

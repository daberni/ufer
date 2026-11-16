"use client";

import ui from "../../../components/ui/primitives.module.css";

import { clsx } from "clsx";
import styles from "./transactions-panel.module.css";
import { ArrowDownToLine, ArrowRight, Search } from "lucide-react";
import { Empty } from "@/components/ui/empty-state";
import { TransactionList } from "@/features/transactions/components/transaction-list";
import type { DashboardController } from "@/features/dashboard/use-dashboard";
import { Select } from "@/components/ui/select";
import { anyCategory, CategoryPicker, type CategoryPickerValue } from "@/features/categorization/components/category-picker";
import { useSearchDraft } from "@/features/transactions/use-search-draft";
import { transactionPageSize } from "@/features/dashboard/pagination";

type Props = Pick<DashboardController, "accountFilter" | "busy" | "categoryFilter" | "changeView" | "page" | "perform" | "reportFeedback" | "search" | "selectedCurrencyAccounts" | "setAccountFilter" | "setCategoryFilter" | "setImportMode" | "setModal" | "setPage" | "setSearch" | "state" | "view" | "visibleTransactions">;

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
  busy,
  categoryFilter,
  changeView,
  page,
  perform,
  reportFeedback,
  search,
  selectedCurrencyAccounts,
  setAccountFilter,
  setCategoryFilter,
  setImportMode,
  setModal,
  setPage,
  setSearch,
  state,
  view,
  visibleTransactions
}: Props) {
  const [searchDraft, setSearchDraft] = useSearchDraft(search, setSearch);

  if (!state) {
    return null;
  }

  // An empty page with matches elsewhere is a page past the end, which the dashboard corrects; it is not an empty history.
  const noMatches = state.transactionCount === 0;

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
            {selectedCurrencyAccounts.map(account => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
          <CategoryPicker
            className={styles["category-filter"]}
            aria-label="Category filter"
            categories={state.categories}
            value={categoryPickerValue(categoryFilter)}
            includeAll
            includeUncategorized
            onChange={value => setCategoryFilter(categoryFilterValue(value))}
          />
        </div>
      )}
      {visibleTransactions?.length ? (
        <TransactionList
          busy={busy}
          perform={perform}
          reportFeedback={reportFeedback}
          state={state}
          visibleTransactions={visibleTransactions}
        />
      ) : noMatches && <Empty title="Your financial history starts here.">Connect a bank account and sync, or import your existing transactions from CSV.</Empty>}
      {view === "transactions" && state.transactionCount > transactionPageSize && (
        <div className={styles["pagination"]}>
          <span>
            {(page - 1) * transactionPageSize + 1}–{Math.min(page * transactionPageSize, state.transactionCount)} of {state.transactionCount}
          </span>
          <button className={clsx(styles["button"], ui["small"])} disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button className={clsx(styles["button"], ui["small"])} disabled={page * transactionPageSize >= state.transactionCount} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </section>
  );
}

import { isTransactionType, type TransactionType } from "@/features/transactions/transaction-types";
import { currentMonth, currentMonthPeriod, parsePeriod, serializePeriod, type Period } from "@/lib/period";
import { parsePage } from "@/lib/pagination";
import { parseCurrencyCode } from "@/lib/money";

export type View = "overview" | "transactions" | "import" | "accounts" | "account" | "rules";

/** A view in the navigation; an account's details belong to accounts and the import page to transactions. */
export type Section = Exclude<View, "account" | "import">;

/** The lists an account's details are opened from and return to. */
export type AccountList = "overview" | "accounts";

/**
 * Each dashboard view is a route. The period and currency are shared by the period-aware views; search, filters and page belong to the transaction list. A selected sync run replaces the period and currency for the list: it shows everything the run imported. An account's details list that account's transactions page by page.
 */
export const viewPaths: Record<Section, string> = {
  overview: "/",
  transactions: "/transactions",
  accounts: "/accounts",
  rules: "/rules"
};

export type ViewQuery = {
  period: Period;
  currency: string;
  search: string;
  account: string;
  category: string;
  type: TransactionType | "";
  syncRun: string;
  page: number;
};

/** Changes to the URL query; an empty or default value removes the parameter. */
export type ViewQueryChanges = {
  period?: Period;
  currency?: string;
  search?: string;
  account?: string;
  category?: string;
  type?: string;
  syncRun?: string;
  page?: number;
};

type SearchParams = Pick<URLSearchParams, "get" | "toString">;

/** The CSV import page, below the transactions it adds to. */
export const importPath = "/transactions/import";

const defaultCurrency = "EUR";

const scopeKeys = ["period", "currency"];

const accountPathPrefix = `${viewPaths.accounts}/`;

export function accountPath(id: string) {
  return `${accountPathPrefix}${encodeURIComponent(id)}`;
}

/** The account a details path shows; empty on every other path. */
export function accountIdFromPathname(pathname: string) {
  const segment = pathname.startsWith(accountPathPrefix) ? pathname.slice(accountPathPrefix.length) : "";

  if (!segment || segment.includes("/")) {
    return "";
  }

  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}

export function viewFromPathname(pathname: string): View {
  if (accountIdFromPathname(pathname)) {
    return "account";
  }

  if (pathname === importPath) {
    return "import";
  }

  const match = Object.entries(viewPaths).find(([, path]) => path === pathname);

  return match ? match[0] as Section : "overview";
}

export function sectionOf(view: View): Section {
  if (view === "account") {
    return "accounts";
  }

  return view === "import" ? "transactions" : view;
}

export function isPeriodAware(view: View) {
  return view === "overview" || view === "transactions" || view === "account";
}

export function isAccountList(view: View): view is AccountList {
  return view === "overview" || view === "accounts";
}

/** The period and currency parameters that period-aware views carry between each other. */
export function periodScope(params: SearchParams) {
  const source = new URLSearchParams(params.toString());
  const scope = new URLSearchParams();

  for (const key of scopeKeys) {
    const value = source.get(key);

    if (value) {
      scope.set(key, value);
    }
  }

  return scope.toString();
}

function currencyOrDefault(value: string | null) {
  return value && parseCurrencyCode(value) || defaultCurrency;
}

/** The data query for the view at a path: the shared period scope plus, on the transaction list, its own filters, and on an account's details that account and the page. */
export function viewQuery(pathname: string, scope: string, params: SearchParams): ViewQuery {
  const view = viewFromPathname(pathname);
  const scoped = new URLSearchParams(scope);
  const listParams = view === "transactions" ? params : new URLSearchParams();
  const type = listParams.get("type") || "";
  const pageParams = view === "account" ? params : listParams;

  return {
    period: parsePeriod(scoped.get("period") || "") || currentMonthPeriod(),
    currency: currencyOrDefault(scoped.get("currency")),
    search: listParams.get("search") || "",
    account: view === "account" ? accountIdFromPathname(pathname) : listParams.get("account") || "",
    category: listParams.get("category") || "",
    type: isTransactionType(type) ? type : "",
    syncRun: listParams.get("syncRun") || "",
    page: parsePage(pageParams.get("page"))
  };
}

export function viewHref(view: Section, scope: string) {
  return isPeriodAware(view) && scope ? `${viewPaths[view]}?${scope}` : viewPaths[view];
}

/** An account's details carry the period selected last. */
export function accountHref(id: string, scope: string) {
  return scope ? `${accountPath(id)}?${scope}` : accountPath(id);
}

/** The transactions behind one row of a breakdown by category: a category ID or "uncategorized", income or expenses, in the breakdown's period and currency. */
export type CategoryTransactions = {
  period: Period;
  currency: string;
  category: string;
  type: "income" | "expense";
};

export function categoryTransactionsHref(filter: CategoryTransactions) {
  return withQueryChanges(viewPaths.transactions, "", {
    period: filter.period,
    currency: filter.currency,
    category: filter.category,
    type: filter.type
  });
}

/** Applies query changes to a URL; default values are omitted so plain view URLs stay plain. */
export function withQueryChanges(pathname: string, search: string, changes: ViewQueryChanges) {
  const params = new URLSearchParams(search);
  const values: Record<string, string> = {};

  if (changes.period) {
    values.period = isCurrentMonth(changes.period) ? "" : serializePeriod(changes.period);
  }

  if (changes.currency !== undefined) {
    values.currency = changes.currency === defaultCurrency ? "" : changes.currency;
  }

  for (const key of ["search", "account", "category", "type", "syncRun"] as const) {
    if (changes[key] !== undefined) {
      values[key] = changes[key];
    }
  }

  if (changes.page !== undefined) {
    values.page = changes.page > 1 ? String(changes.page) : "";
  }

  for (const [key, value] of Object.entries(values)) {
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
  }

  const query = params.toString();

  return query ? `${pathname}?${query}` : pathname;
}

function isCurrentMonth(period: Period) {
  return period.kind === "month" && period.month.equals(currentMonth());
}

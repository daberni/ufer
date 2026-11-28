import { isTransactionType, type TransactionType } from "@/lib/transaction-types";
import { allMonthsPeriod, currentMonth, currentMonthPeriod, parsePeriod, serializePeriod, type Period } from "@/lib/period";
import { parsePage } from "@/lib/pagination";
import { parseCurrencyCode } from "@/lib/money";
import { rangeContaining, serializeRange, type PeriodRange } from "@/lib/period-range";
import { today } from "@/lib/time";
import type { BreakdownGrouping } from "@/features/reports/types";

export type View = "overview" | "insights" | "transactions" | "import" | "accounts" | "account" | "holding" | "brokerage" | "rules";

/** A view in the navigation; an account's details and its holdings belong to accounts and the import page to transactions. */
export type Section = Exclude<View, "account" | "holding" | "import">;

/** The lists an account's details are opened from and return to. */
export type AccountList = "overview" | "accounts" | "brokerage";

/**
 * Each dashboard view is a route. The period and currency are shared by the period-aware views; search, filters and page belong to the transaction list. A selected sync run replaces the period and currency for the list: it shows everything the run imported. An account's details list that account's transactions page by page.
 */
export const viewPaths: Record<Section, string> = {
  overview: "/",
  insights: "/insights",
  transactions: "/transactions",
  accounts: "/accounts",
  brokerage: "/brokerage",
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
  /** Whether the accounts view shows its archived accounts. */
  archived?: boolean;
};

type SearchParams = Pick<URLSearchParams, "get" | "toString">;

/** The file import page, below the transactions it adds to. */
export const importPath = "/transactions/import";

const defaultCurrency = "EUR";

const scopeKeys = ["period", "currency"];

const accountPathPrefix = `${viewPaths.accounts}/`;

export function accountPath(id: string) {
  return `${accountPathPrefix}${encodeURIComponent(id)}`;
}

/** A brokerage account's holding of one security. */
export function holdingPath(accountId: string, securityId: string) {
  return `${accountPath(accountId)}/holdings/${encodeURIComponent(securityId)}`;
}

function decodedSegments(pathname: string) {
  const rest = pathname.startsWith(accountPathPrefix) ? pathname.slice(accountPathPrefix.length) : "";

  if (!rest) {
    return null;
  }

  try {
    return rest.split("/").map(segment => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

/** The account a details path shows; empty on every other path. */
export function accountIdFromPathname(pathname: string) {
  const segments = decodedSegments(pathname);

  return segments?.length === 1 && segments[0] ? segments[0] : "";
}

/** The account and security a holding path shows; null on every other path. */
export function holdingFromPathname(pathname: string) {
  const segments = decodedSegments(pathname);

  if (segments?.length !== 3 || segments[1] !== "holdings" || !segments[0] || !segments[2]) {
    return null;
  }

  return {
    accountId: segments[0],
    securityId: segments[2]
  };
}

export function viewFromPathname(pathname: string): View {
  if (accountIdFromPathname(pathname)) {
    return "account";
  }

  if (holdingFromPathname(pathname)) {
    return "holding";
  }

  if (pathname === importPath) {
    return "import";
  }

  const match = Object.entries(viewPaths).find(([, path]) => path === pathname);

  return match ? match[0] as Section : "overview";
}

export function sectionOf(view: View): Section {
  if (view === "account" || view === "holding") {
    return "accounts";
  }

  return view === "import" ? "transactions" : view;
}

/** Views that carry the shared period scope; the insights use only its currency and keep their own range, but pass the period on to the views they link to. */
export function isPeriodAware(view: View) {
  return view === "overview" || view === "insights" || view === "transactions" || view === "account" || view === "holding";
}

export function isAccountList(view: View): view is AccountList {
  return view === "overview" || view === "accounts" || view === "brokerage";
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

/** The data query for the view at a path: the shared period scope (the overview always shows the current month and keeps the scope only for its links) plus, on the transaction list, its own filters, and on an account's details that account and the page. */
export function viewQuery(pathname: string, scope: string, params: SearchParams): ViewQuery {
  const view = viewFromPathname(pathname);
  const scoped = new URLSearchParams(scope);
  const listParams = view === "transactions" ? params : new URLSearchParams();
  const type = listParams.get("type") || "";
  const pageParams = view === "account" ? params : listParams;

  return {
    period: view === "overview" ? currentMonthPeriod() : parsePeriod(scoped.get("period") || "") || currentMonthPeriod(),
    currency: currencyOrDefault(scoped.get("currency")),
    search: listParams.get("search") || "",
    account: viewAccount(view, pathname) ?? (listParams.get("account") || ""),
    category: listParams.get("category") || "",
    type: isTransactionType(type) ? type : "",
    syncRun: listParams.get("syncRun") || "",
    page: parsePage(pageParams.get("page"))
  };
}

// The account an account's details or one of its holdings shows; null on views without one.
function viewAccount(view: View, pathname: string) {
  if (view === "account") {
    return accountIdFromPathname(pathname);
  }

  return view === "holding" ? holdingFromPathname(pathname)!.accountId : null;
}

/** The overview's recent transactions: the latest bookings of every month in the selected currency. */
export function recentTransactionsQuery(query: ViewQuery): ViewQuery {
  return {
    ...query,
    period: allMonthsPeriod,
    page: 1
  };
}

/** The whole transaction list behind the overview's recent transactions: all months in the current currency. */
export function allTransactionsHref(scope: string) {
  return withQueryChanges(viewPaths.transactions, scope, {
    period: allMonthsPeriod,
    page: 1
  });
}

export function viewHref(view: Section, scope: string) {
  return isPeriodAware(view) && scope ? `${viewPaths[view]}?${scope}` : viewPaths[view];
}

/** A holding carries the period selected last, so its way back to the account keeps it. */
export function holdingHref(accountId: string, securityId: string, scope: string) {
  const path = holdingPath(accountId, securityId);

  return scope ? `${path}?${scope}` : path;
}

/** An account's details carry the period selected last. */
export function accountHref(id: string, scope: string) {
  return scope ? `${accountPath(id)}?${scope}` : accountPath(id);
}

/** The transactions behind one row of a breakdown: a category ID or "uncategorized", or an account ID, with income or expenses, in the breakdown's period and currency. */
export type BreakdownTransactions = {
  period: Period;
  currency: string;
  grouping: BreakdownGrouping;
  key: string;
  type: "income" | "expense";
};

export function breakdownTransactionsHref(filter: BreakdownTransactions) {
  return withQueryChanges(viewPaths.transactions, "", {
    period: filter.period,
    currency: filter.currency,
    [filter.grouping]: filter.key,
    type: filter.type
  });
}

/** Every transaction in one category (an ID or "uncategorized") over all months, in a currency. */
export function categoryTransactionsHref(currency: string, category: string) {
  return withQueryChanges(viewPaths.transactions, "", {
    period: allMonthsPeriod,
    currency,
    category
  });
}

/** The insights narrowed to one category (an ID or "uncategorized"), ending at the breakdown's month in its currency; a breakdown over all months opens the years up to this one. */
export function categoryInsightsHref(filter: Pick<BreakdownTransactions, "period" | "currency" | "key">) {
  const range = filter.period.kind === "all" ? rangeContaining("year", today()) : rangeContaining("month", filter.period.month.toPlainDate({
    day: 1
  }));

  return categoryRangeHref(range, filter.currency, filter.key);
}

/** The insights narrowed to one category over a range of any interval, in a currency; the current month stays implicit. */
export function categoryRangeHref(range: PeriodRange, currency: string, category: string) {
  const params = new URLSearchParams();
  const value = serializeRange(range);

  if (value !== serializeRange(rangeContaining("month", today()))) {
    params.set("range", value);
  }

  if (currency !== defaultCurrency) {
    params.set("currency", currency);
  }

  params.set("category", category);

  return `${viewPaths.insights}?${params.toString()}`;
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

  if (changes.archived !== undefined) {
    values.archived = changes.archived ? archivedOpenValue : "";
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

const archivedOpenValue = "open";

/** The accounts view keeps its archived section open in the URL, so returning from an archived account's details restores it. */
export function archivedAccountsOpen(params: SearchParams) {
  return params.get("archived") === archivedOpenValue;
}

/** An accounts list URL that shows its archived section, so returning from an archived account restores it. */
export function withArchivedAccountsOpen(href: string) {
  const [pathname, search = ""] = href.split("?");

  return withQueryChanges(pathname, search, {
    archived: true
  });
}

function isCurrentMonth(period: Period) {
  return period.kind === "month" && period.month.equals(currentMonth());
}

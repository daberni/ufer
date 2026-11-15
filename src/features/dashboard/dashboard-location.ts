import { currentMonth, currentMonthPeriod, parsePeriod, serializePeriod, type Period } from "./period";
import type { View } from "./types";

/**
 * Each dashboard view is a route. The period and currency are shared by the period-aware views; search, filters and page belong to the transaction list.
 */
export const viewPaths: Record<View, string> = {
  overview: "/",
  transactions: "/transactions",
  accounts: "/accounts",
  rules: "/rules",
  connections: "/connections"
};

export type DashboardQuery = {
  period: Period;
  currency: string;
  search: string;
  account: string;
  category: string;
  page: number;
};

/** Changes to the URL query; an empty or default value removes the parameter. */
export type DashboardQueryChanges = {
  period?: Period;
  currency?: string;
  search?: string;
  account?: string;
  category?: string;
  page?: number;
};

type SearchParams = Pick<URLSearchParams, "get" | "toString">;

const defaultCurrency = "EUR";

const scopeKeys = ["period", "currency"];

export function viewFromPathname(pathname: string): View {
  const match = Object.entries(viewPaths).find(([, path]) => path === pathname);

  return match ? match[0] as View : "overview";
}

export function isPeriodAware(view: View) {
  return view === "overview" || view === "transactions";
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

/** The data query for a view: the shared period scope plus, on the transaction list, its own filters. */
export function dashboardQuery(view: View, scope: string, params: SearchParams): DashboardQuery {
  const scoped = new URLSearchParams(scope);
  const listParams = view === "transactions" ? params : new URLSearchParams();

  return {
    period: parsePeriod(scoped.get("period") || "") || currentMonthPeriod(),
    currency: scoped.get("currency") || defaultCurrency,
    search: listParams.get("search") || "",
    account: listParams.get("account") || "",
    category: listParams.get("category") || "",
    page: Math.max(1, Math.floor(Number(listParams.get("page"))) || 1)
  };
}

export function viewHref(view: View, scope: string) {
  return isPeriodAware(view) && scope ? `${viewPaths[view]}?${scope}` : viewPaths[view];
}

/** Applies query changes to a URL; default values are omitted so plain view URLs stay plain. */
export function withQueryChanges(pathname: string, search: string, changes: DashboardQueryChanges) {
  const params = new URLSearchParams(search);
  const values: Record<string, string> = {};

  if (changes.period) {
    values.period = isCurrentMonth(changes.period) ? "" : serializePeriod(changes.period);
  }

  if (changes.currency !== undefined) {
    values.currency = changes.currency === defaultCurrency ? "" : changes.currency;
  }

  for (const key of ["search", "account", "category"] as const) {
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

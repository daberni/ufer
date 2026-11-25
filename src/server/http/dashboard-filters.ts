import { isTransactionType } from "@/lib/transaction-types";
import { HttpError } from "@/lib/errors";
import { parseCurrencyCode } from "@/lib/money";
import { currentMonthPeriod, parsePeriod } from "@/lib/period";
import { parsePage } from "@/lib/pagination";
import { parseRange } from "@/lib/period-range";

function periodFilter(value: string | null) {
  if (!value) {
    return currentMonthPeriod();
  }

  const period = parsePeriod(value);

  if (!period) {
    throw new HttpError(400, "Invalid period.");
  }

  return period;
}

// A range replaces the month period for lists that follow the insights' intervals, such as a category's history.
function rangeFilter(value: string | null) {
  if (!value) {
    return null;
  }

  const range = parseRange(value);

  if (!range) {
    throw new HttpError(400, "Invalid range.");
  }

  return range;
}

function currencyFilter(value: string | null) {
  return value && parseCurrencyCode(value) || "EUR";
}

export function dashboardFilters(query: URLSearchParams) {
  const type = query.get("type") || "";

  if (type && !isTransactionType(type)) {
    throw new HttpError(400, "Invalid transaction type.");
  }

  return {
    period: periodFilter(query.get("period")),
    range: rangeFilter(query.get("range")),
    currency: currencyFilter(query.get("currency")),
    page: parsePage(query.get("page")),
    search: query.get("search")?.slice(0, 200) || "",
    accountId: query.get("account") || "",
    categoryId: query.get("category") || "",
    type,
    syncRunId: query.get("syncRun") || ""
  };
}

export type DashboardFilters = ReturnType<typeof dashboardFilters>;

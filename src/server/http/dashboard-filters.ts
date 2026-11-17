import { HttpError } from "@/lib/errors";
import { parseCurrencyCode } from "@/lib/money";
import { currentMonthPeriod, parsePeriod } from "@/lib/period";
import { parsePage } from "@/lib/pagination";

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

function currencyFilter(value: string | null) {
  return value && parseCurrencyCode(value) || "EUR";
}

export function dashboardFilters(query: URLSearchParams) {
  return {
    period: periodFilter(query.get("period")),
    currency: currencyFilter(query.get("currency")),
    page: parsePage(query.get("page")),
    search: query.get("search")?.slice(0, 200) || "",
    accountId: query.get("account") || "",
    categoryId: query.get("category") || "",
    syncRunId: query.get("syncRun") || ""
  };
}

export type DashboardFilters = ReturnType<typeof dashboardFilters>;

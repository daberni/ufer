import { HttpError } from "@/lib/errors";
import { viennaMonth } from "@/lib/money";

export function dashboardFilters(query: URLSearchParams) {
  const month = query.get("month") || viennaMonth();

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new HttpError(400, "Invalid month.");
  }

  return {
    month,
    currency: query.get("currency") || "EUR",
    page: Math.max(1, Math.min(10000, Math.floor(Number(query.get("page")) || 1))),
    search: query.get("search")?.slice(0, 200) || "",
    accountId: query.get("account") || "",
    categoryId: query.get("category") || "",
    allMonths: query.get("allMonths") === "1"
  };
}

export type DashboardFilters = ReturnType<typeof dashboardFilters>;

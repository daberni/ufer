import { ValidationError } from "@/lib/errors";
import { dashboardFilters, type DashboardFilters } from "@/server/http/dashboard-filters";

const filterFields = ["period", "currency", "search", "account", "category", "type", "syncRun"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pageValue(value: unknown) {
  if (value === undefined) {
    return "";
  }

  if (typeof value !== "number") {
    throw new ValidationError("The page must be a number.");
  }

  return String(value);
}

/** Reads the transaction-list filters from a JSON body; they use the same names and rules as the page address. */
export function transactionListRequest(body: unknown): DashboardFilters {
  if (!isRecord(body)) {
    throw new ValidationError("The transaction filters must be a JSON object.");
  }

  const query = new URLSearchParams();

  for (const field of filterFields) {
    const value = body[field];

    if (value === undefined) {
      continue;
    }

    if (typeof value !== "string") {
      throw new ValidationError(`The ${field} filter must be text.`);
    }

    query.set(field, value);
  }

  query.set("page", pageValue(body.page));

  return dashboardFilters(query);
}

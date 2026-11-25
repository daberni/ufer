import { HttpError } from "@/lib/errors";
import { parseCurrencyCode } from "@/lib/money";
import { parseRange, rangeContaining } from "@/lib/period-range";
import { today } from "@/lib/time";

/** The insights request: a range in its URL form (the current month when absent) and a display currency. */
export function insightsFilters(query: URLSearchParams) {
  const value = query.get("range");
  const range = value ? parseRange(value) : rangeContaining("month", today());

  if (!range) {
    throw new HttpError(400, "Invalid range.");
  }

  return {
    range,
    currency: parseCurrencyCode(query.get("currency") || "") || "EUR"
  };
}

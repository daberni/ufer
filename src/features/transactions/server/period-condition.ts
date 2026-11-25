import { sql, type SQL } from "drizzle-orm";
import type { Period } from "@/lib/period";

/**
 * SQL condition on `t.date` for a period. Transaction lists, counts, cash flow and spending all use it so their results describe the same range.
 * A month is a half-open date range rather than a month expression, so the booking-date indexes apply.
 */
export function periodCondition(period: Period): SQL {
  if (period.kind === "all") {
    return sql`TRUE`;
  }

  const firstDay = {
    day: 1
  };
  const start = period.month.toPlainDate(firstDay).toString();
  const end = period.month.add({
    months: 1
  }).toPlainDate(firstDay).toString();

  return dateRangeCondition(start, end);
}

/** SQL condition on `t.date` for the half-open range from `start` up to, but excluding, `end`. */
export function dateRangeCondition(start: string, end: string): SQL {
  return sql`t.date>=${start} AND t.date<${end}`;
}

/** SQL condition on `t.date` for dates before, but excluding, `end`. */
export function dateBeforeCondition(end: string): SQL {
  return sql`t.date<${end}`;
}

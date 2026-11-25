import { sql, type SQL } from "drizzle-orm";
import type { Temporal } from "temporal-polyfill";
import type { Period } from "@/lib/period";

/**
 * SQL condition on `t.date` for a period. Transaction lists, counts, cash flow and spending all use it so their results describe the same range.
 * A month is a half-open date range rather than a month expression, so the booking-date indexes apply.
 */
export function periodCondition(period: Period): SQL {
  if (period.kind === "all") {
    return sql`TRUE`;
  }

  return monthsCondition(period.month, period.month);
}

function firstDayOf(month: Temporal.PlainYearMonth) {
  return month.toPlainDate({
    day: 1
  }).toString();
}

/** SQL condition on `t.date` for the consecutive months from `first` through `last`, as a half-open date range. */
export function monthsCondition(first: Temporal.PlainYearMonth, last: Temporal.PlainYearMonth): SQL {
  return dateRangeCondition(firstDayOf(first), firstDayOf(last.add({
    months: 1
  })));
}

/** SQL condition on `t.date` for dates before the given month. */
export function beforeMonthCondition(month: Temporal.PlainYearMonth): SQL {
  return sql`t.date<${firstDayOf(month)}`;
}

/** SQL condition on `t.date` for the half-open range from `start` up to, but excluding, `end`. */
export function dateRangeCondition(start: string, end: string): SQL {
  return sql`t.date>=${start} AND t.date<${end}`;
}

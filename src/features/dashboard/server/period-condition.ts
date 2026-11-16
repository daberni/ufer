import type { Period } from "@/features/dashboard/period";

/**
 * SQL condition on `t.booking_date` for a period. Transaction lists, counts, cash flow and spending all use it so their results describe the same range.
 * A month is a half-open date range rather than a month expression, so the booking-date indexes apply.
 */
export function periodCondition(period: Period) {
  if (period.kind === "all") {
    return {
      sql: "TRUE",
      args: []
    };
  }

  const firstDay = {
    day: 1
  };

  return {
    sql: "t.booking_date>=? AND t.booking_date<?",
    args: [period.month.toPlainDate(firstDay).toString(), period.month.add({
      months: 1
    }).toPlainDate(firstDay).toString()]
  };
}

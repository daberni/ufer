import type { Period } from "@/features/dashboard/period";

/**
 * SQL condition on `t.booking_date` for a period. Transaction lists, counts, cash flow and spending all use it so their results describe the same range.
 */
export function periodCondition(period: Period) {
  if (period.kind === "all") {
    return {
      sql: "TRUE",
      args: []
    };
  }

  return {
    sql: "substr(t.booking_date,1,7)=?",
    args: [period.month.toString()]
  };
}

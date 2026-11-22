import { and, eq, like, type SQLWrapper } from "drizzle-orm";
import { transactions } from "@/server/database/schema";

/**
 * Condition on `transactions` joined with `accounts` that selects the rows a sync run inserted.
 * A sync stores its run's `started_at` as `created_at` on the bank rows it inserts, and updates keep the original value, so for bank rows `created_at` is the start of the importing sync run. The sync lease serializes runs, so no two runs share a start.
 * Rows stored before runs stamped them carry the database clock and match no run; they are deliberately not attributed by time window.
 */
export function syncRunTransactions(startedAt: string | SQLWrapper) {
  return and(eq(transactions.created_at, startedAt), like(transactions.provider_reference, "bank:%"));
}

import { and, eq, ne, sql } from "drizzle-orm";
import { transactions } from "@/server/database/schema";
import { duplicateSearchDays } from "@/features/transactions/duplicate-resolution";
import { windowEnd, windowStart } from "./transfer-rules";

type Original = {
  id: string;
  account_id: string;
  date: string;
  amount_minor: number;
  currency: string;
};

/** Shown bookings that may record the same movement as `subject`: the same amount in the same currency on the same account, within the resolution window. Excluding bookings entered in Ufer is left to `enteredInUfer`. */
export function duplicateCandidate(subject: Original) {
  const inWindow = sql`${transactions.date} BETWEEN date(${subject.date},${windowStart(duplicateSearchDays)}) AND date(${subject.date},${windowEnd(duplicateSearchDays)})`;

  return and(ne(transactions.id, subject.id), eq(transactions.account_id, subject.account_id), eq(transactions.amount_minor, subject.amount_minor), eq(transactions.currency, subject.currency), sql`${transactions.suppressed_at} IS NULL`, inWindow);
}

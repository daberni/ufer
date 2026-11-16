import { database } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import { periodToJson } from "@/features/dashboard/period";
import { transactionPageSize } from "@/features/dashboard/pagination";
import { periodCondition } from "@/features/dashboard/server/period-condition";
import type { DashboardFilters } from "@/features/dashboard/server/dashboard-filters";

/** One page of the transaction list for the selected filters, with the number of matches across all pages. */
export async function readTransactionPage(filters: DashboardFilters) {
  const client = (await database()).$client;
  const inPeriod = periodCondition(filters.period);
  const where = ["a.environment=?", "t.currency=?", inPeriod.sql];
  const args: (string | number)[] = [environment(), filters.currency, ...inPeriod.args];

  if (filters.search) {
    where.push("instr(lower(t.counterparty || ' ' || t.description),lower(?)) > 0");
    args.push(filters.search);
  }

  if (filters.accountId) {
    where.push("a.id=?");
    args.push(filters.accountId);
  }

  if (filters.categoryId === "uncategorized") {
    where.push("t.category_id IS NULL");
  } else if (filters.categoryId) {
    where.push("t.category_id=?");
    args.push(filters.categoryId);
  }

  const condition = where.join(" AND ");
  const transactionsQuery = client.execute({
    sql: `
      SELECT t.id,t.booking_date,t.amount_minor,t.currency,t.counterparty,t.description,a.name AS account_name,t.category_id,t.category_source
      FROM transactions t
      JOIN accounts a ON a.id=t.account_id
      WHERE ${condition}
      ORDER BY t.booking_date DESC,t.created_at DESC,t.id
      LIMIT ?
      OFFSET ?
    `,
    args: [...args, transactionPageSize, (filters.page - 1) * transactionPageSize]
  });
  const countQuery = client.execute({
    sql: `
      SELECT COUNT(*) AS n
      FROM transactions t
      JOIN accounts a ON a.id=t.account_id
      WHERE ${condition}
    `,
    args
  });
  const [transactions, count] = await Promise.all([transactionsQuery, countQuery]);

  return {
    period: periodToJson(filters.period),
    page: filters.page,
    transactionCount: Number(count.rows[0].n),
    transactions: transactions.rows.map(row => ({
      id: String(row.id),
      booking_date: String(row.booking_date),
      amount_minor: Number(row.amount_minor),
      currency: String(row.currency),
      counterparty: String(row.counterparty),
      description: String(row.description),
      account_name: String(row.account_name),
      category_id: row.category_id === null ? null : String(row.category_id),
      category_source: String(row.category_source)
    }))
  };
}

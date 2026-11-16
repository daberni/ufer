import { eq } from "drizzle-orm";
import { database, type Database } from "@/server/database/connection";
import { accounts, transactions } from "@/server/database/schema";
import { environment } from "@/features/banking/server/environment";
import { findSyncRun } from "@/features/banking/server/banking-queries";
import { syncRunTransactions } from "@/features/banking/server/sync-repository";
import { periodToJson } from "@/features/dashboard/period";
import { transactionPageSize } from "@/features/dashboard/pagination";
import { periodCondition } from "@/features/dashboard/server/period-condition";
import type { DashboardFilters } from "@/features/dashboard/server/dashboard-filters";

type FoundSyncRun = NonNullable<Awaited<ReturnType<typeof findSyncRun>>>;

/**
 * The transactions a list shows before search and filters: those a sync run inserted, in any month and currency, or otherwise the selected period in the display currency.
 */
function listScope(db: Database, filters: DashboardFilters, syncRun: FoundSyncRun | null) {
  if (syncRun) {
    const inserted = db.select({
      id: transactions.id
    }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(syncRunTransactions({
      environment: environment(),
      startedAt: syncRun.started_at
    })).toSQL();

    return {
      sql: [`t.id IN (${inserted.sql})`],
      args: inserted.params as (string | number)[]
    };
  }

  const inPeriod = periodCondition(filters.period);

  return {
    sql: ["t.currency=?", inPeriod.sql],
    args: [filters.currency, ...inPeriod.args]
  };
}

// Null without a run filter, and for a run that does not exist in the current banking environment.
async function selectedSyncRun(id: string) {
  if (!id) {
    return null;
  }

  return (await findSyncRun(id)) ?? null;
}

/** One page of the transaction list for the selected filters, with the number of matches across all pages. */
export async function readTransactionPage(filters: DashboardFilters) {
  const syncRun = await selectedSyncRun(filters.syncRunId);

  if (filters.syncRunId && !syncRun) {
    return {
      period: periodToJson(filters.period),
      page: filters.page,
      syncRun: null,
      transactionCount: 0,
      transactions: []
    };
  }

  const db = await database();
  const client = db.$client;
  const scope = listScope(db, filters, syncRun);
  const where = ["a.environment=?", ...scope.sql];
  const args: (string | number)[] = [environment(), ...scope.args];

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
    syncRun,
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

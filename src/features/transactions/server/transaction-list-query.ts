import { eq } from "drizzle-orm";
import { database, type Database } from "@/server/database/connection";
import { accounts, transactions } from "@/server/database/schema";
import { environment } from "@/features/banking/server/environment";
import { findSyncRun } from "@/features/banking/server/banking-queries";
import { syncRunTransactions } from "@/features/banking/server/sync-repository";
import { periodToJson } from "@/lib/period";
import { transactionPageSize } from "@/lib/pagination";
import { periodCondition } from "@/features/transactions/server/period-condition";
import { searchCondition } from "@/features/transactions/server/search-condition";
import type { DashboardFilters } from "@/server/http/dashboard-filters";
import type { TransactionType } from "@/features/transactions/transaction-types";
import { createdCounterpartPrefix, manualEntryPrefix } from "@/features/transactions/server/transfer-repository";

// Mirrors `enteredInUfer` for a booking and its account in the list's SQL.
function enteredColumn(booking: string, account: string) {
  return `(${account}.provider='manual' AND (${booking}.provider_reference LIKE '${manualEntryPrefix}%' OR ${booking}.provider_reference LIKE '${createdCounterpartPrefix}%'))`;
}

/** Whether a listed booking was entered in Ufer and, if so, whether it follows a linked imported booking. A counterpart created for an imported booking is not editable as an entry, and neither is a booking on an archived account. */
function entryState(row: Record<string, unknown>) {
  const linkedToImport = row.counterpart_id !== null && !row.counterpart_entered;
  const entered = Boolean(row.entered) && !row.account_archived && !row.counterpart_archived && !(Boolean(row.created_counterpart) && linkedToImport);

  return {
    entered,
    follows_import: entered && linkedToImport
  };
}

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
    const matchesSearch = searchCondition(filters.search);

    where.push(matchesSearch.sql);
    args.push(...matchesSearch.args);
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

  if (filters.type) {
    where.push("t.type=?");
    args.push(filters.type);
  }

  const condition = where.join(" AND ");
  // Banks report dates without a time, so bookings within a day are ordered by payee and description; empty payees come last.
  const transactionsQuery = client.execute({
    sql: `
      SELECT t.id,t.booking_date,t.amount_minor,t.currency,t.instructed_amount_minor,t.instructed_currency,t.counterparty,t.description,a.name AS account_name,t.account_id,t.category_id,t.category_source,t.type,t.type_source,a.provider='manual' AS manual_account,a.archived_at IS NOT NULL AS account_archived,COALESCE(pa.archived_at IS NOT NULL,0) AS counterpart_archived,t.provider_reference LIKE ? AS created_counterpart,${enteredColumn("t", "a")} AS entered,${enteredColumn("p", "pa")} AS counterpart_entered,p.id AS counterpart_id,pa.name AS counterpart_account_name,p.booking_date AS counterpart_booking_date
      FROM transactions t
      JOIN accounts a ON a.id=t.account_id
      LEFT JOIN transactions p ON p.transfer_id=t.transfer_id AND p.id<>t.id
      LEFT JOIN accounts pa ON pa.id=p.account_id
      WHERE ${condition}
      ORDER BY t.booking_date DESC,t.counterparty='',t.counterparty COLLATE NOCASE,t.description COLLATE NOCASE,t.id
      LIMIT ?
      OFFSET ?
    `,
    args: [`${createdCounterpartPrefix}%`, ...args, transactionPageSize, (filters.page - 1) * transactionPageSize]
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
      instructed_amount_minor: row.instructed_amount_minor === null ? null : Number(row.instructed_amount_minor),
      instructed_currency: row.instructed_currency === null ? null : String(row.instructed_currency),
      counterparty: String(row.counterparty),
      description: String(row.description),
      account_name: String(row.account_name),
      account_id: String(row.account_id),
      category_id: row.category_id === null ? null : String(row.category_id),
      category_source: String(row.category_source),
      type: row.type as TransactionType,
      type_source: row.type_source === "manual" ? "manual" as const : "auto" as const,
      manual_account: Boolean(row.manual_account),
      account_archived: Boolean(row.account_archived),
      counterpart_archived: Boolean(row.counterpart_archived),
      created_counterpart: Boolean(row.created_counterpart),
      ...entryState(row),
      counterpart: row.counterpart_id === null ? null : {
        id: String(row.counterpart_id),
        account_name: String(row.counterpart_account_name),
        booking_date: String(row.counterpart_booking_date)
      }
    }))
  };
}
